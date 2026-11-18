import assert from 'node:assert/strict';
export async function regressionChecks(evaluate,call){
  const slider=await evaluate(`(()=>{const range=document.querySelector('#compare');return [10,35,50,80].map(value=>{
    range.value=value;range.dispatchEvent(new Event('input',{bubbles:true}));
    const c=document.querySelector('#compare-before'),r=c.getBoundingClientRect();
    const edge=r.left+r.width*(1-parseFloat(getComputedStyle(c).clipPath.split(' ')[1])/100);
    const center=s=>{const b=document.querySelector(s).getBoundingClientRect();return b.left+b.width/2};
    return {value,edge,divider:center('.compare-divider'),handle:center('.compare-divider span')};
  })})()`);
  for(const r of slider){assert.ok(Math.abs(r.edge-r.divider)<=1);assert.ok(Math.abs(r.edge-r.handle)<=1);}
  await evaluate("(()=>{const b=document.querySelector('.stack-toggle');if(b.getAttribute('aria-expanded')==='true')b.click();document.querySelector('#compile').focus()})()");
  const key=async(key,code,n,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(text?{text}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n});};
  await key('Tab','Tab',9);
  assert.equal(await evaluate("document.activeElement.matches('.stack-toggle')"),true);
  await key('Enter','Enter',13,'\r');
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'true');
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
  await evaluate("document.querySelector('.slice').click()");
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')==='true'&&document.querySelector('#output-name').textContent==='Compiled framebuffer'"),true,'First collapsed slice click expands without inspecting');
  await evaluate("document.querySelector('#stack').click()");
  assert.equal(await evaluate("document.querySelector('.stack-toggle').getAttribute('aria-expanded')"),'false','Empty area packs the stack');
  const reel=await evaluate(`(async()=>{
    const {canvas,frame}=await lrcReel.makeRenderer(),p=lrcReel.prepare().timeline;
    const first=frame(0),rect=first.photoRect;
    let maxDeviation=0,unsafe=0,emptyPanelFrames=0,sliceFrames=0,outsideSlot=0;
    for(let i=0;i<Math.round(p.duration*30);i++){
      const m=frame(i/30);
      maxDeviation=Math.max(maxDeviation,...Object.keys(rect).map(k=>Math.abs(m.photoRect[k]-rect[k])));
      unsafe+=Number(m.text.some(t=>t.left<60||t.right>960||t.top<250||t.bottom>1480));
      if(['hook','rewind','loop'].includes(m.scene)&&m.panelDrawn)emptyPanelFrames++;
      if(m.slices.length){
        sliceFrames++;const b=m.sliceBox.rect,s=m.panelRect;
        outsideSlot+=Number(b.x<s.x||b.y<s.y||b.x+b.w>s.x+s.w||b.y+b.h>s.y+s.h);
      }
    }
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
    return {frames:Math.round(p.duration*30),rect,maxDeviation,unsafe,emptyPanelFrames,sliceFrames,outsideSlot,beats,hold:{changedPixels,maxChannelDelta},hookFonts:first.text.filter(t=>t.text!=='/ framebuffer').map(t=>t.font)};
  })()`);
  for(const k of ['maxDeviation','unsafe','emptyPanelFrames','outsideSlot'])assert.equal(reel[k],0,k);
  assert.ok(reel.sliceFrames>0);
  for(const b of reel.beats){
    if(['rewind','camera','program'].includes(b.scene)){assert.ok(b.early.length);assert.ok(b.early.every(x=>x==='stack'));assert.equal(b.earlyPanel,false);}
    if(['program','answer','hold'].includes(b.scene)){assert.deepEqual(b.late,['thumbnail']);assert.equal(b.latePanel,true);}
    if(b.scene==='program')assert.ok(b.lift>0&&b.lift<1,'Slice approaches half-beat with arrive');
  }
  assert.equal(reel.hold.changedPixels,0);assert.equal(reel.hold.maxChannelDelta,0);
  assert.ok(reel.hookFonts.every(f=>f.includes('Reel Display')));
  const colours=await evaluate(`(async()=>{
    const {buildTimeline}=await import('./reel/timeline.js');
    const canvas=color=>{const c=new OffscreenCanvas(64,64);const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,64,64);return c};
    const oklch=(h,L=.65,C=.07)=>{
      const a=C*Math.cos(h*Math.PI/180),b=C*Math.sin(h*Math.PI/180);
      const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
      const linear=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
      return 'rgb('+linear.map(v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))).join(',')+')';
    };
    const mask=canvas('#000000');mask.getContext('2d').fillStyle='#ffffff';mask.getContext('2d').fillRect(0,0,32,64);
    const run=(before,after,name='Background')=>buildTimeline(before,[{index:0,name,kind:'ai',mask,color:'#ffffff',result:after,corrections:[{LocalExposure2012:.1,masks:[{What:'Mask/Image',MaskName:name}]}]}],false);
    const families=Object.entries({red:29,orange:60,yellow:100,green:145,teal:195,blue:260,purple:300,magenta:335}).map(([family,hue])=>{
      const p=run(canvas(oklch(hue-70)),canvas(oklch(hue)));
      return {family,direction:p.scores[0].direction,cover:p.coverTitle};
    });
    const neutral=canvas('#808080');
    const parts=['Person 1 - Clothes','Person 1 - Hair','Person 1 - Facial Skin','Person 1 - Body Skin'].map(name=>run(neutral,canvas('#aaaaaa'),name).scores[0].title);
    return {families,parts,unchanged:run(neutral,neutral).scores[0].direction};
  })()`);
  for(const row of colours.families){assert.equal(row.direction,row.family);assert.equal(row.cover,'Paint the background '+row.family);}
  assert.deepEqual(colours.parts,['Clothes lift','Hair lift','Skin lift','Skin lift']);
  assert.equal(colours.unchanged,'refine');
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
  console.log('REGRESSIONS',JSON.stringify({slider,reel,colours,tint}));return {slider,reel,colours,tint,keyboardInspection:true};
}
