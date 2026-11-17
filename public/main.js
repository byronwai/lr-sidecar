import {
  parseXMP,
  recordUsage
} from './formats/xmp.js';
import {
  tagName
} from './formats/tiff.js';
import {
  SliceStack
} from './anim/stack.js';
import { globalSummary, correctionSummary, maskExpression } from './anim/summary.js';
const $=s=>document.querySelector(s),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c])),fmtSize=n=>n>=1048576?`${(n/1048576).toFixed(2)} MiB`:`${(n/1024).toFixed(1)} KiB`;
const state={
  files:{},
  arw:null,
  settings:null,
  acr:null,
  groups:[],
  disabled:new Set(),
  timings:{},
  correctionTimings:[],
  errors:{},
  compiling:false,
  loading:false,
  compiled:false,
  output:null,
  logs:[]
};
const worker=new Worker(new URL('./worker.js',import.meta.url),{
  type:'module'
}),pending=new Map();
let sequence=0,queue=Promise.resolve(),finalCanvas=null,urls=[],inspectQueue=Promise.resolve(),selection=0;
const reelPasses=[];
function preserveFrame(bitmap){
  const canvas=document.createElement('canvas');
  canvas.width=bitmap.width;
  canvas.height=bitmap.height;
  canvas.getContext('2d').drawImage(bitmap,0,0);
  return canvas;
}
const stack=new SliceStack($('#stack'),index=>inspect(index));
const placeholder=[['Global settings','#5aa9ff','The camera preview + XMP globals'],['Generative Remove','#ff5fa2',
'Chosen patch + its blend mask'],['AI selection','#5aa9ff','Content-addressed ACR mask'],['AI selection','#ffa24a',
'A second local correction'],['AI selection','#5ee08a','A third local correction'],['Parametric masks','#b98cff',
'Gradients · range · paint']].map(([name,color,source],i)=>({
  name,
  color,
  source,
  kind:i===5?'parametric':'placeholder',
  parameters:['Waiting for your edit instructions']
}));
stack.setGroups(placeholder);
$('#explode').addEventListener('input',e=>stack.setSeparation(Number(e.target.value)));
stack.setSeparation(Number($('#explode').value));
function log(message){
  state.logs.push(message);
  $('#compile-log').textContent=state.logs.join('\n');
}
function stage(name,status,text,ms){
  const el=$(`[data-stage="${name}"]`);
  if(!el)return;
  el.className=status;
  el.querySelector('small').textContent=`${text}${ms!=null?` · ${(ms/1000).toFixed(2)} s`:''}`;
  if(ms!=null)state.timings[name]=ms;
}
function slot(name,status,text){
  const el=$(`[data-slot="${name}"]`);
  if(!el)return;
  el.className=`slot ${status}`;
  const f=state.files[name];
  el.querySelector('span').textContent=f?.name||text;
  el.querySelector('small').textContent=f?`${fmtSize(f.size)} · ${text}`:text;
}
function draw(canvas,bitmap){
  canvas.width=bitmap.width;
  canvas.height=bitmap.height;
  canvas.getContext('2d').drawImage(bitmap,0,0);
  canvas.hidden=false;
  canvas.parentElement.querySelector('.empty').hidden=true;
  bitmap.close();
}
function table(rows,headers=['Setting','Value']){
  return `<table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${escape(typeof v==='object'?JSON.stringify(v):v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function fail(name,message){
  state.errors[name]=message;
  stage(name,'failed',message);
  slot(name,'failed',message);
  $('#status').textContent=`${name.toUpperCase()}: ${message}`;
  log(`ERROR [${name}] ${message}`);
  const el=$(`#${name}-details`);
  if(el){
    const p=document.createElement('p');
    p.className='error';
    p.textContent=message;
    el.prepend(p);
  }
  updateReady();
}
function request(type,payload={},transfer=[]){
  return new Promise((resolve,reject)=>{
    const job=++sequence;
    pending.set(job,{
      resolve,
      reject,
      type
    });
    worker.postMessage({
      type,
      job,
      ...payload
    },transfer);
  });
}
worker.addEventListener('message',async({
  data:m
})=>{
  if(m.type==='progress'){
    stage(m.stage,'loading',m.message);
    $('#status').textContent=m.message;
    return;
  }
  if(m.type==='log'){
    log(m.message);
    return;
  }
  if(m.type==='correction'){
    state.correctionTimings.push(m);
    log(`  ${m.name}: ${m.ms.toFixed(1)} ms`);
    return;
  }
  if(m.type==='face'){
    stack.face(m.index,m.face);
    return;
  }
  if(m.type==='pass-start'){
    stack.start(m.index);
    $('#status').textContent=`Rendering pass ${m.index} · ${m.name}`;
    return;
  }
  if(m.type==='pass-done'){
    if(m.enabled){
      const {name,kind,source,color}=state.groups[m.index];
      reelPasses.push({
        name,kind,source,color,
        mask:kind==='globals'?null:preserveFrame(m.face),
        result:preserveFrame(m.bitmap)
      });
    }
    stack.face(m.index,m.face);
    stack.done(m.index,m.ms);
    m.bitmap.close();
    state.groups[m.index].ms=m.ms;
    state.groups[m.index].rendered=true;
    log(`Pass ${m.index} · ${state.groups[m.index].name}: ${m.ms.toFixed(1)} ms${m.enabled?'':' (bypassed)'}`);
    passControls();
    return;
  }
  const waiter=pending.get(m.job);
  if(!waiter){
    m.bitmap?.close();
    return;
  }
  pending.delete(m.job);
  if(m.type==='error')waiter.reject(new Error(m.message));
  else waiter.resolve(m);
});
worker.addEventListener('error',e=>{
  for(const p of pending.values())p.reject(new Error(e.message||'Worker failed to load'));
  pending.clear();
  fail('compile',e.message||'Worker failed to load');
});
function buildGroups(){
  const parameters=globalSummary(state.settings.globals);
  const groups=[{
    name:'Global settings',
    kind:'globals',
    color:'#5aa9ff',
    source:'ARW preview × XMP globals',
    parameters
  }];
  if(state.settings.remove.length)groups.push({
    name:'Generative Remove',
    kind:'remove',
    color:'#ff5fa2',
    source:`ACR · ${state.settings.remove.length} chosen patch${state.settings.remove.length===1?'':'es'}`,
    parameters:state.settings.remove.map((r,i)=>`${i+1}. ${r.SpotType} · ${String(r.pm_patch).slice(0,8)}…`)
  });
  state.settings.corrections.forEach((c,index)=>{
    const active=c.masks.filter(m=>m.MaskActive!==false),
    rasters=new Set(active.filter(m=>m.What==='Mask/Image').map(m=>m.MaskDigest)),
    ai=active.length&&active.every(m=>m.What==='Mask/Image'),
    names=active.map(m=>m.MaskName||m.What.replace('Mask/',''));
    const color=/subject/i.test(names.join(' '))?'#ffa24a':/vegetation/i.test(names.join(' '))?'#5ee08a':'#5aa9ff',
    lines=[correctionSummary(c)];
    if(!rasters.size&&groups.at(-1).kind==='parametric'){
      groups.at(-1).corrections.push(index);
      groups.at(-1).parameters.push(...lines);
    }
    else groups.push({
      name:ai?maskExpression(active,m=>m.MaskName||'AI'):rasters.size?'AI + parametric masks':'Parametric masks',
      kind:ai?'ai':rasters.size?'mixed':'parametric',
      color:ai?color:'#b98cff',
      source:rasters.size?`ACR · ${rasters.size} raster(s)${ai?'':' + XMP mask geometry'}`:'XMP · recomputed each render',
      corrections:[index],
      parameters:lines
    });
  });
  return groups;
}
function validateBindings(){
  if(!state.settings||!state.acr)return [];
  const ids=new Set(state.acr.records.filter(r=>r.kind==='raster').map(r=>r.id));
  return [...recordUsage(state.settings)].filter(([id])=>!ids.has(id)).map(([id,usage])=>`${id} (${usage.join(', ')})`);
}
function sourceMismatch(){
  const arw=state.arw?.capturedAt?.slice(0,19);
  const xmp=state.settings?.capturedAt?.slice(0,19);
  const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  if(timestamp.test(arw)&&timestamp.test(xmp)&&arw.slice(0,10)!==xmp.slice(0,10)){
    return `Capture dates differ · ARW ${arw.replace('T',' ')} · XMP ${xmp.replace('T',' ')}. Choose the ARW from the XMP capture date.`;
  }
}
function updateReady(){
  const missing=validateBindings(),
  mismatch=sourceMismatch(),
  ready=state.arw&&state.settings&&state.acr&&!mismatch&&!missing.length&&!Object.keys(state.errors).some(k=>k!=='compile');
  $('#compile').disabled=!ready||state.compiling||state.loading;
  $('#replay').disabled=!state.compiled||state.compiling||state.loading;
  $('#files').disabled=state.compiling||state.loading;
  $('#fullres').disabled=state.compiling||state.loading;
  if(mismatch){
    $('#status').textContent=mismatch;
    stage('compile','failed','ARW and XMP capture dates differ');
  }else if(missing.length){
    $('#status').textContent=`Missing ACR raster: ${missing.join('; ')}`;
    stage('compile','failed',`Missing ${missing.length} referenced raster(s)`);
  }else if(ready&&!state.compiling&&!state.loading)$('#status').textContent=state.compiled?'Compile complete · select any slice to inspect':'All textures resolved · ready to compile';
}
function passControls(){
  $('#pass-controls').innerHTML=state.groups.map((g,i)=>`<div class="pass-control"><label><input type="checkbox" data-pass="${i}" ${state.disabled.has(i)?'':'checked'} ${state.compiling?'disabled':''}><span style="color:${g.color}">pass ${i} · ${escape(g.name)}</span></label><small>${g.ms!=null?`${g.ms.toFixed(1)} ms`:'not rendered'}</small><button data-inspect="${i}" ${!state.compiled||state.compiling?'disabled':''}>Inspect</button></div>`).join('');
  $('#pass-controls').querySelectorAll('[data-pass]').forEach(el=>el.addEventListener('change',()=>{
    const i=+el.dataset.pass;
    if(el.checked)state.disabled.delete(i);
    else state.disabled.add(i);
    stack.enabled(i,el.checked);
    compile().catch(()=>{});
  }));
  $('#pass-controls').querySelectorAll('[data-inspect]').forEach(el=>el.addEventListener('click',()=>inspect(+el.dataset.inspect)));
}
function showXMP(){
  const s=state.settings;
  $('#xmp-details').innerHTML=`<h4>Global settings</h4>${table(Object.entries(s.globals))}<h4>${s.corrections.length} corrections · stored XMP order</h4>${s.corrections.map(c=>`<details><summary>${escape(c.name)} · ${c.masks.length} component(s)</summary>${table(Object.entries(c).filter(([k])=>!['CorrectionMasks','masks','name'].includes(k)))}<pre>${escape(JSON.stringify(c.masks,null,2))}</pre></details>`).join('')}<h4>RemoveAreas</h4><pre>${escape(JSON.stringify(s.remove,null,2))}</pre>`;
}
function showACR(){
  if(!state.acr)return;
  const a=state.acr,
  usage=state.settings?recordUsage(state.settings):new Map(),
  missing=validateBindings();
  $('#acr-details').innerHTML=`<p>ACR v${a.version} · source ${escape(a.source)} · ${a.count} records · reserved ${a.reserved}</p>${missing.length?`<p class="error">Missing raster: ${escape(missing.join('; '))}</p>`:''}${table(a.records.map(r=>[r.id.slice(0,12)+'…',r.kind,r.width?`${r.width} × ${r.height}`:`${r.receipt?.length} inflated bytes`,r.channels||'—',`${r.size} @ ${r.offset}`,r.md5Match?'✓ match':r.kind==='receipt'?'Receipt differs (finding)':'MISMATCH',(usage.get(r.id)||[r.kind==='receipt'?'Generative Remove receipt':'Unreferenced']).join('; ')]),['MD5','Kind','Dimensions','Ch','Bytes / offset','MD5 check','XMP use'])}${a.records.filter(r=>r.receipt).map(r=>`<h4>Receipt · prefix ${escape(r.receipt.prefix)}</h4><p>Table digest ${r.id}; actual ${r.actualMD5}. Adobe can edit this receipt on re-export.</p><pre>${escape(r.receipt.xml)}</pre>`).join('')}`;
}
function invalidate(){
  selection++;
  state.compiled=false;
  state.output=null;
  state.correctionTimings=[];
  state.errors.compile&&delete state.errors.compile;
  urls.forEach(URL.revokeObjectURL);
  urls=[];
  finalCanvas=null;
  reelPasses.length=0;
  $('#show-final').disabled=true;
  $('#output').hidden=true;
  $('#output-frame .empty').hidden=false;
  $('#output-name').textContent='Your edit, compiled';
  $('#output-facts').textContent='Waiting for compilation';
  for(const id of ['download-png','download-jpg']){
    const a=$('#'+id);
    a.removeAttribute('href');
    a.classList.add('disabled');
    a.setAttribute('aria-disabled','true');
  }
  stage('compile','','waiting');
}
async function loadOne(file,extension){
  invalidate();
  state.files[extension]={
    name:file.name,
    size:file.size
  };
  delete state.errors[extension];
  if(extension==='arw')state.arw=null;
  if(extension==='xmp')state.settings=null;
  if(extension==='acr')state.acr=null;
  stage(extension,'loading','reading');
  slot(extension,'loading','reading');
  const started=performance.now();
  try{
    if(extension==='xmp'){
      state.settings=parseXMP(await file.text());
      state.groups=buildGroups();
      state.disabled.clear();
      stack.setGroups(state.groups);
      showXMP();
      passControls();
      stage('xmp','ready',`${state.settings.corrections.length} corrections`,performance.now()-started);
      slot('xmp','ready','parsed');
    }
    else {
      const buffer=await file.arrayBuffer(),
      result=await request(extension,{
        buffer
      },[buffer]);
      state[extension]=result.report;
      stage(extension,'ready',extension==='arw'?'preview extracted':`${result.report.count} records decoded`,result.ms);
      slot(extension,'ready','parsed');
      if(extension==='arw'){
        const r=result.report;
        draw($('#input'),result.bitmap);
        $('#input-name').textContent=file.name;
        const wb=r.whiteBalance;
        const wbText=`as-shot WB: ${wb.estimated?'estimated ':''}≈${Math.round(wb.kelvin)} K${wb.estimated?'':' (SR2-derived)'}`;
        $('#input-facts').textContent=`${r.chosen.width} × ${r.chosen.height} JPEG · ${fmtSize(r.chosen.length)} · orientation ${r.orientation} · ${wbText}`;
        $('#arw-details').innerHTML=`<p>${escape(r.byteOrder)} endian · ${r.previews.length} JPEG preview(s) · chosen ${escape(r.chosen.source)}</p>${r.sensor.map(s=>`<p>Ignored sensor data: ${s.width} × ${s.height} · ${fmtSize(s.bytes)}</p>`).join('')}${r.ifds.map(ifd=>`<h4>${escape(ifd.name)} @ ${ifd.offset} → ${ifd.next||'end'}</h4>${table(ifd.entries.map(e=>[tagName(e.tag),e.type,e.count,e.value??'unsupported']),['Tag','Type','Count','Value'])}`).join('')}`;
        $('#arw-details').insertAdjacentHTML('afterbegin',`<h4>${escape(wbText)}</h4>${table(Object.entries(wb))}<p>CCT comes from camera Kelvin presets. Tint is an approximate log-gain proxy; the private colour matrix is reported without assuming its colour-space basis.</p>`);
        log(`${wbText} · ${wb.method}${wb.reason?` · ${wb.reason}`:''}`);
      }
    }
    showACR();
    log(`${extension.toUpperCase()} parsed · ${file.name}`);
  }catch(error){
    fail(extension,error.message);
    throw error;
  }
}
async function loadFiles(files){
  await inspectQueue;
  if(state.compiling)throw new Error('Wait for compilation before loading another edit');
  const list=Array.from(files),
  recognised=[];
  const seen=new Set();
  for(const f of list){
    const ext=f.name.split('.').pop().toLowerCase();
    if(!['arw','xmp','acr'].includes(ext))throw new Error(`Unsupported file ${f.name}; choose ARW, XMP, ACR`);
    if(seen.has(ext))throw new Error(`Choose one ${ext.toUpperCase()} per edit`);
    seen.add(ext);
    recognised.push([f,ext]);
  }
  if(!recognised.length)throw new Error('No files selected');
  state.loading=true;
  updateReady();
  $('#intake-error').hidden=true;
  try{
    for(const [f,ext]of recognised)await loadOne(f,ext);
    if(state.arw&&state.settings&&state.acr&&!sourceMismatch()&&!validateBindings().length){
      $('#status').textContent='Preparing real texture slices';
      try{
        await request('faces',{
          settings:state.settings,
          groups:state.groups
        });
      }catch(error){
        fail('compile',error.message);
      }
    }
  }finally{
    state.loading=false;
    updateReady();
  }
  return state;
}
async function compile(){
  await inspectQueue;
  if(state.compiling||state.loading)throw new Error('Wait for the current operation');
  if(!state.arw||!state.settings||!state.acr)throw new Error('Load ARW, XMP and ACR first');
  const mismatch=sourceMismatch();
  if(mismatch)throw new Error(mismatch);
  const missing=validateBindings();
  if(missing.length)throw new Error(`Missing ACR raster: ${missing.join('; ')}`);
  state.compiling=true;
  invalidate();
  updateReady();
  passControls();
  const start=performance.now();
  stage('compile','loading','running');
  log(`\nCompile · ${$('#fullres').checked?'full preview resolution':'long edge ≤ 3072'} · JPEG-based approximation`);
  try{
    await stack.begin();
    const m=await request('compile',{
      settings:state.settings,
      groups:state.groups,
      disabled:[...state.disabled],
      fullRes:$('#fullres').checked,
      animate:!stack.reduced.matches
    });
    state.output={
      width:m.width,
      height:m.height,
      workingWidth:m.workingWidth,
      workingHeight:m.workingHeight,
      crop:m.crop
    };
    finalCanvas=document.createElement('canvas');
    finalCanvas.width=m.bitmap.width;
    finalCanvas.height=m.bitmap.height;
    finalCanvas.getContext('2d').drawImage(m.bitmap,0,0);
    $('#output-frame').classList.add('encoding');
    draw($('#output'),m.bitmap);
    for(const [id,blob,ext]of [['download-png',m.png,'png'],['download-jpg',m.jpg,'jpg']]){
      const url=URL.createObjectURL(blob);
      urls.push(url);
      const a=$('#'+id);
      a.href=url;
      a.download=`${state.files.arw.name.replace(/\.arw$/i,'')}-compiled.${ext}`;
      a.classList.remove('disabled');
      a.setAttribute('aria-disabled','false');
    }
    $('#output-name').textContent='Compiled framebuffer';
    $('#output-facts').textContent=`${m.width} × ${m.height} · crop ${((m.crop.storedWidth??1)*100).toFixed(2)}% sensor width · ${m.crop.angle.toFixed(2)}°`;
    $('#output-note').textContent=`Working texture ${m.workingWidth} × ${m.workingHeight}. PNG / JPG downloads contain the complete output.`;
    await stack.finish();
    state.compiled=true;
    $('#show-final').disabled=false;
    stage('compile','ready','complete',performance.now()-start);
    log(`Encode: ${m.width} × ${m.height} · PNG ${fmtSize(m.png.size)} · JPG ${fmtSize(m.jpg.size)}`);
    return state.output;
  }catch(error){
    fail('compile',error.message);
    $('#stack').classList.remove('running','assembling','flying','collapsing');
    $('#output-frame').classList.remove('encoding');
    throw error;
  }
  finally{
    state.compiling=false;
    updateReady();
    passControls();
  }
}
function inspect(index){
  const selected=++selection;
  inspectQueue=inspectQueue.catch(()=>{}).then(async()=>{
    if(!state.compiled||state.compiling||state.loading||selected!==selection)return;
    try{
      const result=await request('show',{
        index
      });
      if(selected!==selection){
        result.bitmap.close();
        return;
      }
      draw($('#output'),result.bitmap);
      $('#output-name').textContent=`Pass ${index} · ${state.groups[index].name}`;
      $('#output-note').textContent='Intermediate with final orientation and crop. Downloads still contain the final composite.';
    }catch(e){
      fail('compile',e.message);
    }
  });
  return inspectQueue;
}
function intake(files){
  // File inputs reset on selection, and drop FileLists expire after the event.
  const selected=Array.from(files);
  if(!selected.length)return queue;
  queue=queue.catch(()=>{}).then(()=>loadFiles(selected)).catch(e=>{
    $('#intake-error').textContent=e.message;
    $('#intake-error').hidden=false;
  });
  return queue;
}
$('#files').addEventListener('change',e=>{
  intake(e.target.files);
  e.target.value='';
});
for(const name of ['dragenter','dragover'])$('#dropzone').addEventListener(name,e=>{
  e.preventDefault();
  $('#dropzone').classList.add('dragover');
});
$('#dropzone').addEventListener('dragleave',e=>{
  if(!$('#dropzone').contains(e.relatedTarget))$('#dropzone').classList.remove('dragover');
});
$('#dropzone').addEventListener('drop',e=>{
  e.preventDefault();
  $('#dropzone').classList.remove('dragover');
  intake(e.dataTransfer.files);
});
$('#compile').addEventListener('click',()=>compile().catch(()=>{}));
$('#replay').addEventListener('click',()=>compile().catch(()=>{}));
$('#show-final').addEventListener('click',()=>{
  if(!finalCanvas)return;
  const c=$('#output');
  c.width=finalCanvas.width;
  c.height=finalCanvas.height;
  c.getContext('2d').drawImage(finalCanvas,0,0);
  $('#output-name').textContent='Compiled framebuffer';
  $('#output-note').textContent='Final composite · downloads include every enabled pass.';
});
window.addEventListener('beforeunload',()=>{
  urls.forEach(URL.revokeObjectURL);
  worker.terminate();
});
window.lrc={
  reelPasses:()=>reelPasses.slice(),
  loadFiles:files=>{
    const task=queue.catch(()=>{}).then(()=>loadFiles(files));
    queue=task;
    return task;
  },
  compile,
  state
};
