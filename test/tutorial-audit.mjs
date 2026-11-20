// Runs in the browser. Read the original XML independently of the app's XMP parser.
export async function auditTutorial() {
  // Capture the guide paths while the scene bakes them. Only geometry layers
  // use full-Reel offscreen surfaces with stroked line segments at this stage.
  const proto=OffscreenCanvasRenderingContext2D.prototype,original={},paths=[],pending=new WeakMap();
  for(const key of ['beginPath','moveTo','lineTo','stroke']){
    original[key]=proto[key];
    proto[key]=function(...args){
      if(this.canvas.width===1080 && this.canvas.height===1920){
        if(key==='beginPath')pending.set(this,[]);
        if(key==='moveTo'||key==='lineTo')pending.get(this)?.push(args);
        if(key==='stroke'&&pending.get(this)?.length)paths.push(pending.get(this));
      }
      return original[key].apply(this,args);
    };
  }
  let renderer;
  try {renderer=await lrcReel.makeRenderer();}
  finally {for(const key of Object.keys(original))proto[key]=original[key];}
  const timeline=renderer.data.timeline;
  const xml=new DOMParser().parseFromString(lrc.state.xmpText,'application/xml');
  const ns='http://ns.adobe.com/camera-raw-settings/1.0/';
  const desc=[...xml.getElementsByTagNameNS('*','Description')];
  const root=desc.find(el=>el.hasAttributeNS(ns,'Version'));
  const corrections=desc.filter(el=>el.getAttributeNS(ns,'What')==='Correction');
  const source=index=>index<0?root:corrections[index];
  const attr=(el,key)=>el.getAttributeNS(ns,key)??[...el.children].find(c=>c.localName===key)?.textContent?.trim();
  const mismatch=[],steps=[];
  let checks=0,unsafe=0,rectDeviation=0,endOverlays=0,maxRows=0,maxSubject=0;
  function check(name,actual,expected) {
    checks++;
    if(JSON.stringify(actual)!==JSON.stringify(expected))mismatch.push({name,actual,expected});
  }
  const rect=renderer.frame(0).photoRect;
  const ctx=renderer.canvas.getContext('2d'),draw=ctx.drawImage;
  const photos=new Set(timeline.schedule.flatMap(s=>[s.before,s.after]).filter(Boolean));
  let photoDraws=0;
  ctx.drawImage=function(image,...args){
    if(photos.has(image)){
      photoDraws++;
      const expected=[rect.x,rect.y,rect.w,rect.h];
      rectDeviation=Math.max(rectDeviation,...expected.map((n,i)=>Math.abs(n-args[i])));
    }
    return draw.call(this,image,...args);
  };
  const inverse=new DOMMatrix().translate(rect.x,rect.y).scale(rect.w,rect.h)
    .multiply(new DOMMatrix(renderer.data.sources.transform)).inverse();
  const sensor=([x,y])=>inverse.transformPoint({x,y});
  let maxGuideError=0;
  function guideError(p,x,y){
    maxGuideError=Math.max(maxGuideError,Math.hypot(p.x-x,p.y-y));
  }
  const compiled=lrc.reelPasses(),selected=timeline.steps.map(s=>s.pass.index);
  const expected=timeline.all.filter(s=>s.score>=.6).sort((a,b)=>b.score-a.score).slice(0,7).map(s=>s.number).sort((a,b)=>a-b);
  check('impact selection and order',selected,expected);
  const stack=[...document.querySelectorAll('.slice-label')];
  for(const s of timeline.steps){
    check('compiled pass',compiled.find(p=>p.index===s.number)?.result===s.after,true);
    check('page stack',stack[s.number]?.textContent.includes(s.pass.name),true);
    const i=timeline.schedule.findIndex(c=>c.scene==='step' && c.number===s.number);
    const lift=timeline.schedule[i-1];
    check('initial deck',[lift.scene,lift.number,lift.t1-lift.t0],['lift',s.number,.5]);
    const start=renderer.frame(lift.t0).slices,mid=renderer.frame(lift.t0+.25).slices;
    check('paint order',start.map(v=>v.index),selected);
    check('stack heights',start.every((v,i)=>!i||v.y<start[i-1].y),true);
    check('lifting pass',mid.filter(v=>v.active&&v.lift>0&&v.lift<1).map(v=>v.index),[s.number]);
    check('settled layer',renderer.frame(lift.t1+.3).slices.map(v=>[v.mode,v.index]),[['thumbnail',s.number]]);
  }
  const min={value:Infinity,kicker:Infinity,label:Infinity,panel:Infinity};
  const strings=new Set();
  for(let i=0;i<Math.round(timeline.duration*30);i++){
    const m=renderer.frame(i/30);
    for(const token of m.text){strings.add(token.text);min[token.role]=Math.min(min[token.role],token.size);}
    if(m.panelRect)min.panel=Math.min(min.panel,m.panelRect.w/1080*100);
    for(const key of Object.keys(rect))rectDeviation=Math.max(rectDeviation,Math.abs(m.photoRect[key]-rect[key]));
    unsafe+=m.text.filter(t=>t.left<60||t.right>960||t.top<250||t.bottom>1480).length;
    maxRows=Math.max(maxRows,m.rows.length);
    maxSubject=Math.max(maxSubject,m.subjectOverlap);
    const end=timeline.schedule.find(s=>s.scene==='step'&&i>=Math.round(s.t1*30)-4&&i<Math.round(s.t1*30));
    if(end&&m.opacity!==0)endOverlays++;
  }
  ctx.drawImage=draw;
  check('photo drawn on every frame',photoDraws>=Math.round(timeline.duration*30),true);
  const caption=(await import('./reel/tutorial.js')).tutorialCaption(timeline);
  if(lrc.reelPasses().some(p=>p.kind==='globals')){
    for(const band of ['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta']){
      for(const field of ['Hue','Saturation','Luminance']){
        const v=Number(attr(root,field+'Adjustment'+band));
        if(attr(root,field+'Adjustment'+band)!=null)check('caption '+band+' '+field,caption.includes(band+' '+field.toLowerCase()+' '+v+'\n')||caption.includes(band+' '+field.toLowerCase()+' '+v+'\r'),true);
      }
    }
  }
  // Read capture metadata directly from EXIF XML, including rational values
  // and the ISO sequence. Missing fields can use the corresponding TIFF tag.
  const meta=(key,uri)=>{
    const d=desc.find(el=>el.hasAttributeNS(uri,key));
    return d?.getAttributeNS(uri,key) ?? xml.getElementsByTagNameNS(uri,key)[0]?.textContent.trim();
  };
  function capture(key,tag){
    const v=meta(key,'http://ns.adobe.com/exif/1.0/');
    if(v){const [n,d=1]=v.split('/').map(Number);return n/d;}
    return lrc.state.arw.ifds.map(ifd=>ifd.tags[tag]).find(n=>Number(n)>0);
  }
  const focal=capture('FocalLength',37386),aperture=capture('FNumber',33437);
  const shutter=capture('ExposureTime',33434),iso=capture('ISOSpeedRatings',34855);
  const time=shutter<1 && Math.abs(1/shutter-Math.round(1/shutter))<.001?'1/'+Math.round(1/shutter):shutter;
  const camera=[focal && focal+'mm',aperture && 'f/'+aperture,shutter && time+'s',iso && 'ISO '+iso].filter(Boolean).join(' · ');
  check('source card EXIF',timeline.camera,camera);
  if(camera)check('drawn camera line',strings.has(camera),true);
  const lens=meta('Lens','http://ns.adobe.com/exif/1.0/aux/') || meta('LensModel','http://cipa.jp/exif/1.0/');
  if(lens)check('source card lens model',strings.has(lens),true);
  for(const s of timeline.schedule.filter(s=>s.scene==='step')){
    // Inspect the actual settled Canvas commands as well as the source model.
    const ctx=renderer.canvas.getContext('2d'),arcs=[],boxes=[],lines=[];
    const originals={};
    for(const [key,list] of [['arc',arcs],['strokeRect',boxes],['moveTo',lines],['lineTo',lines]]){
      originals[key]=ctx[key];
      ctx[key]=function(...args){list.push(args);return originals[key].apply(this,args);};
    }
    let m;
    try {m=renderer.frame(s.t0+1.8);}
    finally {for(const key of Object.keys(originals))ctx[key]=originals[key];}
    const knobs=arcs.filter(a=>a[2]===7);
    const points=arcs.filter(a=>a[2]===3.5);
    const wheelCentres=arcs.filter(a=>a[2]===46),wheelPoints=arcs.filter(a=>a[2]===5.5);
    check('knob count',knobs.length,m.rows.length);
    const controls=[];
    check('slider rows are ranked by impact',m.rows.map(r=>r.key),s.drawnRows.slice(0,m.rows.length).map(r=>r.key));
    for(const r of m.rows){
      const raw=attr(source(r.correction),r.key);
      check(r.key,Number(r.value),raw==null?null:Number(raw));
      // Drawn text is in Lightroom's units: local exposure is stored as a fraction
      // of ±4 EV, other local sliders as a fraction of ±100.
      const local=/^Local/.test(r.key),base=r.key.replace(/^Local/,'');
      const shown=raw==null?null:local?(base==='Exposure2012'?Number((Number(raw)*4).toFixed(2)):Math.round(Number(raw)*100)):Number(raw);
      const text=m.text.find(t=>t.role==='value' && t.text.endsWith(' K')===(r.key==='Temperature') && Number(t.text.replace(/ K$/,''))===shown)?.text;
      check('drawn '+r.key,!!text,true);
      const [kx,ky]=knobs.shift()||[];
      const track=lines.filter(p=>p[1]===ky);
      const fraction=(kx-track[0]?.[0])/(track[1]?.[0]-track[0]?.[0]);
      const actual=r.key==='Temperature'?2000*25**fraction:
        (r.key.startsWith('Crop')&&r.key!=='CropAngle'||r.key==='ColorGradeBlending'?fraction:2*fraction-1)*r.range;
      check('knob position '+r.key,Math.abs(actual-Number(raw))<.00001,true);
      controls.push((r.numbers||[]).map(n=>'#'+n).join('')+' '+r.label+' '+text);
    }
    let previousCorrection,box;
    for(const c of s.curves){
      if(c.correction!==previousCorrection){box=boxes.shift();previousCorrection=c.correction;}
      const seq=source(c.correction).getElementsByTagNameNS(ns,c.key)[0];
      const expected=[...seq.getElementsByTagNameNS('*','li')].map(li=>li.textContent.trim().split(/[,\s]+/).map(Number));
      check(c.key+' length',c.points.length,expected.length);
      c.points.forEach((p,i)=>{
        check(c.key+' point '+i,p,expected[i]);
        const [x,y]=points.shift()||[];
        check(c.key+' drawn point '+i,box&&[Math.round(255*(x-box[0])/box[2]),Math.round(255*(1-(y-box[1])/box[3]))],expected[i]);
      });
      controls.push(c.name+' curve '+c.points.map(p=>'('+p.join(',')+')').join(' '));
    }
    for(const w of s.wheels){
      const [h,sat,l]=w.keys;
      const [x,y,r]=wheelCentres.shift()||[],[px,py]=wheelPoints.shift()||[];
      const angle=Number(attr(source(w.correction),h))*Math.PI/180,mag=Number(attr(source(w.correction),sat))/w.unit;
      check('wheel point '+w.name,Math.hypot(px-x-r*mag*Math.cos(angle),py-y-r*mag*Math.sin(angle))<.00001,true);
      for(const [key,value] of [[h,w.hue],[sat,w.sat],[l,w.lum]])if(key)check(key,value,Number(attr(source(w.correction),key)||0));
      controls.push(w.name+' H '+w.hue+' · S '+w.sat+(w.lum?' · L '+w.lum:''));
    }
    if(s.mixer){
      const bands=['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'];
      const swatches=arcs.filter(a=>a[2]===12);
      const rings=arcs.filter(a=>a[2]===18);
      const ringed=bands.filter(b=>['Hue','Saturation','Luminance'].some(k=>Number(attr(root,k+'Adjustment'+b))));
      check('drawn mixer rings',swatches.flatMap(([x,y],i)=>rings.some(a=>a[0]===x&&a[1]===y)?[bands[i]]:[]),ringed);
      controls.push('Ring '+ringed.join(', '));
      for(const r of s.rows.filter(r=>r.band))check('swatch '+r.key,r.value,Number(attr(root,r.key)));
    }
    const geometry=[];
    for(const mask of s.masks){
      const seq=source(mask.correction).getElementsByTagNameNS(ns,'CorrectionMasks')[0].firstElementChild;
      const li=seq.children[mask.index],el=li.firstElementChild?.localName==='Description'?li.firstElementChild:li;
      const g=mask.geometry;
      const detail={};
      for(const key of ['What','MaskName','MaskBlendMode','MaskInverted','MaskDigest','Origin','FullMaskSize','ZeroX','ZeroY','FullX','FullY','Top','Left','Bottom','Right','Angle','Feather','Roundness','Flipped']){
        const v=attr(el,key);
        if(v==null && g[key]==null)continue;
        const expected=typeof g[key]==='number'?Number(v):typeof g[key]==='boolean'?v==='true':v;
        check('mask '+mask.number+' '+key,g[key],expected);
        detail[key]=g[key];
      }
      if(detail.What==='Mask/Gradient'){
        for(const end of ['Zero','Full']){
          const [a,b]=paths.shift()||[];
          if(a&&b)guideError(sensor([(a[0]+b[0])/2,(a[1]+b[1])/2]),detail[end+'X'],detail[end+'Y']);
          else check('gradient guide '+end,false,true);
        }
      }
      if(detail.What==='Mask/CircularGradient'){
        const cx=(detail.Left+detail.Right)/2,cy=(detail.Top+detail.Bottom)/2;
        const aspect=lrc.state.arw.chosen.width/lrc.state.arw.chosen.height;
        const angle=(detail.Angle||0)*Math.PI/180;
        const exponent=Math.max(.5,Math.min(8,2+(detail.Roundness||0)*.04));
        const radius=v=>Math.sign(v)*Math.pow(Math.abs(v),2/exponent);
        for(const f of [1,1-(detail.Feather??50)/100].filter(Boolean)){
          const path=paths.shift()||[];
          check('ellipse samples',path.length,97);
          // Remove the XMP rotation in sensor-pixel space and recover the
          // ellipse parameters, including the radius of the feather guide.
          path.map(sensor).forEach((p,i)=>{
            const dx=(p.x-cx)*aspect,dy=p.y-cy;
            const u=(dx*Math.cos(angle)+dy*Math.sin(angle))/aspect;
            const v=dy*Math.cos(angle)-dx*Math.sin(angle);
            guideError({x:u,y:v},(detail.Right-detail.Left)*.5*f*radius(Math.cos(i*Math.PI/48)),
              (detail.Bottom-detail.Top)*.5*f*radius(Math.sin(i*Math.PI/48)));
          });
        }
      }
      geometry.push({number:mask.number,...detail});
    }
    steps.push({name:s.kicker,index:s.pass.index,kind:s.pass.kind,score:s.score,controls,geometry,dwell:s.t1-s.t0});
  }
  check('all geometry paths matched',paths.length,0);
  check('geometry in sensor coordinates',maxGuideError<1e-8,true);
  return {min,strings:[...strings],camera:timeline.camera,steps,duration:timeline.duration,maxGuideError,
    checks,mismatch,rectDeviation,unsafe,maxRows,endOverlays,maxSubject,subjectPixels:renderer.subjectPixels};
}
