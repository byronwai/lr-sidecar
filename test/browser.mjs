// Optional browser integration probe. Start Chrome with --remote-debugging-port=9223.
// Reads samples through the file input; never copies them into the workspace.
import {
  writeFile,
  mkdir
} from 'node:fs/promises';
import {
  resolve,
  join
} from 'node:path';
import assert from 'node:assert/strict';
import { regressionChecks } from './regressions.mjs';
import { referenceRegressionChecks } from './reference-regressions.mjs';
import { auditText } from './text-audit.mjs';
import { auditTutorial } from './tutorial-audit.mjs';
import { fileURLToPath } from 'node:url';
// Screenshots go to LR_SIDECAR_ARTIFACTS, or test/artifacts/ (git-excluded) by default.
const out=process.env.LR_SIDECAR_ARTIFACTS||fileURLToPath(new URL('./artifacts/',import.meta.url));
const directory=process.argv[2];
if(!directory)throw new Error('Usage: node test/browser.mjs <sample-directory> [--full] [--screenshots]');
const screenshots=process.argv.includes('--screenshots');
async function saveArtifact(name,data){
  if(!screenshots)return;
  await mkdir(out,{recursive:true});
  await writeFile(join(out,name),Buffer.from(data,'base64'));
}
const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json()),tab=tabs.find(t=>process.env.LR_CDP_TARGET?t.id===process.env.LR_CDP_TARGET:t.type==='page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{
  once:true
}));
let id=0;
const pending=new Map(),errors=[];
ws.addEventListener('message',({
  data
})=>{
  const m=JSON.parse(data);
  if(m.id){
    const p=pending.get(m.id);
    pending.delete(m.id);
    m.error?p?.reject(new Error(JSON.stringify(m.error))):p?.resolve(m.result);
  }else if(m.method==='Runtime.exceptionThrown'){
    errors.push(m.params.exceptionDetails);
    console.error('Browser exception',JSON.stringify(m.params.exceptionDetails));
  }
});
const call=(method,params={})=>new Promise((resolve,reject)=>{
  const key=++id;
  pending.set(key,{
    resolve,
    reject
  });
  ws.send(JSON.stringify({
    id:key,
    method,
    params
  }));
});
const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{
    expression,
    awaitPromise:true,
    returnByValue:true
  });
  if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression,timeout=120000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(await evaluate(expression))return;
    await wait(350);
  }
  throw new Error(`Timeout: ${expression}`);
}
await call('Runtime.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride',{
  width:1600,
  height:1300,
  deviceScaleFactor:1,
  mobile:false
});
await call('Page.navigate',{
  url:process.env.LR_SIDECAR_URL || 'http://localhost:4100/'
});
await call('Page.bringToFront');
await until('!!window.lrc');
assert.equal(await evaluate("document.querySelector('#dropzone').hasAttribute('tabindex')||document.querySelector('#dropzone').hasAttribute('role')"),false,'Drop section must not nest button semantics');
assert.equal(await evaluate("document.querySelector('#choose-files').tagName"),'BUTTON');
assert.deepEqual(await evaluate("[...document.querySelector('[data-slot=jpg]').querySelectorAll('span,small')].map(el=>el.textContent)"),['Edited JPG','Optional · accurate final colours in your Reel']);
await call('Emulation.setEmulatedMedia',{
  features:[{
    name:'prefers-reduced-motion',
    value:'reduce'
  }]
});
await evaluate(`document.querySelector('#files').addEventListener('change',event=>{
  window.testSamples=Array.from(event.target.files);
},{
  capture:true,
  once:true
})`);
const root=await call('DOM.getDocument'),node=await call('DOM.querySelector',{
  nodeId:root.root.nodeId,
  selector:'#files'
});
await call('DOM.setFileInputFiles',{
  nodeId:node.nodeId,
  files:['DSC03049.acr','DSC03049.ARW','DSC03049.xmp'].map(n=>join(resolve(directory),n))
});
await until("!document.querySelector('#compile').disabled || !document.querySelector('#intake-error').hidden");
assert.equal(await evaluate("document.querySelector('#intake-error').hidden ? '' : document.querySelector('#intake-error').textContent"),'');
assert.equal(await evaluate('window.testSamples.length'),3);
assert.equal(await evaluate("document.querySelectorAll('.slice.placeholder').length"),0,'Real faces should be prepared before compile');
console.log('PARSED',await evaluate('({chosen:lrc.state.arw.chosen,records:lrc.state.acr.count,corrections:lrc.state.settings.corrections.length,groups:lrc.state.groups.map(g=>g.name)})'));
assert.equal(await evaluate('lrc.state.settings.lensDistort.length'),4,'DOMParser must read Sony lens coefficients');
assert.equal(await evaluate("document.querySelector('#raster-warp').value"),'auto');
const alignment=await evaluate('lrc.state.maskAlignment');
console.log('AI RASTER ALIGNMENT',alignment);
assert.ok(Number.isFinite(alignment.off)&&Number.isFinite(alignment.warp));
assert.equal(alignment.enabled,alignment.apply,'Auto must use the measured decision for prepared slice faces');
assert.equal(await evaluate("new Set(lrc.state.groups.filter(g=>g.kind==='ai').map(g=>g.color)).size"),3,'Background, subject and vegetation need distinct accents');
assert.equal(await evaluate("lrc.state.arw.whiteBalance.estimated===false&&document.querySelector('#input-facts').textContent.includes('SR2-derived')"),true);
const layoutCheck=`(()=>{
  const labels=[...document.querySelectorAll('.slice-label')].map(el=>el.getBoundingClientRect()).sort((a,b)=>a.top-b.top);
  const params=[...document.querySelectorAll('.slice-label .params')];
  return {visible:params.every(el=>getComputedStyle(el).overflowY==='visible'&&el.scrollHeight<=el.clientHeight+1),
    separated:labels.every((r,i)=>!i||r.top>=labels[i-1].bottom+10),
    fullGlobals:params[0].textContent.includes('HSL sat:')&&params[0].textContent.includes('straighten'),
    fullParametrics:params.at(-1).textContent.includes('Glow')&&params.at(-1).textContent.includes('luma range')};
})()`;
await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'false');
await evaluate("document.querySelector('.stack-toggle').click()");
await wait(100);
assert.deepEqual(await evaluate(layoutCheck),{visible:true,separated:true,fullGlobals:true,fullParametrics:true},'Desktop labels must be complete, readable and separated');
if(process.argv.includes('--full'))await evaluate("document.querySelector('#fullres').checked=true");
const compiled=await evaluate('window.lrc.compile().then(output=>({ok:true,output})).catch(e=>({error:e.message,logs:lrc.state.logs}))');
console.log('COMPILE',compiled);
assert.equal(compiled.ok,true);
await referenceRegressionChecks(evaluate);
await regressionChecks(evaluate,call);
await evaluate("document.querySelector('#mode-tutorial').click()");
const tutorial = await evaluate('('+auditTutorial.toString()+')()');
assert.deepEqual(tutorial.mismatch,[]);
assert.equal(tutorial.unsafe+tutorial.rectDeviation+tutorial.endOverlays,0);
assert.ok(tutorial.maxRows<=4 && tutorial.min.panel>=70);
assert.ok(tutorial.min.value>=30 && tutorial.min.kicker>=28 && tutorial.min.label>=28);
assert.ok(tutorial.steps.length<=7 && tutorial.steps.every(s=>s.score>=.6 && [1.5,2,2.5].includes(s.dwell)));
await evaluate("document.querySelector('[name=reel-mode][value=teaser]').click()");
for(const mode of ['teaser','tutorial']){
  await evaluate(`document.querySelector('[value="${mode}"]').click()`);
  const initial=await evaluate("document.querySelector('#reel-description').value");
  assert.equal(initial,'');
  for(const description of ['Night, but redder.','']){
    await evaluate(`(()=>{const el=document.querySelector('#reel-description');el.value=${JSON.stringify(description)};el.dispatchEvent(new Event('input'))})()`);
    const audit=await evaluate('('+auditText.toString()+')()');
    assert.equal(audit.unsafe+audit.dangling+audit.asciiNegatives,0);
    assert.deepEqual(audit.other,[]);
    assert.deepEqual(audit.valueErrors,[]);
    if(mode==='teaser'&&description){
      const copied=await evaluate(`(async()=>{
        const {caption}=await lrcReel.export();
        const dialog=document.querySelector('#caption-editor'),clipboard=navigator.clipboard;
        const write=clipboard.writeText;
        let text;
        clipboard.writeText=async v=>{text=v};
        try {
          document.querySelector('#copy-caption').click();
          const original=text===caption;
          dialog.querySelector('textarea').value+=' Edited';
          dialog.querySelector('[data-copy]').click();
          await Promise.resolve();
          return [caption.split('\\n')[0],original,text===caption+' Edited' && !dialog.open];
        } finally {clipboard.writeText=write;}
      })()`);
      assert.deepEqual(copied,[description,true,true]);
    }
    const title=description || 'Behind the edit';
    assert.ok(audit.strings.includes(title),'Cover text reaches the renderer');
  }
}
const wrapping=await evaluate(`(async()=>{
  const {labelLines,displayValue}=await import('./reel/text.js');
  const {headlineLayout,loadReelFonts}=await import('./reel/scene.js');
  const descriptions=['夜色裡的街道與天空','👩🏽‍🎨'.repeat(6),'晨光映在街道上的每一扇窗'.repeat(5)];
  await loadReelFonts(descriptions.join(''));
  const ctx=new OffscreenCanvas(1080,1920).getContext('2d');
  const font='500 32px "Reel Mono","Noto Sans TC Variable",monospace';
  const full=['PASS 2 · Background ∪ Architecture ∪ Sky','AI subject mask · Linear gradient × 2 · 1 raster',
    '天空與背景 · 遮色片 − 人物 · 天空 × 2 · Linear gradient'];
  ctx.font=font;
  const union='Background ∪ Architecture';
  let valid=labelLines(ctx,union+' ∪ Sky',ctx.measureText(union).width+1,font).join('|')===union+'|Sky';
  for(const label of full)for(const w of [320,520,764]){
    const lines=labelLines(ctx,label,w,font);
    valid&&=lines.length<=2&&lines.every(s=>ctx.measureText(s).width<=w&&!/^[∪·−×]|[∪·−×]$/u.test(s));
  }
  for(const desc of descriptions){
    const lines=headlineLayout(ctx,desc);
    valid&&=lines.length<=2&&lines.every(l=>{
      ctx.font=l.font;ctx.letterSpacing=l.tracking;
      return ctx.measureText(l.text).width<=868 && !l.text.endsWith('‍');
    });
  }
  return [valid,descriptions[2].length,displayValue(-.44,2),displayValue(-.001,2)];
})()`);
assert.deepEqual(wrapping,[true,60,'−0.44','0.00']);
await evaluate("document.querySelector('[value=teaser]').click()");
console.log('Tutorial schedule, XML controls and frame bounds pass');
const measuredTitles=await evaluate(`(async()=>{
  const {buildTimeline}=await import('./reel/timeline.js');
  const canvas=color=>{const c=new OffscreenCanvas(64,64);const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,64,64);return c};
  const before=canvas('#808080'),after=canvas('#5486b0'),mask=canvas('#000000');
  mask.getContext('2d').fillStyle='#e4c46a';mask.getContext('2d').fillRect(0,0,32,64);
  // Deliberately turn the OUTSIDE of the mask red. The local measurement
  // must still describe its blue inside, despite a non-identity RedCurve.
  after.getContext('2d').fillStyle='#ff0000';after.getContext('2d').fillRect(32,0,32,64);
  const pass={index:0,name:'Background',kind:'ai',color:'#e4c46a',mask,result:after,
    corrections:[{masks:[{What:'Mask/Image',MaskName:'Background'}],RedCurve:['0,30','255,255'],LocalHighlights2012:-.102804}]};
  const p=buildTimeline(before,[pass],false),item=p.scores[0];
  const global=buildTimeline(before,[{index:0,kind:'globals',result:after,globals:{Contrast2012:12.789,Exposure2012:.12345}}],false);
  return {title:item.title,coverage:item.measured.maskCoverage,deltaB:item.measured.deltaB,
    rows:p.schedule.find(c=>c.scene==='program').rows,
    globalRows:global.schedule.find(c=>c.scene==='camera').rows,
    emptyCover:buildTimeline(before,[],false).coverTitle};
})()`);
assert.equal(measuredTitles.title,'PASS 0 · Background');
assert.ok(Math.abs(measuredTitles.coverage-.5)<.001,'Resampled half-mask coverage');
assert.ok(measuredTitles.deltaB<0);
// Local sliders show in Lightroom's units: LocalHighlights2012 -0.102804 is -10 on the slider.
assert.equal(measuredTitles.rows.find(r=>r.label==='Highlights').value,-10);
assert.equal(measuredTitles.rows.find(r=>r.label==='Highlights').decimals,0);
assert.equal(measuredTitles.globalRows.find(r=>r.label==='Contrast').value,13);
assert.equal(measuredTitles.globalRows.find(r=>r.label==='Exposure').value,.12);
assert.equal(measuredTitles.emptyCover,'Behind the edit');
console.log('MEASURED titles / mask weighting / rounded values pass');
assert.equal(await evaluate("lrc.state.logs.some(s=>s.includes('AI raster alignment: off='))"),true,'Compile log must include both alignment scores');
assert.ok(compiled.output.width>0);
assert.equal(await evaluate('lrc.state.correctionTimings.length'),8);
const capture=await call('Page.captureScreenshot',{
  format:'png',
  captureBeyondViewport:true
});
await saveArtifact('desktop.png',capture.data);
const output=await evaluate("document.querySelector('#output').toDataURL('image/png')");
await saveArtifact('output-preview.png',output.split(',')[1]);
const png=await evaluate("fetch(document.querySelector('#download-png').href).then(r=>r.blob()).then(async b=>({size:b.size,type:b.type,bitmap:await createImageBitmap(b).then(i=>{const d=[i.width,i.height];i.close();return d})}))");
console.log('PNG',png);
assert.deepEqual(png.bitmap,[compiled.output.width,compiled.output.height]);
for(const mode of ['off','warp','auto']){
  await evaluate(`(()=>{const select=document.querySelector('#raster-warp');select.value='${mode}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate('lrc.state.compiled'),false,'Changing alignment must invalidate the previous output');
  assert.equal(await evaluate('lrc.state.rasterWarp'),mode);
  await evaluate('lrc.compile()');
  assert.equal(await evaluate('lrc.state.maskAlignment.enabled'),mode==='warp'||mode==='auto'&&alignment.apply);
}
console.log('ALIGNMENT overrides and Auto pass');
await evaluate("(()=>{const b=document.querySelector('.stack-toggle');if(b.getAttribute('aria-expanded')==='false')b.click()})()");
for(let i=0;i<6;i++){
  await evaluate(`document.querySelectorAll('.slice')[${i}].click()`);
  await until(`document.querySelector('#output-name').textContent.startsWith('Pass ${i}')`);
  const image=await evaluate("document.querySelector('#output').toDataURL('image/png')");
  await saveArtifact(`pass-${i}.png`,image.split(',')[1]);
}
await evaluate("document.querySelector('#show-final').click()");
const before=await evaluate("document.querySelector('#output').toDataURL()");
await evaluate("document.querySelector('[data-pass=\"1\"]').click()");
await until('!lrc.state.compiling&&lrc.state.compiled');
const after=await evaluate("document.querySelector('#output').toDataURL()");
assert.notEqual(before,after,'Disabling Remove should change output');
console.log('PASS BYPASS changes pixels');
await call('Emulation.setDeviceMetricsOverride',{
  width:390,
  height:844,
  deviceScaleFactor:1,
  mobile:true
});
await wait(300);
await evaluate("(()=>{const b=document.querySelector('.stack-toggle');if(b.getAttribute('aria-expanded')==='false')b.click()})()");
await wait(100);
assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile must not overflow horizontally');
assert.deepEqual(await evaluate(layoutCheck),{visible:true,separated:true,fullGlobals:true,fullParametrics:true},'Mobile labels must remain complete and separated');
const mobile=await call('Page.captureScreenshot',{
  format:'png',
  captureBeyondViewport:true
});
await saveArtifact('mobile.png',mobile.data);
const bad=await evaluate("lrc.loadFiles([new File(['bad'],'broken.acr')]).then(()=>false).catch(()=>document.querySelector('[data-stage=acr]').classList.contains('failed'))");
assert.equal(bad,true,'Corrupt ACR must report stage failure');
await evaluate("lrc.loadFiles([testSamples.find(f=>/acr$/i.test(f.name))])");
await evaluate("(async()=>{const f=testSamples.find(f=>/xmp$/i.test(f.name));const xml=(await f.text()).replace(/crs:MaskDigest=\"[A-F0-9]{32}\"/, 'crs:MaskDigest=\"00000000000000000000000000000000\"');await lrc.loadFiles([new File([xml],'missing.xmp')]);})()");
assert.equal(await evaluate("document.querySelector('#compile').disabled&&document.querySelector('[data-stage=compile]').classList.contains('failed')"),
true,'Missing digest must block compilation visibly');
await evaluate("lrc.loadFiles([testSamples.find(f=>/xmp$/i.test(f.name))])");
const estimated=await evaluate(`(async()=>{
  const file=testSamples.find(f=>/arw$/i.test(f.name)),buffer=await file.arrayBuffer();
  const pointer=lrc.state.arw.ifds[0].entries.find(e=>e.tag===0xc634);
  new DataView(buffer).setUint32(pointer.at,buffer.byteLength+8,lrc.state.arw.byteOrder==='II');
  await lrc.loadFiles([new File([buffer],'estimated.ARW')]);
  return lrc.state.arw.whiteBalance.estimated&&document.querySelector('#input-facts').textContent.includes('as-shot WB: estimated');
})()`);
assert.equal(estimated,true,'Unusable SR2 must display estimated WB and keep the preview usable');
await evaluate("lrc.loadFiles([testSamples.find(f=>/arw$/i.test(f.name))])");
if(!process.argv.includes('--full')){
  await call('Emulation.setEmulatedMedia',{
    features:[{
      name:'prefers-reduced-motion',
      value:'no-preference'
    }]
  });
  const started=Date.now();
  await evaluate('lrc.compile()');
  assert.ok(Date.now()-started>=5000,'Animation should dwell on real passes');
  console.log('NORMAL MOTION and error recovery pass');
}
assert.equal(errors.length,0);
console.log('PASS · JXL decode, GPU passes, output encoding, intermediate selection, pass bypass, unclipped labels, mobile layout, WB fallback, corrupt-file recovery, missing digest.');
ws.close();
