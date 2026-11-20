import { photoRect, photoSplit, headlineLayout, maskOverlay } from './scene.js';
import { WIDTH, HEIGHT, FPS } from './timeline.js';
import { bands } from '../render/passes.js';
import {labelLines,displayValue} from './text.js';
import {isSubject,subjectFaces,subjectMatte} from './subject.js';
import { badge } from './tutorial.js';
import {drawCropTransition} from './crop.js';
import { tutorialDeck, intersectionArea } from './slices.js';

const SAFE={x:60,y:250,w:900,h:1230};
const INK='#edf3ff', MUTED='#c1cddd', NAVY='#04070f', BLUE='#87bcff';
const swatches=['#fa737b','#ffad66','#eccc68','#81ce92','#68d8db','#72a9ff','#b395ed','#ec92ce'];
const mono=size=>'500 '+size+'px "Reel Mono","Noto Sans TC Variable",monospace';
const clamp=(n,l=0,h=1)=>Math.min(h,Math.max(l,n));
const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
const circle=(ctx,x,y,r)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);};
function point(matrix,x,y){return matrix.transformPoint({x,y});}

function subjectMap(masks,settings,rect) {
  const canvas=subjectMatte(subjectFaces(masks,settings),rect);
  const data=canvas.getContext('2d').getImageData(0,0,WIDTH,HEIGHT);
  const stride=WIDTH+1,area=new Uint32Array(stride*(HEIGHT+1));
  let count=0;
  for(let y=0;y<HEIGHT;y++){
    let sum=0;
    for(let x=0;x<WIDTH;x++){
      const i=4*(y*WIDTH+x),inside=data.data[i+3]>0;
      sum+=inside;
      count+=inside;
      area[(y+1)*stride+x+1]=area[y*stride+x+1]+sum;
    }

  }
  function overlap(x,y,w,h) {
    // Without an AI subject, prefer available safe space outside the photo.
    if(!count)return intersectionArea(rect,{x,y,w,h})/(rect.w*rect.h);
    const l=clamp(Math.floor(x),0,WIDTH),r=clamp(Math.ceil(x+w),0,WIDTH);
    const t=clamp(Math.floor(y),0,HEIGHT),b=clamp(Math.ceil(y+h),0,HEIGHT);
    return (area[b*stride+r]-area[t*stride+r]-area[b*stride+l]+area[t*stride+l])/count;
  }
  const x=Math.max(SAFE.x,rect.x),y=Math.max(SAFE.y,rect.y);
  const bounds={x,y,w:Math.min(SAFE.x+SAFE.w,rect.x+rect.w)-x,h:Math.min(SAFE.y+SAFE.h,rect.y+rect.h)-y};
  return {canvas,count,overlap,bounds};
}

