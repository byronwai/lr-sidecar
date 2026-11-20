// The motif shares the approved panel slot, using captured mask faces only.
import { BEAT } from './timeline.js';
export const intersectionArea=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
export function drawSliceFace(ctx,pass,x,y,width,active,image=pass.mask){
  ctx.save();ctx.translate(x,y);
  ctx.transform(.819152,-.269278,.573576,.384569,0,0);
  const h=width*1.5;
  ctx.fillStyle='#04070f';ctx.fillRect(-width/2,-h/2,width,h);
  if(image)ctx.drawImage(image,-width/2,-h/2,width,h);
  ctx.strokeStyle=pass.color;ctx.lineWidth=active?3:1.5;
  ctx.strokeRect(-width/2,-h/2,width,h);ctx.restore();
}

// The Tutorial deals every chosen face in pass order, then carries the
// current face from its lifted position into the controls header.
export function tutorialDeck(ctx,steps,activeIndex,width,lift,settle,text) {
  const thumbnail=settle!==null;
  const inset=104,spacing=Math.min(108,(width-inset*2)/Math.max(1,steps.length-1));
  const origin=(width-spacing*(steps.length-1))/2;
  const shown=[];
  steps.forEach((step,i)=>{
    const active=i===activeIndex;
    if(thumbnail && !active)return;
    const amount=active?lift:0;
    let x=origin+i*spacing,y=158+(steps.length-1-i)*7-44*amount;
    let faceWidth=126;
    if(thumbnail){
      x+=(width-68-x)*settle;
      y+=(32-y)*settle;
      faceWidth+=(38-faceWidth)*settle;
    }
    drawSliceFace(ctx,step.pass,x,y,faceWidth,active,step.pass.mask||step.pass.face);
    if(!thumbnail)text(String(step.number),x,286,step.color);
    shown.push({index:step.number,active,lift:amount,mode:thumbnail?'thumbnail':'stack',x,y});
  });
  return shown;
}

export function createSlices(schedule,{panelRect}){
  const chapters=schedule.filter(c=>c.scene==='program').slice(0,5);
  const slot={...panelRect};
  const layout={placement:chapters.length?{rect:slot,scale:1}:null};
  const mono='500 25px "Reel Mono", "Noto Sans TC Variable", monospace';
  // Match the page stack: later passes sit higher and are painted last (on top),
  // the way layers composite. Row 0 is the top of the slot.
  const rowOf=i=>chapters.length-1-i;
  return {layout,draw(ctx,cue,time,arrive,text){
    if(!chapters.length||!['rewind','camera','program','answer','hold'].includes(cue.scene))return [];
    const half=cue.t0+BEAT/2;
    const header=['answer','hold'].includes(cue.scene)||cue.scene==='program'&&time>=half;
    if(cue.scene==='camera'&&time>=half)return [];
    ctx.save();
    // Clip guards every moving edge, including its stroke.
    ctx.beginPath();ctx.rect(slot.x,slot.y,slot.w,slot.h);ctx.clip();
    const shown=[];
    if(header){
      const i=chapters.findIndex(c=>c.pass.index===cue.pass.index);
      const travel=cue.scene==='program'?arrive(time,half+.1,.1):1;
      const start={x:slot.x+174,y:slot.y+92+rowOf(i)*35};
      const end={x:slot.x+slot.w-64,y:slot.y+17};
      const center={x:start.x+(end.x-start.x)*travel,y:start.y+(end.y-start.y)*travel};
      drawSliceFace(ctx,cue.pass,center.x,center.y,110+(38-110)*travel,true);
      shown.push({index:cue.pass.index,active:true,mode:'thumbnail',lift:1,center});
    }else{
      ctx.fillStyle='#0b1120f7';ctx.fillRect(slot.x,slot.y,slot.w,slot.h);
      let lifted=null;
      chapters.forEach((chapter,i)=>{
        const active=cue.scene==='program'&&chapter.pass.index===cue.pass.index;
        const lift=active?arrive(time,half,BEAT/2):0;
        const center={x:slot.x+150+24*lift,y:slot.y+112+rowOf(i)*35-20*lift};
        // The lifting slice is painted after the rest so it rises out of the deck.
        if(active)lifted=()=>drawSliceFace(ctx,chapter.pass,center.x,center.y,110,true);
        else drawSliceFace(ctx,chapter.pass,center.x,center.y,110,false);
        const y=slot.y+84+rowOf(i)*39;
        if(active){ctx.fillStyle=chapter.pass.color;ctx.fillRect(slot.x+287,y-24,slot.w-311,31);}
        text(ctx,`pass ${chapter.pass.index} · ${chapter.pass.name}`,slot.x+295,y,mono,active?'#04070f':chapter.pass.color,slot.w-330);
        shown.push({index:chapter.pass.index,active,lift,mode:'stack',center});
      });
      lifted?.();
    }
    ctx.restore();return shown;
  }};
}
