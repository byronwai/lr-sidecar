import assert from 'node:assert/strict';
export async function fanRegressionChecks(evaluate,call){
  const reduced=await evaluate("matchMedia('(prefers-reduced-motion:reduce)').matches");
  const media=value=>call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value}]});
  const settle=()=>evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  const toggle=()=>evaluate("document.querySelector('.stack-toggle').click()");
  const rects="[...document.querySelectorAll('.slice')].map(e=>{const r=e.getBoundingClientRect(),b=document.querySelector('#stack').getBoundingClientRect();return [r.x-b.x,r.y-b.y,r.width,r.height]})";
  await media('reduce');
  await evaluate("document.querySelector('#stack').getAnimations({subtree:true}).forEach(a=>a.finish())");await settle();
  if(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')==='false'"))await toggle();
  await settle();
  const expanded=await evaluate(rects);
  await toggle();await settle();
  const packed=await evaluate(rects);
  assert.ok(packed.every((r,i)=>!i||r[0]>packed[i-1][0]),'Fan passes run left to right');
  const z=await evaluate("[...document.querySelectorAll('.slice')].map(e=>Number(getComputedStyle(e).zIndex))");
  assert.ok(z.every((n,i)=>!i||n>z[i-1]),'Later passes are frontmost');
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
  await media('no-preference');await toggle();
  const travel=await evaluate("document.querySelector('#stack').getAnimations({subtree:true}).filter(a=>a.effect.target.matches('.slice')).map(a=>({delay:a.effect.getTiming().delay,frames:a.effect.getKeyframes().map(k=>k.transform)}))");
  assert.equal(travel.length,expanded.length);
  assert.ok(travel.every((a,i)=>a.frames[0]!==a.frames[1]&&(!i||a.delay>travel[i-1].delay)),'Each pass travels with a bottom-up stagger');
  await toggle();
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'true','Repeated toggles ignored during travel');
  await evaluate("Promise.all(document.querySelector('#stack').getAnimations({subtree:true}).map(a=>a.finished))");await settle();
  const final=await evaluate(rects);
  const positionError=Math.max(...final.flatMap((r,i)=>r.map((v,k)=>Math.abs(v-expanded[i][k]))));
  assert.ok(positionError<=1,'Travel finishes at the static expanded positions');
  await toggle();
  const reverse=await evaluate("document.querySelector('#stack').getAnimations({subtree:true}).filter(a=>a.effect.target.matches('.slice')).map(a=>a.effect.getTiming().delay)");
  assert.ok(reverse.every((d,i)=>!i||d<reverse[i-1]),'Collapse stagger runs top-down');
  await evaluate("Promise.all(document.querySelector('#stack').getAnimations({subtree:true}).map(a=>a.finished))");await settle();
  await media('reduce');await toggle();
  assert.equal(await evaluate("document.querySelector('#stack').getAnimations({subtree:true}).length"),0,'Reduced motion has no travel');
  const instant=await evaluate(rects);
  assert.ok(instant.every((r,i)=>r.every((v,k)=>Math.abs(v-expanded[i][k])<=1)),'Reduced motion immediately reaches the same endpoint');
  await toggle();await media(reduced?'reduce':'no-preference');
  return {passes:packed.length,positionError,order:true,reducedMotion:true};
}
export async function regressionChecks(evaluate,call){
  const slider=await evaluate(`(()=>{const range=document.querySelector('#compare');return [10,35,50,80].map(value=>{
    range.value=value;range.dispatchEvent(new Event('input',{bubbles:true}));
    const c=document.querySelector('#compare-before'),r=c.getBoundingClientRect();
    const edge=r.left+r.width*(1-parseFloat(getComputedStyle(c).clipPath.split(' ')[1])/100);
    const center=s=>{const b=document.querySelector(s).getBoundingClientRect();return b.left+b.width/2};
    return {value,edge,divider:center('.compare-divider'),handle:center('.compare-divider span')};
  })})()`);
  for(const r of slider){assert.ok(Math.abs(r.edge-r.divider)<=1);assert.ok(Math.abs(r.edge-r.handle)<=1);}
  const fan=await fanRegressionChecks(evaluate,call);
  await evaluate("(()=>{const b=document.querySelector('.stack-toggle');if(b.getAttribute('aria-expanded')==='true')b.click();document.querySelector('#compile').focus()})()");
  const key=async(key,code,n,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(text?{text}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n});};
  await key('Tab','Tab',9);
  assert.equal(await evaluate("document.activeElement.matches('.stack-toggle')"),true);
  await key('Enter','Enter',13,'\r');
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'true');
  await key('Escape','Escape',27);
  assert.equal(await evaluate("document.activeElement.matches('.stack-toggle')&&document.activeElement.getAttribute('aria-expanded')==='false'"),true,'Escape works while the disclosure control has focus');
  await key('Enter','Enter',13,'\r');
  await key('Tab','Tab',9);
  assert.equal(await evaluate("document.activeElement.id"),'stack');
  await key('Tab','Tab',9);await key('Enter','Enter',13,'\r');
  const end=Date.now()+10000;
  while(!await evaluate("document.querySelector('#output-name').textContent.startsWith('Pass 0')")){
    assert.ok(Date.now()<end,'Enter inspects expanded slice');await new Promise(r=>setTimeout(r,50));
  }
  await key('Escape','Escape',27);
  assert.equal(await evaluate("document.activeElement.matches('.stack-toggle')&&document.activeElement.getAttribute('aria-expanded')==='false'"),true);
  await evaluate("document.querySelector('#show-final').click();document.querySelector('#compare').value=50;document.querySelector('#compare').dispatchEvent(new Event('input'))");
  await evaluate("document.querySelector('#stack').focus()");
  await key(' ','Space',32,' ');
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'true');
  await key('Escape','Escape',27);
  await evaluate("document.querySelectorAll('.slice')[1].click()");
  const inspectEnd=Date.now()+10000;
  while(!await evaluate("document.querySelector('#output-name').textContent.startsWith('Pass 1')")){
    assert.ok(Date.now()<inspectEnd,'Collapsed card expands and then inspects its own pass');await new Promise(r=>setTimeout(r,50));
  }
  await evaluate("document.querySelector('#stack').click()");
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'false','Empty area packs the stack');
  await evaluate("document.querySelector('#show-final').click()");
  const reel=await evaluate(`(async()=>{
    const {canvas,frame}=await lrcReel.makeRenderer(),p=lrcReel.prepare().timeline;
    const first=frame(0),rect=first.photoRect;
    const x=canvas.getContext('2d',{willReadFrequently:true}),firstPixels=x.getImageData(0,0,1080,1920).data;
    let maxDeviation=0,unsafe=0,emptyPanelFrames=0,sliceFrames=0,outsideSlot=0,dimmedFrames=0,incompleteEndFrames=0;
    let splitCoverFrames=0,overfullPanels=0,curvePointFrames=0,pagedFrames=0;
    for(let i=0;i<Math.round(p.duration*30);i++){
      const m=frame(i/30);
      if(m.photoLevel!==1||m.programLevel!==1)dimmedFrames++;
      const cue=p.schedule.find(c=>i/30>=c.t0&&i/30<c.t1);
      if(['hook','loop'].includes(cue.scene)&&m.split!==0)splitCoverFrames++;
      if((m.panelRows?.length||0)>4)overfullPanels++;
      if(m.panelRows?.some(r=>/\\(\\s*\\d+\\s*,\\s*\\d+\\s*\\)/.test(r.target)))curvePointFrames++;
      if(cue&&['camera','program','answer','hold'].includes(cue.scene)&&cue.rows.length&&i>=Math.round(cue.t1*30)-3){
        if(!m.panelRows?.length||m.panelRows.some(r=>!r.complete))incompleteEndFrames++;
      }
      if(['answer','hold'].includes(cue.scene)&&m.panelRows?.map(r=>r.target).join('|')!==frame(cue.t0).panelRows?.map(r=>r.target).join('|'))pagedFrames++;
      maxDeviation=Math.max(maxDeviation,...Object.keys(rect).map(k=>Math.abs(m.photoRect[k]-rect[k])));
      unsafe+=Number(m.text.some(t=>t.left<60||t.right>960||t.top<250||t.bottom>1480));
      if(['hook','rewind','loop'].includes(m.scene)&&m.panelDrawn)emptyPanelFrames++;
      if(m.slices.length){
        sliceFrames++;const b=m.sliceBox.rect,s=m.panelRect;
        outsideSlot+=Number(b.x<s.x||b.y<s.y||b.x+b.w>s.x+s.w||b.y+b.h>s.y+s.h);
      }
    }
    frame((Math.round(p.duration*30)-1)/30);const lastPixels=x.getImageData(0,0,1080,1920).data;
    let loopDelta=0;for(let n=0;n<firstPixels.length;n+=4)for(let k=0;k<3;k++)loopDelta+=Math.abs(firstPixels[n+k]-lastPixels[n+k]);
    loopDelta/=1080*1920*3;
    const answers=p.schedule.filter(c=>c.scene==='answer').map(c=>({duration:c.t1-c.t0,restSplit:frame(c.t0+.5).split}));
    const beats=p.schedule.filter(c=>['rewind','camera','program','answer','hold'].includes(c.scene)).map(c=>{
      const a=frame(c.t0+.1),b=frame(c.t0+.4);
      return {scene:c.scene,index:c.pass?.index,early:a.slices.map(s=>s.mode),late:b.slices.map(s=>s.mode),earlyPanel:a.panelDrawn,latePanel:b.panelDrawn,
        lift:c.scene==='program'?a.slices.find(s=>s.active)?.lift:null};
    });
    const hold=p.schedule.find(c=>c.scene==='hold');let changedPixels=0,maxChannelDelta=0;
    if(hold){
      const x=canvas.getContext('2d',{willReadFrequently:true});frame(hold.t0+.2);const a=x.getImageData(0,0,1080,1920).data;
      frame(hold.t0+.4);const b=x.getImageData(0,0,1080,1920).data;
      for(let y=Math.ceil(rect.y+2);y<rect.y+rect.h-2;y++)for(let xx=Math.ceil(rect.x+2);xx<rect.x+rect.w-2;xx++){
        if(xx>=53&&xx<=947&&y>=1132&&y<=1471)continue;
        const n=(y*1080+xx)*4,d=Math.max(...[0,1,2].map(k=>Math.abs(a[n+k]-b[n+k])));
        if(d)changedPixels++;maxChannelDelta=Math.max(maxChannelDelta,d);
      }
    }
    return {frames:Math.round(p.duration*30),rect,maxDeviation,unsafe,emptyPanelFrames,sliceFrames,outsideSlot,dimmedFrames,incompleteEndFrames,
      splitCoverFrames,overfullPanels,curvePointFrames,pagedFrames,loopDelta,answers,beatGrid:p.schedule.every(c=>Number.isInteger(c.t0*2)&&Number.isInteger(c.t1*2)),
      payoff:p.schedule.find(c=>c.scene==='payoff').t1-p.schedule.find(c=>c.scene==='payoff').t0,
      beats,hold:{changedPixels,maxChannelDelta},hookFonts:first.text.filter(t=>t.text!=='LIGHTROOM').map(t=>t.font)};
  })()`);
  for(const k of ['maxDeviation','unsafe','emptyPanelFrames','outsideSlot','dimmedFrames','incompleteEndFrames'])assert.equal(reel[k],0,k);
  for(const k of ['splitCoverFrames','overfullPanels','curvePointFrames','pagedFrames','loopDelta'])assert.equal(reel[k],0,k);
  assert.equal(reel.beatGrid,true);assert.ok(reel.payoff>=1.5);
  assert.ok(reel.answers.length>0);for(const a of reel.answers){assert.equal(a.duration,1);assert.equal(a.restSplit,0);}
  assert.ok(reel.sliceFrames>0);
  for(const b of reel.beats){
    if(['rewind','camera','program'].includes(b.scene)){assert.ok(b.early.length);assert.ok(b.early.every(x=>x==='stack'));assert.equal(b.earlyPanel,false);}
    if(['program','answer','hold'].includes(b.scene)){assert.deepEqual(b.late,['thumbnail']);assert.equal(b.latePanel,true);}
    if(b.scene==='program')assert.ok(b.lift>0&&b.lift<1,'Slice approaches half-beat with arrive');
  }
  assert.equal(reel.hold.changedPixels,0);assert.equal(reel.hold.maxChannelDelta,0);
  assert.ok(reel.hookFonts.every(f=>f.includes('Reel Display')));
  const panelChoices=await evaluate(`(async()=>{
    const {buildTimeline}=await import('./reel/timeline.js');
    const solid=color=>{const c=new OffscreenCanvas(64,64);const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,64,64);return c};
    const before=solid('#808080'),after=solid('#b0b0b0');
    const correction={LocalExposure2012:.001,LocalTemperature:.01,LocalTint:.2,LocalSaturation:.15,
      LocalHighlights2012:.5,LocalShadows2012:.6,LocalContrast2012:.4,MainCurve:['0,0','128,100','255,255'],
      masks:[{What:'Mask/Image',MaskName:'Subject 1'}]};
    const local=buildTimeline(before,[{index:0,name:'Subject 1',kind:'ai',result:after,corrections:[correction]}],false);
    const global=buildTimeline(before,[{index:0,kind:'globals',result:after,asShotKelvin:6000,
      globals:{Temperature:6500,Exposure2012:.01,Tint:50,Highlights2012:40}}],false);
    const colour=buildTimeline(before,[{index:0,name:'Background',kind:'ai',result:solid('#5486b0'),
      corrections:[{LocalExposure2012:.1,LocalHighlights2012:.2,RedCurve:['0,30','128,150','255,255'],masks:[{What:'Mask/Image',MaskName:'Background'}]}]}],false);
    return {local:local.schedule.find(c=>c.scene==='program').rows,global:global.schedule.find(c=>c.scene==='camera').rows,
      colour:colour.schedule.find(c=>c.scene==='program').rows};
  })()`);
  assert.deepEqual(panelChoices.local.map(r=>r.label||r.text),['Subject 1','Exposure','Tint','Shadows'],'Exposure, strongest colour, then strongest tone; omit incidental RGB curve');
  assert.deepEqual(panelChoices.global.map(r=>r.label||r.text),['WB','Exposure','Highlights'],'WB, exposure, then range-normalized strongest other move');
  assert.ok(panelChoices.colour.some(r=>r.text==='Red curve · 3 pts'),'A colour-driving curve gets exactly one summary row');
  assert.ok(panelChoices.colour.length<=4);
  const encodedLoop=await evaluate(`(async()=>{
    const result=await lrcReel.export(),v=document.querySelector('#reel-preview');v.pause();
    if(!v.videoWidth)await new Promise(r=>v.addEventListener('loadedmetadata',r,{once:true}));
    const c=new OffscreenCanvas(1080,1920),x=c.getContext('2d',{willReadFrequently:true});
    const read=async time=>{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Loop seek timeout')),15000);
      v.addEventListener('seeked',()=>{clearTimeout(timer);resolve()},{once:true});v.currentTime=time});
      x.drawImage(v,0,0);return x.getImageData(0,0,1080,1920).data};
    const a=await read(.5/30),b=await read(result.duration-.5/30);
    let delta=0;for(let n=0;n<a.length;n+=4)for(let k=0;k<3;k++)delta+=Math.abs(a[n+k]-b[n+k]);
    return {delta:delta/(1080*1920*3),mode:result.mode};
  })()`);
  assert.equal(encodedLoop.delta,0,'Decoded first/last MP4 frames match exactly');
  const overlay=await evaluate(`(async()=>{
    const {createScene}=await import('./reel/scene.js');
    const solid=color=>{const c=new OffscreenCanvas(64,64),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,64,64);return c};
    const original=solid('#808080'),mask=solid('#e4c46a');
    const canvas=new OffscreenCanvas(1080,1920),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const pass={index:0,mask,color:'#e4c46a'};
    const rows=[{label:'WB',from:7201,value:6900,decimals:0},{label:'Exposure',from:0,value:-.11,decimals:2}];
    const chapter={pass,before:original,after:original,title:'Background darker',chip:'Background',color:'#edb47c',rows};
    const timeline={duration:1.5,chapterCount:1,coverTitle:'One frame. Many edits.',schedule:[
      {t0:0,t1:.5,scene:'hook',lead:'photo'},
      {t0:.5,t1:1,scene:'program',lead:'program',...chapter},
      {t0:1,t1:1.5,scene:'answer',lead:'photo',...chapter}]};
    const {frame}=createScene(ctx,{original,compiled:original,timeline});
    let maxInteriorError=0,emptyPanels=0,wrongNumbers=0;
    for(let i=15;i<30;i++){
      const m=frame(i/30),bytes=ctx.getImageData(100,650,800,350).data;
      for(let n=0;n<bytes.length;n+=4)for(let k=0;k<3;k++)maxInteriorError=Math.max(maxInteriorError,Math.abs(bytes[n+k]-128));
      if(m.panelDrawn&&!m.panelRows.some(r=>r.text))emptyPanels++;
      for(const r of m.panelRows||[])if(!['WB 7201 → 6900 K','Exposure 0.00 → −0.11'].some(s=>s.startsWith(r.text)))wrongNumbers++;
    }
    return {maxInteriorError,emptyPanels,wrongNumbers,lastRows:frame(29/30).panelRows};
  })()`);
  for(const k of ['maxInteriorError','emptyPanels','wrongNumbers'])assert.equal(overlay[k],0,k);
  assert.ok(overlay.lastRows.every(r=>r.complete),'Every row finishes before the cut');
  const tint=await evaluate(`(async()=>{
    const {Pipeline}=await import('./render/gl.js');
    const input=new OffscreenCanvas(16,16),ctx=input.getContext('2d');ctx.fillStyle='#cccccc';ctx.fillRect(0,0,16,16);
    const p=new Pipeline(input,16,16);
    try{
      const read=(saturation,mask)=>Array.from(p.pixels(p.correction(p.input,{LocalToningHue:230,LocalToningSaturation:saturation},{texture:mask})).data.slice(0,3));
      const before=read(0,p.white),after=read(.345,p.white),outside=read(.345,p.zero);
      const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4};
      const y=rgb=>rgb.map(linear).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      return {before,after,outside,luminanceBefore:y(before),luminanceAfter:y(after),relativeLuminanceError:Math.abs(y(before)-y(after))/y(before)};
    }finally{p.dispose()}
  })()`);
  assert.deepEqual(tint.outside,tint.before,'Zero mask leaves pixels untouched');
  assert.ok(tint.after[2]>tint.after[0]+10,'Local Color makes blue pixels');
  assert.ok(tint.relativeLuminanceError<.01,'Linear luminance survives gamut fitting');
  console.log('REGRESSIONS',JSON.stringify({slider,fan,reel,panelChoices,encodedLoop,overlay,tint}));return {slider,fan,reel,panelChoices,encodedLoop,overlay,tint,keyboardInspection:true};
}
