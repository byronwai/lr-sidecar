import {WIDTH,HEIGHT} from './timeline.js';

export const isSubject=m=>m.What==='Mask/Image' && /主體|主体|人物|人像|subject|person|people/i.test(m.MaskName);

export function subjectFaces(masks,settings){
  return settings.corrections.flatMap((c,i)=>c.masks.flatMap((m,j)=>{
    const image=masks[i+':'+j];
    return isSubject(m)&&image?[image]:[];
  }));
}

export function subjectMatte(images,rect){
  const canvas=new OffscreenCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.globalCompositeOperation='lighten';
  for(const image of images)ctx.drawImage(image,rect.x,rect.y,rect.w,rect.h);
  const data=ctx.getImageData(0,0,WIDTH,HEIGHT);
  for(let p=0;p<data.data.length;p+=4)data.data[p+3]=data.data[p]>=128?255:0;
  ctx.putImageData(data,0,0);
  return canvas;
}