// Search at reading size, preferring the panel slot on the photo. When the
// subject fills it, the safe area above or below the photo is available too.
function placement(width,height,subject,preferTop=false) {
  let best;
  const center=SAFE.x+(SAFE.w-width)/2;
  const first=preferTop||!subject.count?subject.bounds.y:subject.bounds.y+subject.bounds.h-height;
  for(const x of [center,SAFE.x,SAFE.x+SAFE.w-width])for(let y=SAFE.y;y<=SAFE.y+SAFE.h-height;y+=8){
    const overlap=subject.overlap(x,y,width,height);
    const cost=overlap*10000+Math.abs(y-first)/SAFE.h;
    if(!best||cost<best.cost)best={x,y,w:width,h:height,overlap,cost};
  }
  return best || {x:center,y:SAFE.y,w:width,h:height,overlap:subject.overlap(center,SAFE.y,width,height)};
}
function setText(ctx,metrics,text,x,y,font,color,width=Infinity,role="label") {
  ctx.font=font;
  ctx.fillStyle=color;
  const b=ctx.measureText(text),m=ctx.getTransform();
  const left=point(m,x,y-b.actualBoundingBoxAscent),right=point(m,x+Math.min(b.width,width),y+b.actualBoundingBoxDescent);
  metrics.text.push({text,role,size:parseFloat(font.match(/[\d.]+px/)[0])*Math.min(m.d,m.a*width/(b.width||1)),left:left.x,right:right.x,top:left.y,bottom:right.y});
  ctx.save();
  ctx.shadowColor='#04070f';ctx.shadowBlur=4;
  ctx.fillText(text,x,y,Number.isFinite(width)?width:undefined);
  ctx.restore();
}
function scrim(ctx,w,h) {
  const grad=ctx.createLinearGradient(0,0,0,h);
  for(const [stop,alpha] of [[0,0],[.14,.68],[.56,.74],[.88,.65],[1,0]])grad.addColorStop(stop,'rgba(4,9,19,'+alpha+')');
  ctx.fillStyle=grad;
  ctx.fillRect(48,0,w-96,h);
  for(let x=0;x<48;x+=2){
    ctx.save();ctx.globalAlpha*=smooth(x/48);
    ctx.fillRect(x,0,2,h);ctx.fillRect(w-2-x,0,2,h);ctx.restore();
  }
}
function cardSize(ctx,s,compact=false) {
  const w=884;
  const kick=labelLines(ctx,s.kicker,w-120,mono(32));
  const spec=labelLines(ctx,s.spec,w-48,mono(30));
  const kickLine=compact?35:39,specLine=compact?34:38,rowHeight=compact?39:48;
  const header=(compact?9:32)+kick.length*kickLine+spec.length*specLine;
  const plots=new Set(s.curves.map(c=>c.correction)).size+s.wheels.length;
  const beside=plots===1 && s.drawnRows.length>0;
  const plotHeight=compact&&!s.wheels.length?136:190;
  const controls=beside?Math.max(plotHeight-16,s.drawnRows.length*rowHeight):Math.ceil(plots/3)*plotHeight+s.drawnRows.length*rowHeight;
  return {w,kick,spec,header,beside,compact,kickLine,specLine,rowHeight,plotHeight,h:header+(s.mixer?55:0)+controls+(compact?12:24)};
}
function drawCurve(ctx,x,y,curves,p,color) {
  const side=98;
  ctx.fillStyle='#111c2bb3';ctx.fillRect(x,y,side,side);
  ctx.strokeStyle='#9aadbf80';ctx.lineWidth=1.5;ctx.strokeRect(x,y,side,side);
  ctx.beginPath();
  for(let n=1;n<4;n++){const d=n*side/4;ctx.moveTo(x+d,y);ctx.lineTo(x+d,y+side);ctx.moveTo(x,y+d);ctx.lineTo(x+side,y+d);}
  ctx.moveTo(x,y+side);ctx.lineTo(x+side,y);ctx.stroke();
  for(const c of curves){
    const points=c.points.map(([a,b])=>[x+side*a/255,y+side*(1-(a+(b-a)*p)/255)]);
    ctx.strokeStyle=ctx.fillStyle=({RGB:INK,Red:swatches[0],Green:swatches[3],Blue:swatches[5]})[c.name]||color;
    ctx.lineWidth=3;ctx.beginPath();
    points.forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.stroke();
    for(const [a,b] of points){circle(ctx,a,b,3.5);ctx.fill();}
  }
}
function drawWheel(ctx,x,y,w,p) {
  const radius=46;
  const rim=ctx.createConicGradient(0,x,y);
  for(let i=0;i<=6;i++)rim.addColorStop(i/6,'hsl('+i*60+' 65% 64%)');
  circle(ctx,x,y,radius);ctx.fillStyle=rim;ctx.fill();
  const wash=ctx.createRadialGradient(x,y,0,x,y,radius);
  wash.addColorStop(0,'#b6bbc8');wash.addColorStop(1,'#19213120');
  ctx.fillStyle=wash;ctx.fill();
  const a=w.hue*Math.PI/180,r=radius*clamp(w.sat/w.unit)*p;
  circle(ctx,x+Math.cos(a)*r,y+Math.sin(a)*r,5.5);ctx.fillStyle=NAVY;ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=2;ctx.stroke();
}
function stepCard(ctx,m,s,size,since){
  const label=(str,x,y,font,color=INK,w=size.w-x-22,role='label')=>setText(ctx,m,str,x,y,font,color,w,role);
  ctx.fillStyle='#0b1120ed';ctx.fillRect(0,0,size.w,size.h);
  const accent=s.color;
  let y=size.compact?0:11;
  for(const line of size.kick){y+=size.kickLine;label(line,23,y,mono(32),accent,size.w-120,'kicker');}
  for(const line of size.spec){y+=size.specLine;label(line,23,y,mono(30),MUTED);}
  y=size.header;
  if(s.mixer){
    bands.forEach((name,i)=>{
      const x=45+i*53;
      circle(ctx,x,y+20,12);ctx.fillStyle=swatches[i];ctx.fill();
      if(s.rows.some(r=>r.band===name && r.value)){circle(ctx,x,y+20,18);ctx.lineWidth=2;ctx.strokeStyle=INK;ctx.stroke();}
    });
    y+=55;
  }
  const p=smooth((since-.18)/.95);
  const curves=Map.groupBy(s.curves,c=>c.correction);
  const plots=[...curves.values()].map(lines=>({lines})).concat(s.wheels);
  const plotWidth=(size.w-48)/Math.min(3,plots.length||1);
  plots.forEach((plot,i)=>{
    const x=24+(i%3)*plotWidth,top=y+Math.floor(i/3)*size.plotHeight;
    if(plot.lines){
      drawCurve(ctx,x+4,top+5,plot.lines,p,accent);
      const nums=plot.lines[0].numbers||[];
      label(nums.map(badge).join('')+plot.lines.map(c=>c.name).join(' + '),x,top+(size.compact?123:132),mono(30),INK,plotWidth-8);
    } else {
      drawWheel(ctx,x+54,top+53,plot,p);
      label((plot.numbers||[]).map(badge).join('')+plot.name,x,top+126,mono(30),INK,plotWidth-6);
      label('H '+displayValue(plot.hue)+' · S '+displayValue(plot.sat*100/plot.unit)+(plot.lum?' · L '+displayValue(plot.lum):''),x,top+164,mono(30),MUTED,plotWidth-6,'value');
    }
  });
  if(!size.beside)y+=Math.ceil(plots.length/3)*size.plotHeight;
  s.drawnRows.forEach((r,i)=>{
    const baseline=y+24,trackY=baseline-7;
    const nums=(r.numbers||[]).map(badge).join('');
    const text=nums+(nums?' ':'')+r.label;
    label(text,size.beside?262:23,baseline,mono(32),INK,size.beside?283:380);
    // Show Lightroom's own units (local sliders are stored as fractions), always rounded.
    const shown=r.display||{value:Number(r.value),decimals:r.decimals||0};
    const value=displayValue(shown.value,shown.decimals)+(r.key==='Temperature'?' K':'');
    ctx.font=mono(32);
    const valueX=size.w-22-ctx.measureText(value).width;
    const x=size.beside?557:424,end=Math.min(size.w-121,valueX-22);
    const wb=r.key==='Temperature', crop=r.key.startsWith('Crop')&&r.key!=='CropAngle';
    const position=v=>wb?clamp(Math.log(Math.max(2000,v)/2000)/Math.log(25)):crop||r.key==='ColorGradeBlending'?clamp(v/r.range):clamp(.5+v/(2*r.range));
    const neutral=x+(end-x)*position(r.from),target=x+(end-x)*position(r.value);
    const progress=smooth((since-.15-i*.16)/.62),knob=neutral+(target-neutral)*progress;
    const tint=r.band?swatches[bands.indexOf(r.band)]:accent;
    ctx.lineWidth=2;ctx.strokeStyle='#aab9c8';ctx.beginPath();ctx.moveTo(x,trackY);ctx.lineTo(end,trackY);ctx.stroke();
    ctx.lineWidth=4;ctx.strokeStyle=tint;ctx.beginPath();ctx.moveTo(neutral,trackY);ctx.lineTo(knob,trackY);ctx.stroke();
    circle(ctx,knob,trackY,7);ctx.fillStyle=tint;ctx.fill();
    if(progress>0&&progress<1){circle(ctx,knob,trackY,12);ctx.strokeStyle=INK;ctx.lineWidth=1.5;ctx.stroke();}
    label(value,valueX,baseline,mono(32),INK,Infinity,'value');
    y+=size.rowHeight;
  });

}
function geometryLayer(s,rect,sources,subject,aspect,slot) {
  const layer=new OffscreenCanvas(WIDTH,HEIGHT),ctx=layer.getContext('2d');
  const matrix=new DOMMatrix().translate(rect.x,rect.y).scale(rect.w,rect.h).multiply(new DOMMatrix(sources.transform));
  const l=Math.max(SAFE.x,rect.x),t=Math.max(SAFE.y,rect.y),r=Math.min(SAFE.x+SAFE.w,rect.x+rect.w),b=Math.min(SAFE.y+SAFE.h,rect.y+rect.h);
  const anchors=[],texts=[];
  let subjectLayer;
  for(const mask of s.masks){
    const g=mask.geometry, face=sources.masks[mask.correction+':'+mask.index];
    const part=new OffscreenCanvas(WIDTH,HEIGHT),c=part.getContext('2d');
    c.save();c.beginPath();c.rect(l,t,r-l,b-t);c.clip();
    c.strokeStyle=s.color;c.lineWidth=2.5;
    let anchor=point(matrix,.5,.5);
    if(g.What==='Mask/Gradient'){
      const dx=(g.FullX-g.ZeroX)*aspect,dy=g.FullY-g.ZeroY,mag=Math.hypot(dx,dy);
      if(!mag){c.restore();continue;}
      const a=point(matrix,g.ZeroX,g.ZeroY),z=point(matrix,g.FullX,g.FullY);
      const tangent=point(matrix,g.ZeroX-dy/(mag*aspect),g.ZeroY+dx/mag);
      const vx=tangent.x-a.x,vy=tangent.y-a.y;
      for(const p of [a,z]){c.beginPath();c.moveTo(p.x-8*vx,p.y-8*vy);c.lineTo(p.x+8*vx,p.y+8*vy);c.stroke();}
      anchor={x:(a.x+z.x)/2,y:(a.y+z.y)/2};
    } else if(g.What==='Mask/CircularGradient'){
      const cx=(g.Left+g.Right)/2,cy=(g.Top+g.Bottom)/2;
      const angle=(g.Angle||0)*Math.PI/180,ca=Math.cos(angle),sa=Math.sin(angle);
      const exponent=clamp(2+(g.Roundness||0)*.04,.5,8);
      const radial=v=>exponent===2?v:Math.sign(v)*Math.abs(v)**(2/exponent);
      for(const f of [1,1-clamp((g.Feather??50)/100)]){
        if(!f)continue;
        c.beginPath();
        for(let i=0;i<=96;i++){
          const a=i*Math.PI/48,x=(g.Right-g.Left)*.5*radial(Math.cos(a))*f,y=(g.Bottom-g.Top)*.5*radial(Math.sin(a))*f;
          const p=point(matrix,cx+x*ca-y*sa/aspect,cy+x*sa*aspect+y*ca);
          if(!i){c.moveTo(p.x,p.y);if(f===1)anchor=p;}else c.lineTo(p.x,p.y);
        }
        c.setLineDash(f===1?[]:[6,6]);c.stroke();
      }
    } else if(face){
      const edge=maskOverlay(face,'#ffffff',s.color,rect,0);
      if(edge?.canvas){
        c.drawImage(edge.canvas,rect.x,rect.y,rect.w,rect.h);
        const small=new OffscreenCanvas(64,64),cx=small.getContext('2d');
        cx.drawImage(face,0,0,64,64);
        const bytes=cx.getImageData(0,0,64,64).data;
        let best=Infinity;
        for(let i=0;i<4096;i++)if(bytes[i*4]>=128 && [-64,64,-1,1].some(d=>(bytes[(i+d)*4]||0)<128)){
          const x=rect.x+(i%64+.5)*rect.w/64,y=rect.y+(Math.floor(i/64)+.5)*rect.h/64;
          const distance=Math.hypot(x-rect.x-rect.w*.4,y-rect.y-rect.h*.35);
          if(distance<best){best=distance;anchor={x,y};}
        }
      }
    }
    // Keep badges on-screen even when an ellipse centre or a gradient edge lies outside the crop.
    anchor.x=clamp(anchor.x,l+22,r-22);anchor.y=clamp(anchor.y,t+22,b-22);
    const ownSubject=isSubject(g);
    const initial={...anchor};
    let nearest=Infinity;
    for(let y=t+22;y<b-20;y+=35)for(let x=l+22;x<r-20;x+=35){
      if(intersectionArea({x:x-20,y:y-20,w:40,h:40},slot))continue;
      if(!ownSubject && subject.overlap(x-20,y-20,40,40)>.0001)continue;
      if(anchors.some(p=>Math.hypot(p.x-x,p.y-y)<40))continue;
      const d=Math.hypot(x-initial.x,y-initial.y);
      if(d<nearest){nearest=d;anchor={x,y};}
    }
    anchors.push(anchor);circle(c,anchor.x,anchor.y,18);c.fillStyle='#081222d9';c.fill();
    c.setLineDash([]);c.strokeStyle=s.color;c.lineWidth=2;c.stroke();
    const number=String(mask.number);c.font=mono(30);
    setText(c,{text:texts},number,anchor.x-c.measureText(number).width/2,anchor.y+10,mono(30),INK);
    c.restore();
    if(!ownSubject){c.globalCompositeOperation='destination-out';c.drawImage(subject.canvas,0,0);}
    if(ownSubject){
      subjectLayer??=new OffscreenCanvas(WIDTH,HEIGHT);
      subjectLayer.getContext('2d').drawImage(part,0,0);
    }else ctx.drawImage(part,0,0);
  }
  return {layer,subjectLayer,texts};
}

