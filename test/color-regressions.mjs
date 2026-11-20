import assert from 'node:assert/strict';

// Synthetic ramps isolate colour math from camera profiles, crops and AI masks.
export async function colorRegressionChecks(evaluate){
  const result=await evaluate(`(async()=>{
    const {Pipeline}=await import('/render/gl.js');
    const canvas=new OffscreenCanvas(256,1),ctx=canvas.getContext('2d');
    const ramp=ctx.createImageData(256,1);
    for(let x=0;x<256;x++)ramp.data.set([x,x,x,255],x*4);
    ctx.putImageData(ramp,0,0);
    const p=new Pipeline(canvas,256,1),m={texture:p.white};
    const read=target=>{const data=p.pixels(target).data;p.release(target);return data;};
    const linear=v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4;
    const y=a=>a.slice(0,3).reduce((s,v,i)=>s+linear(v)*[.2126,.7152,.0722][i],0);
    try{
      const neutral=read(p.globals(p.input,{}));
      let identityError=0,maxLuminanceError=0,clippedHighlights=0;
      for(let i=0;i<ramp.data.length;i++)identityError=Math.max(identityError,Math.abs(neutral[i]-ramp.data[i]));
      for(const hue of [0,60,120,180,239,300]){
        const graded=read(p.globals(p.input,{SplitToningHighlightHue:hue,SplitToningHighlightSaturation:15}));
        for(let v=128;v<246;v++){
          const a=Array.from(graded.slice(v*4,v*4+3));
          maxLuminanceError=Math.max(maxLuminanceError,Math.abs(y(a)-linear(v)));
          if(Math.max(...a)===255)clippedHighlights++;
        }
        for(let k=0;k<3;k++)identityError=Math.max(identityError,Math.abs(graded[255*4+k]-255));
      }
      const exposures=[];
      for(const ev of [.001,.25,.5,1,2,4]){
        const bytes=read(p.correction(p.input,{LocalExposure2012:ev/4},m));
        let reversed=0,darkened=0;
        for(let v=1;v<256;v++){
          if(bytes[v*4]<bytes[(v-1)*4])reversed++;
          if(bytes[v*4]<v-1)darkened++;
        }
        exposures.push({ev,reversed,darkened,mid:bytes[128*4],white:bytes[255*4]});
      }
      const zeroMask=read(p.correction(p.input,{LocalExposure2012:1},{texture:p.zero}));
      const half=read(p.correction(p.input,{LocalExposure2012:.125},m));
      const negative=read(p.correction(p.input,{LocalExposure2012:-.25},m));
      let maskError=0;
      for(let i=0;i<ramp.data.length;i++)maskError=Math.max(maskError,Math.abs(zeroMask[i]-ramp.data[i]));
      return {identityError,maxLuminanceError,clippedHighlights,exposures,maskError,
        midtoneGain:linear(half[128*4])/linear(128),negativeGain:linear(negative[128*4])/linear(128)};
    }finally{p.dispose();}
  })()`);
  assert.ok(result.identityError<=1,'Neutral adjustments and pure white stay unchanged');
  assert.ok(result.maxLuminanceError<.008,'Colour grading preserves luminance within 8-bit rounding');
  assert.equal(result.clippedHighlights,0,'Moderate highlight tint must not clip a channel');
  assert.equal(result.maskError,0,'An empty mask must leave the photo untouched');
  assert.ok(result.exposures.every(e=>!e.reversed&&!e.darkened&&e.white===255),'Positive exposure stays monotone, brightens, and preserves white');
  assert.ok(Math.abs(result.midtoneGain-Math.SQRT2)<.02,'+0.5 EV retains its intended midtone gain');
  assert.ok(Math.abs(result.negativeGain-.5)<.01,'−1 EV retains its intended gain');
  console.log('COLOR REGRESSIONS',JSON.stringify(result));
  return result;
}
