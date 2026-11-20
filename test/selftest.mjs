import {
  readFile
} from 'node:fs/promises';
import {
  join
} from 'node:path';
import {
  createHash
} from 'node:crypto';
import assert from 'node:assert/strict';
import { cameraLine, buildTutorialTimeline } from '../public/reel/tutorial.js';

import {
  parseARW
} from '../public/formats/arw.js';
import {
  parseACR,
  md5,
  inflateReceipt
} from '../public/formats/acr.js';
import {
  parseXMP,
  recordUsage
} from '../public/formats/xmp.js';
import {
  readTIFF
} from '../public/formats/tiff.js';
import { sonyDecrypt, readSonyWhiteBalance, inferIlluminant, relativeWhiteBalance } from '../public/formats/wb.js';
import { globalSummary, correctionSummary } from '../public/anim/summary.js';
import { adjustmentUniforms } from '../public/render/passes.js';
import { scoreAlignment, warpPosition } from '../public/render/mask-alignment.js';
import {
  readdir
} from 'node:fs/promises';
const cameraXML='<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:e="http://ns.adobe.com/exif/1.0/" crs:Version="16" e:FocalLength="350/10" e:FNumber="63/10"><e:ISOSpeedRatings><rdf:Seq><rdf:li>400</rdf:li></rdf:Seq></e:ISOSpeedRatings></rdf:Description></rdf:RDF></x:xmpmeta>';
assert.equal(cameraLine(parseXMP(cameraXML).camera,[{tags:{33434:1/400,34855:800}}]),'35mm · f/6.3 · 1/400s · ISO 400');
assert.equal(cameraLine({},[]),'');
const scores=Array.from({length:10},(_,i)=>({pass:{index:i,result:i},score:i,title:'PASS '+i,chip:'Masking'}));
const tutorial=buildTutorialTimeline({original:-1,timeline:{scores}}, {globals:{}}, {ifds:[]});
assert.deepEqual(tutorial.steps.map(s=>s.number),[3,4,5,6,7,8,9]);
for(const s of tutorial.steps){
  const index=tutorial.schedule.findIndex(c=>c.scene==='step' && c.number===s.number);
  assert.equal(tutorial.schedule[index-1].scene,'lift');
  assert.equal(tutorial.schedule[index].before,s.number-1);
}

