import assert from 'node:assert/strict';
import { realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';
import { decode } from './seek-sheet.mjs';

const [sample, out] = process.argv.slice(2);
if (!sample || !out) throw new Error('Usage: node test/cr3-browser.mjs <R50 sample.cr3> <external contact sheet directory>');
const outputDir = await realpath(out);
const repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const location = relative(repo, outputDir);
if (!(isAbsolute(location) || location === '..' || location.startsWith('..' + sep))) {
  throw new Error('Save sample contact sheets outside the repository');
}
const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="+0.3" crs:Contrast2012="10">
    <crs:ToneCurvePV2012Red><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>128, 142</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012Red>
    <crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li crs:CorrectionName="Gradient" crs:LocalExposure2012="0.15">
      <crs:CorrectionMasks><rdf:Seq><rdf:li crs:What="Mask/Gradient" crs:MaskValue="1"
        crs:ZeroX="0.1" crs:ZeroY="0.25" crs:FullX="0.9" crs:FullY="0.75"/></rdf:Seq></crs:CorrectionMasks>
    </rdf:li></rdf:Seq></crs:MaskGroupBasedCorrections>
  </rdf:Description></rdf:RDF></x:xmpmeta>`;
const debug = 'http://127.0.0.1:9223';
const url = process.env.LR_SIDECAR_URL || 'http://localhost:4100/';
const tab = await fetch(debug+'/json/new?'+encodeURIComponent(url), { method: 'PUT' }).then(r => r.json());
const { call, evaluate, until, close } = await connect(tab.id);
try {
  await until('!!window.lrcReel');
  await call('Page.bringToFront');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const { root } = await call('DOM.getDocument');
  const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#files' });
  await evaluate("document.querySelector('#files').addEventListener('change',e=>window.sampleFile=e.target.files[0],{once:true,capture:true})");
  await call('DOM.setFileInputFiles', { nodeId, files: [resolve(sample)] });
  await until("!lrc.state.loading && (lrc.state.arw || !document.querySelector('#intake-error').hidden)");
  assert.equal(await evaluate("document.querySelector('#intake-error').hidden"), true);
  assert.match(await evaluate("document.querySelector('#input-facts').textContent"), /6000 × 4000.*orientation 1.*5200 K \(Canon ColorData v48 as-shot\)/);
  // Compare the visible input against an independent decode of the known JPEG
  // extent; orientation 1 should leave all four corners in their original places.
  const error = await evaluate(`(async()=>{
    const file=window.sampleFile;
    const expected=await createImageBitmap(file.slice(500224,500224+3613893,'image/jpeg'));
    const input=document.querySelector('#input');
    if(input.hidden || input.width!==1400 || input.height!==933)throw Error('Input preview dimensions');
    const ctx=new OffscreenCanvas(48,32).getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingQuality='high';
    function pixels(image){ctx.drawImage(image,0,0,48,32);return ctx.getImageData(0,0,48,32).data;}
    const a=pixels(input),b=pixels(expected);expected.close();
    return a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
  })()`);
  assert.ok(error < 3, 'Input preview differs from the unrotated track 1 JPEG: '+error);
  await evaluate(`lrc.loadFiles([new File([${JSON.stringify(xml)}],'test.xmp')])`);
  await evaluate('lrc.compile()');
  assert.deepEqual(await evaluate("lrc.state.groups.map(g=>[g.kind,g.rendered])"), [['globals',true],['parametric',true]]);
  assert.equal(await evaluate("document.querySelectorAll('.slice').length"), 2);
  assert.equal(await evaluate('lrc.state.maskAlignment.enabled'), false);
  for (const mode of ['teaser', 'tutorial']) {
    await evaluate(`document.querySelector('[value=${mode}]').click()`);
    if (mode === 'tutorial') {
      const lines = await evaluate(`(async()=>{
        const {data,frame}=await lrcReel.makeRenderer();
        const cue=data.timeline.schedule.find(c=>c.scene==='source');
        return frame((cue.t0+cue.t1)/2).text.map(t=>t.text);
      })()`);
      assert.deepEqual(lines, ['50mm · f/5 · 1/250s · ISO 100', 'RF50mm F1.8 STM', 'LIGHTROOM', 'CR3 + XMP']);
    }
    const { frames, sheet } = await evaluate(`(${decode.toString()})()`);
    assert.ok(frames > 0);
    assert.deepEqual(await evaluate("['videoWidth','videoHeight'].map(k=>document.querySelector('#reel-preview')[k])"), [1080,1920]);
    await writeFile(join(outputDir,`cr3-${mode}-contact.jpg`), Buffer.from(sheet,'base64'));
    console.log(mode, frames, 'encoded frames at 1080 × 1920; contact sheet decoded');
  }
} finally {
  close();
  await fetch(debug+'/json/close/'+tab.id);
}