export function createTutorialScene(ctx,data) {
  const {timeline:t,sources,settings,arw}=data, rect=photoRect(data.original);
  const subject=subjectMap(sources.masks,settings,rect);
  const guides=subject.count?new OffscreenCanvas(WIDTH,HEIGHT).getContext('2d'):ctx;
  const slots=new Map(),geometry=new Map();
  for(const s of t.steps){
    let visible=s,size,slot;
    // Leave less important rows in the caption if they would cover the subject.
    for(const compact of [false,true]){
      for(let count=s.drawnRows.length;count>=Math.min(1,s.drawnRows.length);count--){
        const candidate={...s,drawnRows:s.drawnRows.slice(0,count)};
        const card=cardSize(ctx,candidate,compact),position=placement(card.w,Math.max(card.h,compact?208:300),subject);
        if(!slot || position.overlap<slot.overlap){visible=candidate;size=card;slot=position;}
        if(slot.overlap<=.05)break;
      }
      if(slot.overlap<=.05)break;
    }
    slots.set(s.number,{size,slot,visible});
    if(s.masks.length)geometry.set(s.number,geometryLayer(s,rect,sources,subject,arw.chosen.width/arw.chosen.height,slot));
  }
  const lines=headlineLayout(ctx,t.coverTitle);
  const cover=placement(SAFE.w,55+lines.length*lines[0].size,subject,true);
  const sourceLines=[t.camera,t.lens,'LIGHTROOM',data.hasACR?'ARW + XMP + ACR':'ARW + XMP'].filter(Boolean)
    .flatMap(text=>labelLines(ctx,text,836,mono(32)));
  const source=placement(884,44+sourceLines.length*48,subject);
  const slab=placement(884,84,subject);
  function frame(time){
    if(time>=(Math.round(t.duration*FPS)-1)/FPS)time=0;
    const s=t.schedule.find(c=>time<c.t1),since=time-s.t0;
    const m={scene:s.scene,photoRect:rect,text:[],rows:[],slices:[],opacity:0,subjectOverlap:0};
    ctx.fillStyle=NAVY;ctx.fillRect(0,0,WIDTH,HEIGHT);
    if(s.scene==='crop'){
      m.crop=drawCropTransition(ctx,sources,data.original,rect,since/Math.max(.01,s.t1-s.t0-.1));
      return m;
    }
    const split=s.before?1-smooth(since/(s.scene==='after'?.85:1.15)):0;
    photoSplit(ctx,s.after,s.before,rect,split,s.color||BLUE,guides);
    if(guides!==ctx && split>0 && split<1){
      guides.globalCompositeOperation='destination-out';
      guides.drawImage(subject.canvas,0,0);
      guides.globalCompositeOperation='source-over';
      ctx.drawImage(guides.canvas,0,0);
      guides.clearRect(0,0,WIDTH,HEIGHT);
    }
    ctx.save();
    if(s.scene==='hook'){
      // Full strength from frame 0: that frame is also the exported cover JPG.
      ctx.globalAlpha=1;
      {
        ctx.translate(cover.x,cover.y);
        scrim(ctx,cover.w,cover.h);
        let y=21+Math.round(lines[0].size*.8);
        for(const line of lines){
          ctx.letterSpacing=line.tracking;
          setText(ctx,m,line.text,10,y,line.font,line.color);
          y+=line.size;
        }
        ctx.letterSpacing='0px';
      }
    }else if(s.scene==='source'){
      ctx.fillStyle='#0b1120ef';ctx.fillRect(source.x,source.y,source.w,source.h);
      sourceLines.forEach((line,i)=>setText(ctx,m,line,source.x+24,source.y+50+i*48,mono(32),i<2?INK:BLUE));
    }else if(s.scene==='before'||s.scene==='after'){
      const after=s.scene==='after';
      ctx.globalAlpha=after?smooth(since/.3)*smooth((s.t1-time-.12)/.26):1;
      if(ctx.globalAlpha){
        ctx.fillStyle='#0b1120ef';ctx.fillRect(slab.x,slab.y,slab.w,slab.h);
        ctx.fillStyle=BLUE;ctx.fillRect(slab.x,slab.y,4,slab.h);
        setText(ctx,m,after?'compiled(edit);':'before',slab.x+25,slab.y+54,mono(36),INK);
      }
    }else{
      const {size,slot,visible}=slots.get(s.number);
      const lifting=s.scene==='lift';
      m.panelRect=slot;m.subjectOverlap=slot.overlap;
      m.opacity=lifting?1:smooth((s.t1-time-.14)/.20);
      if(m.opacity){
        ctx.globalAlpha=m.opacity;
        const geo=geometry.get(s.number);
        if(!lifting && geo){
          ctx.drawImage(geo.layer,0,0);
          if(geo.subjectLayer)ctx.drawImage(geo.subjectLayer,0,0);
          m.text.push(...geo.texts);
        }
        ctx.translate(slot.x,slot.y);
        const activeIndex=t.steps.findIndex(step=>step.number===s.number);
        if(lifting){
          ctx.fillStyle='#0b1120ef';ctx.fillRect(0,0,size.w,size.compact?208:300);
          let y=size.compact?0:11;
          for(const line of size.kick){y+=size.kickLine;setText(ctx,m,line,23,y,mono(32),s.color,Infinity,'kicker');}
          m.slices=tutorialDeck(ctx,t.steps,activeIndex,size.w,smooth(since/.5),null,
            (label,x,y,color)=>setText(ctx,m,label,x-9,y,mono(30),color),size.compact);
        }else{
          m.rows=visible.drawnRows;
          stepCard(ctx,m,visible,size,since);
          m.slices=tutorialDeck(ctx,t.steps,activeIndex,size.w,1,smooth(since/.22),undefined,size.compact);

        }
      }
    }
    ctx.restore();return m;
  }
  return {frame,subjectGuides:[...geometry.values()].map(g=>g.subjectLayer).filter(Boolean),subjectPixels:subject.count,maskCoverage:[]};
}
