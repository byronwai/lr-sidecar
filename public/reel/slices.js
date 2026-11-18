// The motif shares the approved panel slot, using captured mask faces only.
import { BEAT } from './timeline.js';
export const intersectionArea=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
export function createSlices(schedule,{panelRect}){
  const chapters=schedule.filter(c=>c.scene==='program').slice(0,5);
  const slot={...panelRect};
  const layout={placement:chapters.length?{rect:slot,scale:1}:null};
  const mono='500 25px "Reel Mono", "Noto Sans TC Variable", monospace';
  function face(ctx,pass,x,y,width,active){
    ctx.save();ctx.translate(x,y);
    ctx.transform(.819152,-.269278,.573576,.384569,0,0);
    const h=width*1.5;
    ctx.fillStyle='#04070f';ctx.fillRect(-width/2,-h/2,width,h);
    if(pass.mask)ctx.drawImage(pass.mask,-width/2,-h/2,width,h);
    ctx.strokeStyle=pass.color;ctx.lineWidth=active?3:1.5;
    ctx.strokeRect(-width/2,-h/2,width,h);ctx.restore();
  }
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
      const start={x:slot.x+174,y:slot.y+92+i*35};
      const end={x:slot.x+slot.w-64,y:slot.y+17};
      const center={x:start.x+(end.x-start.x)*travel,y:start.y+(end.y-start.y)*travel};
      face(ctx,cue.pass,center.x,center.y,110+(38-110)*travel,true);
      shown.push({index:cue.pass.index,active:true,mode:'thumbnail',lift:1,center});
    }else{
      ctx.fillStyle='#0b1120f7';ctx.fillRect(slot.x,slot.y,slot.w,slot.h);
      ctx.strokeStyle='#7894ff';ctx.lineWidth=1.5;ctx.beginPath();
      ctx.moveTo(slot.x+32,slot.y+38);ctx.quadraticCurveTo(slot.x+400,slot.y+5,slot.x+slot.w-24,slot.y+38);ctx.stroke();
      text(ctx,'composite passes → encode ↗',slot.x+34,slot.y+31,mono,'#c4d4ff',slot.w-68);
      chapters.forEach((chapter,i)=>{
        const active=cue.scene==='program'&&chapter.pass.index===cue.pass.index;
        const lift=active?arrive(time,half,BEAT/2):0;
        const center={x:slot.x+150+24*lift,y:slot.y+112+i*35-20*lift};
        face(ctx,chapter.pass,center.x,center.y,110,active);
        const y=slot.y+84+i*39;
        if(active){ctx.fillStyle=chapter.pass.color;ctx.fillRect(slot.x+287,y-24,slot.w-311,31);}
        text(ctx,`pass ${chapter.pass.index} · ${chapter.pass.name}`,slot.x+295,y,mono,active?'#04070f':chapter.pass.color,slot.w-330);
        shown.push({index:chapter.pass.index,active,lift,mode:'stack',center});
      });
    }
    ctx.restore();return shown;
  }};
}
