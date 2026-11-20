import assert from 'node:assert/strict';

export async function referenceRegressionChecks(evaluate){
  const result=await evaluate(`(async()=>{
    const compiled=lrc.finalFrame(),href=document.querySelector('#download-png').href;
    const passes=lrc.reelPasses().map(p=>p.result),checks=[];
    const unchanged=()=>lrc.state.compiled&&lrc.finalFrame()===compiled&&document.querySelector('#download-png').href===href&&lrc.reelPasses().every((p,i)=>p.result===passes[i]);
    const file=async(color,name,w,h)=>{
      const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);
      return new File([await c.convertToBlob({type:'image/jpeg'})],name,{type:'image/jpeg'});
    };
    async function scenes(expected){
      for(const mode of ['teaser','tutorial']){
        document.querySelector('[name=reel-mode][value='+mode+']').click();
        const r=await lrcReel.makeRenderer();
        checks.push(r.data.reference===expected);
        if(mode==='tutorial')checks.push(r.data.timeline.schedule.filter(s=>['hook','after'].includes(s.scene)).every(s=>s.after===(expected||compiled)));
        const ctx=r.canvas.getContext('2d'),draw=ctx.drawImage;let shot;
        ctx.drawImage=function(img,...args){if(img===(expected||compiled))shot=args;return draw.call(this,img,...args);};
        const rect=r.frame(0).photoRect;
        ctx.drawImage=draw;
        checks.push(!!shot);
        if(expected){
          const [x,y,w,h]=shot;
          checks.push(Math.abs(w/h-expected.width/expected.height)<.001);
          checks.push(x>=rect.x-.01&&y>=rect.y-.01&&x+w<=rect.x+rect.w+.01&&y+h<=rect.y+rect.h+.01);
        }
      }
    }
    await scenes(null);
    await lrc.loadFiles([await file('#c84638','finished.jpg',240,160)]);
    checks.push(unchanged(),!document.querySelector('#remove-jpg').hidden,document.querySelector('#choose-jpg').textContent==='Replace edited JPG');
    await scenes(lrc.state.reference);
    const old=lrc.state.reference;
    await lrc.loadFiles([await file('#3885c8','replacement.jpeg',160,240)]);
    checks.push(unchanged(),lrc.state.reference!==old);
    const replacement=lrc.state.reference;
    await scenes(replacement);
    let rejected=false;
    try{await lrc.loadFiles([new File(['invalid JPEG'],'bad.jpg')]);}catch{rejected=true;}
    checks.push(rejected,unchanged(),lrc.state.reference===replacement,!document.querySelector('#download-reel').disabled);
    lrc.setReelExporting(true);
    checks.push(document.querySelector('#choose-jpg').disabled,document.querySelector('#remove-jpg').disabled);
    lrc.setReelExporting(false);
    document.querySelector('#remove-jpg').click();
    checks.push(unchanged(),!lrc.state.reference,!lrc.state.files.jpg,document.querySelector('#remove-jpg').hidden);
    await scenes(null);
    document.querySelector('[name=reel-mode][value=teaser]').click();
    return {checks:checks.length,failures:checks.flatMap((ok,i)=>ok?[]:[i])};
  })()`);
  assert.deepEqual(result.failures,[],'Optional JPG changes only finished-photo shots, preserves compilation, and fits its crop');
  console.log('EDITED JPG',JSON.stringify(result));
  return result;
}