const directory=process.argv[2];
if(!directory)throw new Error('Usage: node test/selftest.mjs <DSC03049 sample directory>');
const names=await readdir(directory),name=names.find(n=>/\.arw$/i.test(n));
if(!name)throw new Error('No ARW sample found');
const base=name.slice(0,-4),find=ext=>names.find(n=>n.toLowerCase()===`${base}.${ext}`.toLowerCase());
const [raw,sidecar,companion]=await Promise.all([readFile(join(directory,name)),readFile(join(directory,find('xmp')),
'utf8'),readFile(join(directory,find('acr')))]);
const arw=parseARW(raw);
console.log('\nARW TIFF',arw.byteOrder,'orientation',arw.orientation);
console.table(arw.ifds.map(i=>({
  IFD:i.name,
  offset:i.offset,
  entries:i.entries.length,
  next:i.next
})));
console.table(arw.previews);
console.log('Chosen JPEG:',arw.chosen);
console.log('Ignored sensor:',arw.sensor);
console.log('As-shot white balance:', arw.whiteBalance);
assert.equal(arw.whiteBalance.estimated, false, 'Sample must recover its SR2 WB');
assert.deepEqual(arw.whiteBalance.rawLevels, [2002, 1024, 1024, 2237]);
assert.ok(arw.whiteBalance.kelvin > 3500 && arw.whiteBalance.kelvin < 3600);
const sourceGains = relativeWhiteBalance(arw.whiteBalance, {
  Temperature: arw.whiteBalance.kelvin, Tint: arw.whiteBalance.tint
}).gains;
sourceGains.forEach(gain => assert.ok(Math.abs(gain - 1) < 1e-12, 'Same illuminant must be identity'));
const targetGains = relativeWhiteBalance(arw.whiteBalance, { Temperature: 3300, Tint: 5 }).gains;
assert.ok(targetGains[0] < 1 && targetGains[2] > 1 && targetGains.every(v => v > 0.9 && v < 1.1));
// Test the alternative GRBG layout using the same real encrypted directory.
const grbgARW = new Uint8Array(raw), wbReport = arw.whiteBalance;
const privateView = new DataView(grbgARW.buffer);
const privateCount = privateView.getUint16(wbReport.privateOffset, true);
let key;
for (let i = 0; i < privateCount; i++) {
  const at = wbReport.privateOffset + 2 + i * 12;
  if (privateView.getUint16(at, true) === 0x7221) key = privateView.getUint32(at + 8, true);
}
const decrypted = sonyDecrypt(grbgARW.subarray(wbReport.encryptedOffset, wbReport.encryptedOffset + wbReport.encryptedLength), key);
const decryptedView = new DataView(decrypted.buffer);
for (let i = 0; i < decryptedView.getUint16(0, true); i++) {
  const at = 2 + i * 12;
  if (decryptedView.getUint16(at, true) !== 0x7313) continue;
  const valueAt = decryptedView.getUint32(at + 8, true) - wbReport.encryptedOffset;
  decryptedView.setUint16(at, 0x7303, true);
  const [r, g1, g2, b] = wbReport.rawLevels;
  [g1, r, b, g2].forEach((v, c) => decryptedView.setInt16(valueAt + c * 2, v, true));
}
grbgARW.set(sonyDecrypt(decrypted, key), wbReport.encryptedOffset);
const grbgWB = parseARW(grbgARW).whiteBalance;
assert.equal(grbgWB.order, 'GRBG');
assert.deepEqual(grbgWB.levels, wbReport.levels);
// Cover buffer aliasing and a stream longer than the 128-word pad.
const cipherInput = Buffer.alloc(536, 0xa7), cipherBefore = Buffer.from(cipherInput);
const cipher = sonyDecrypt(cipherInput, 0x44332211);
assert.deepEqual(cipherInput, cipherBefore, 'Decryption must not mutate its argument');
assert.deepEqual([...sonyDecrypt(cipher, 0x44332211)], [...cipherInput]);
const fallbackTIFF = { ...readTIFF(raw), ifds: [{ entries: [], tags: {} }] };
assert.equal(readSonyWhiteBalance(raw, fallbackTIFF).estimated, true);
const corruptSR2 = new Uint8Array(raw);
const pointer = arw.ifds[0].entries.find(e => e.tag === 0xc634);
new DataView(corruptSR2.buffer).setUint32(pointer.at, raw.length + 8, true);
assert.equal(parseARW(corruptSR2).whiteBalance.estimated, true, 'Corrupt private data must preserve usable previews');
for (const preset of arw.whiteBalance.calibrations) {
  const inferred = inferIlluminant(preset.levels, arw.whiteBalance.calibrations);
  assert.ok(Math.abs(inferred.kelvin - preset.kelvin) < 1e-8);
}
assert.ok(arw.chosen.width>0);
assert.equal(raw[arw.chosen.offset],255);
assert.equal(raw[arw.chosen.offset+1],216);
const recovery = new Uint8Array(raw), recoveryView = new DataView(recovery.buffer);
for (const ifd of arw.ifds) {
  ifd.entries.forEach((entry, i) => {
    if ([513, 514, 273, 279].includes(entry.tag)) {
      recoveryView.setUint16(ifd.offset + 2 + i * 12, 0xfff0, arw.byteOrder === 'II');
    }
  });
}
assert.equal(parseARW(recovery).chosen.width, arw.chosen.width, 'Recovery scan must find the full JPEG');
const acr=parseACR(companion);
console.log('\nACR header:',{
  version:acr.version,
  source:acr.source,
  count:acr.count,
  reserved:acr.reserved
});
for(const r of acr.records){
  const actual=createHash('md5').update(companion.subarray(r.offset,r.offset+r.size)).digest('hex').toUpperCase();
  assert.equal(actual,r.actualMD5);
  if(r.kind==='raster')assert.equal(r.md5Match,true);
  else{
    r.receipt=await inflateReceipt(companion,r);
    assert.match(r.receipt.xml,/xmpmeta/);
  }
}
const xmp=parseXMP(sidecar,null),usage=recordUsage(xmp);
assert.equal(xmp.lensDistort.length,4,'Sony lens rationals must survive the Node parser');
assert.ok(Math.abs(xmp.lensDistort[0]-.957925736)<1e-8);
const lensXML=(field,xmlns='xmlns:aux="http://ns.adobe.com/exif/1.0/aux/"')=>`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${xmlns} crs:Exposure2012="0" ${field}/></rdf:RDF></x:xmpmeta>`;
assert.deepEqual(parseXMP(lensXML('aux:LensDistortInfo="9/10 -1/20 1/100 0/1"'),null).lensDistort,[.9,-.05,.01,0]);
assert.deepEqual(parseXMP(lensXML('sony:LensDistortInfo="9/10 -1/20 1/100 0/1"','xmlns:sony="http://ns.adobe.com/exif/1.0/aux/"'),null).lensDistort,[.9,-.05,.01,0]);
const lensElement=lensXML('').replace('crs:Exposure2012="0" />','crs:Exposure2012="0"><aux:LensDistortInfo>9/10 -1/20 1/100 0/1</aux:LensDistortInfo></rdf:Description>');
assert.deepEqual(parseXMP(lensElement,null).lensDistort,[.9,-.05,.01,0]);
for(const text of ['1/0 0/1 0/1 0/1','1 2 3','oops 0 0 0'])assert.equal(parseXMP(lensXML(`aux:LensDistortInfo="${text}"`),null).lensDistort,null);
assert.equal(parseXMP(lensXML('aux:LensDistortInfo="1 0 0 0"','xmlns:aux="urn:unrelated"'),null).lensDistort,null,'The namespace URI, not its prefix, identifies lens data');
// Both hypotheses need coverage: coefficients alone must never enable a warp.
const aw=180,ah=120,ak=[.92,0,0,0];
const shape=(u,v)=>1/(1+Math.exp((Math.hypot((u-.7)/.19,(v-.35)/.24)-1)*60));
const sensor=Float32Array.from({length:aw*ah},(_,i)=>shape((i%aw+.5)/aw,(Math.floor(i/aw)+.5)/ah));
const corrected=Float32Array.from(sensor,(_,i)=>shape(...warpPosition((i%aw+.5)/aw,(Math.floor(i/aw)+.5)/ah,aw,ah,ak)));
assert.equal(scoreAlignment(sensor,sensor,aw,ah,ak).apply,false,'An uncorrected preview must keep its raster frame');
assert.equal(scoreAlignment(corrected,sensor,aw,ah,ak).apply,true,'A corrected preview must select warped lookups');
assert.equal(scoreAlignment(sensor,sensor,aw,ah,[1,0,0,0]).apply,false,'Tied hypotheses must default Off');
assert.equal(scoreAlignment(new Float32Array(aw*ah),sensor,aw,ah,ak).apply,false,'Textureless previews must default Off');
const luminance = xmp.corrections.flatMap(c => c.masks).find(m => m.CorrectionRangeMask?.Type === 2);
assert.ok(luminance?.CorrectionRangeMask.LumRange, 'Self-closing range parameters must survive parsing');
assert.ok(globalSummary(xmp.globals).some(line => line.startsWith('HSL sat:')));
assert.ok(xmp.corrections.map(correctionSummary).some(line => line.includes('luma range')));
assert.equal(adjustmentUniforms({LocalExposure2012:1},true).color[0],4);
assert.equal(adjustmentUniforms({Exposure2012:-0.5}).color[0],-0.5);
assert.deepEqual(adjustmentUniforms({LocalToningHue:230,LocalToningSaturation:.345},true).localToning,[230/360,.345]);
assert.deepEqual(adjustmentUniforms({},true).localToning,[0,0]);
console.table(acr.records.map(r=>({
  md5:r.id,
  kind:r.kind,
  dimensions:r.width?`${r.width}x${r.height}`:`${r.receipt.length} inflated bytes`,
  channels:r.channels,
  bytes:r.size,
  offset:r.offset,
  check:r.md5Match?'MATCH':`DIFFERS (${r.actualMD5})`,
  use:(usage.get(r.id)||[]).join('; ')
})));
console.log('\nXMP:',Object.keys(xmp.globals).length,'globals; profile',xmp.globals.CameraProfile,'PV',xmp.globals.ProcessVersion);
console.table(xmp.corrections.map(c=>({
  correction:c.name,
  active:c.CorrectionActive,
  masks:c.masks.map(m=>`${m.MaskName||m.What}${m.MaskActive===false?' [inactive]':''}`).join(' + '),
  storedExposure:c.LocalExposure2012,
  EV:4*(c.LocalExposure2012||0),
  glow:c.LocalGlow,
  curves:['MainCurve','RedCurve','GreenCurve','BlueCurve'].filter(k=>c[k]).join(',')
})));
for(const [id,uses]of usage){
  assert.ok(acr.records.some(r=>r.id===id&&r.kind==='raster'),`Missing ${id}: ${uses.join(', ')}`);
}
assert.equal(md5(new TextEncoder().encode('abc')),'900150983CD24FB0D6963F7D28E17F72');
assert.throws(()=>parseARW(new Uint8Array(8)));
assert.throws(()=>parseACR(companion.subarray(0,24)));
assert.throws(()=>readTIFF(new Uint8Array([73,73,42,0,255,255,255,127])));
// Both endian orders and inline SHORT arrays, which do not use an offset.
for(const le of [true,false]){
  const bytes=new Uint8Array(26),
  v=new DataView(bytes.buffer);
  bytes.set(le?[73,73]:[77,77]);
  v.setUint16(2,42,le);
  v.setUint32(4,8,le);
  v.setUint16(8,1,le);
  v.setUint16(10,258,le);
  v.setUint16(12,3,le);
  v.setUint32(14,2,le);
  v.setUint16(18,8,le);
  v.setUint16(20,16,le);
  assert.deepEqual(readTIFF(bytes).ifds[0].tags[258],[8,16]);
}
assert.equal(xmp.corrections.length,xmp.raw.MaskGroupBasedCorrections.length);
assert.ok(xmp.globals.ToneCurvePV2012.length>=2);
const digestOnlyDigits = parseXMP(sidecar.replace(/crs:MaskDigest="[A-F0-9]{32}"/, 'crs:MaskDigest="00000000000000000000000000000000"'), null);
assert.ok(recordUsage(digestOnlyDigits).has('00000000000000000000000000000000'));
const g=xmp.globals,angle=g.CropAngle*Math.PI/180,w=arw.chosen.width*(g.CropRight-g.CropLeft),h=arw.chosen.height*(g.CropBottom-g.CropTop);
console.log('Crop diagonal convention (before orientation):',Math.round(w*Math.cos(angle)+h*Math.sin(angle)),Math.round(h*Math.cos(angle)-w*Math.sin(angle)));
console.log('\nPASS · TIFF/ARW/ACR/XMP, SR2 WB, raster MD5s, receipts, digest bindings, bounds validation. JXL decoding is verified in the browser, skipped in Node.');
