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
const directory=process.argv[2];
if(!directory)throw new Error('Usage: node test/browser.mjs <sample-directory> [--full] [--screenshots]');
const screenshots=process.argv.includes('--screenshots');
async function saveArtifact(name,data){
  if(!screenshots)return;
  await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});
  await writeFile(new URL(`./artifacts/${name}`,import.meta.url),Buffer.from(data,'base64'));
}
const tabs=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json()),tab=tabs.find(t=>t.type==='page');
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
await until('!!window.lrc');
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
assert.deepEqual(await evaluate(layoutCheck),{visible:true,separated:true,fullGlobals:true,fullParametrics:true},'Desktop labels must be complete, readable and separated');
if(process.argv.includes('--full'))await evaluate("document.querySelector('#fullres').checked=true");
const compiled=await evaluate('window.lrc.compile().then(output=>({ok:true,output})).catch(e=>({error:e.message,logs:lrc.state.logs}))');
console.log('COMPILE',compiled);
assert.equal(compiled.ok,true);
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
