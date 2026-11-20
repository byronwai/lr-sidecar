import assert from 'node:assert/strict';

export async function cropRegressionChecks(evaluate){
  const result=await evaluate(`(async()=>{
    const {hasCropMotion,drawCropTransition}=await import('/reel/crop.js');
    const {finishOrientedCanvas}=await import('/render/gl.js');
    const cases=[];
    for(const angle of [-15,0,15]){
      const source=new OffscreenCanvas(240,160),s=source.getContext('2d');
      for(let y=0;y<160;y+=20)for(let x=0;x<240;x+=20){s.fillStyle=(x+y)%40?'#f5ac32':'#4268c2';s.fillRect(x,y,20,20);}
      let matrix;
      const finished=finishOrientedCanvas(source,{globals:{HasCrop:true,CropAngle:angle,CropLeft:.1,CropRight:.8,CropTop:.15,CropBottom:.85}},1,m=>matrix=m).canvas;
      const original=new OffscreenCanvas(finished.width,finished.height),o=original.getContext('2d');
      o.fillStyle='#04070f';o.fillRect(0,0,original.width,original.height);
      const scale=Math.min(original.width/source.width,original.height/source.height);
      o.drawImage(source,(original.width-source.width*scale)/2,(original.height-source.height*scale)/2,source.width*scale,source.height*scale);
      const sources={original,cropMotion:{image:source,width:finished.width,height:finished.height,matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f]}};
      const c=new OffscreenCanvas(finished.width,finished.height),ctx=c.getContext('2d'),rect={x:0,y:0,w:c.width,h:c.height};
      const errors=[];
      for(const [p,image] of [[0,original],[1,finished]]){
        ctx.clearRect(0,0,c.width,c.height);drawCropTransition(ctx,sources,finished,rect,p);
        const a=ctx.getImageData(0,0,c.width,c.height).data;
        ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(image,0,0);
        const b=ctx.getImageData(0,0,c.width,c.height).data;
        errors.push(Math.max(...a.map((v,i)=>Math.abs(v-b[i]))));
      }
      const values=Array.from({length:31},(_,i)=>drawCropTransition(ctx,sources,finished,rect,i/30));
      cases.push({angle,errors,monotone:values.every((v,i)=>!i||v.progress>=values[i-1].progress),
        finalAngle:values.at(-1).angle*180/Math.PI,firstStep:values[1].progress,lastStep:1-values.at(-2).progress});
    }
    const modes=[];
    for(const mode of ['teaser','tutorial']){
      document.querySelector('[name=reel-mode][value='+mode+']').click();
      const r=await lrcReel.makeRenderer(),cue=r.data.timeline.schedule.find(s=>s.scene==='crop');
      const expected=hasCropMotion(lrc.state.settings.globals);
      if(!cue){modes.push({mode,present:false,expected});continue;}
      const start=r.frame(cue.t0),mid=r.frame(cue.t0+.45),end=r.frame(cue.t1-1/30);
      modes.push({mode,present:true,expected,duration:cue.t1-cue.t0,
        start:start.crop.progress,mid:mid.crop.progress,end:end.crop.progress,
        stationaryViewport:JSON.stringify(start.photoRect)===JSON.stringify(end.photoRect)});
    }
    document.querySelector('[name=reel-mode][value=teaser]').click();
    return {cases,modes,uncropped:hasCropMotion({HasCrop:false,CropAngle:15}),identity:hasCropMotion({HasCrop:true})};
  })()`);
  assert.equal(result.uncropped,false);assert.equal(result.identity,false);
  for(const c of result.cases){
    assert.deepEqual(c.errors,[0,0],'Crop endpoints match the source and saved framing exactly');
    assert.ok(c.monotone);assert.ok(Math.abs(c.finalAngle+c.angle)<1e-6);
    assert.ok(c.firstStep<.001&&c.lastStep<.001,'Crop eases gently into and out of motion');
  }
  for(const m of result.modes){
    assert.equal(m.present,m.expected);
    if(m.present){assert.equal(m.duration,1);assert.equal(m.start,0);assert.equal(m.end,1);assert.ok(m.mid>0&&m.mid<1);assert.ok(m.stationaryViewport);}
  }
  console.log('CROP TRANSITION',JSON.stringify(result));
}
