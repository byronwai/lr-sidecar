// All coordinates stay in the unrotated sensor frame, just like buildMask.
export function warpPosition(u,v,width,height,k){
  const x=(u-.5)*width,y=(v-.5)*height;
  const r2=(x*x+y*y)/((width*width+height*height)*.25);
  const f=k[0]+r2*(k[1]+r2*(k[2]+r2*k[3]));
  return [.5+(u-.5)*f,.5+(v-.5)*f];
}
function sample(data,w,h,u,v){
  const x=u*w-.5,y=v*h-.5;
  if(x<0||y<0||x>w-1||y>h-1)return 0;
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const a=data[iy*w+ix],b=data[iy*w+Math.min(ix+1,w-1)];
  const c=data[Math.min(iy+1,h-1)*w+ix],d=data[Math.min(iy+1,h-1)*w+Math.min(ix+1,w-1)];
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}
function gradient(data,w,h){
  // A small separable blur makes the score tolerant of JPEG texture and the
  // mask's soft boundary without hiding the several-pixel lens displacement.
  const tmp=new Float32Array(data.length),blur=new Float32Array(data.length),out=new Float32Array(data.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;
    tmp[p]=(data[y*w+Math.max(0,x-1)]+2*data[p]+data[y*w+Math.min(w-1,x+1)])/4;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x;
    blur[p]=(tmp[Math.max(0,y-1)*w+x]+2*tmp[p]+tmp[Math.min(h-1,y+1)*w+x])/4;
  }
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const p=y*w+x;
    out[p]=Math.hypot(blur[p+1]-blur[p-1],blur[p+w]-blur[p-w]);
  }
  return out;
}
function correlation(a,b,w,h){
  let n=0,sa=0,sb=0,aa=0,bb=0,ab=0;
  // Ignore the artificial boundary of the image/canvas.
  for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++){
    const i=y*w+x,u=a[i],v=b[i];
    n++;sa+=u;sb+=v;aa+=u*u;bb+=v*v;ab+=u*v;
  }
  return (ab-sa*sb/n)/Math.sqrt(Math.max(1e-20,(aa-sa*sa/n)*(bb-sb*sb/n)));
}
export function scoreAlignment(image,mask,width,height,k){
  const warped=new Float32Array(mask.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const [u,v]=warpPosition((x+.5)/width,(y+.5)/height,width,height,k);
    warped[y*width+x]=sample(mask,width,height,u,v);
  }
  const reference=gradient(image,width,height);
  const off=correlation(reference,gradient(mask,width,height),width,height);
  const warp=correlation(reference,gradient(warped,width,height),width,height);
  // An ambiguous result must leave the raster alone. A relative and absolute
  // margin prevent weak correlations from enabling a warp accidentally.
  const margin=Math.max(.01,Math.abs(off)*.08);
  return {off,warp,margin,apply:warp>.05&&warp-off>margin};
}
export function detectMaskAlignment(preview,settings,rasters){
  if(!settings.lensDistort)return {apply:false,reason:'No valid LensDistortInfo',off:null,warp:null};
  let chosen;
  for(const c of settings.corrections)for(const m of c.masks){
    if(m.What!=='Mask/Image'||m.MaskActive===false)continue;
    const r=rasters.get(String(m.MaskDigest).toUpperCase());
    if(r&&(!chosen||r.width*r.height>chosen.r.width*chosen.r.height))chosen={r,m};
  }
  if(!chosen)return {apply:false,reason:'No referenced AI raster',off:null,warp:null};
  const width=Math.round(720*preview.width/Math.max(preview.width,preview.height));
  const height=Math.round(720*preview.height/Math.max(preview.width,preview.height));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(preview,0,0,width,height);
  const pixels=ctx.getImageData(0,0,width,height).data;
  const image=Float32Array.from({length:width*height},(_,i)=>(pixels[i*4]*.2126+pixels[i*4+1]*.7152+pixels[i*4+2]*.0722)/255);
  const {r,m}=chosen,origin=String(m.Origin).trim().split(/[,\s]+/).map(Number),size=String(m.FullMaskSize).trim().split(/[,\s]+/).map(Number);
  if(origin.length!==2||!origin.every(Number.isFinite)||size.length!==2||!size.every(v=>Number.isFinite(v)&&v>0))return {apply:false,reason:'Invalid raster bounds',off:null,warp:null};
  const raw=new OffscreenCanvas(r.width,r.height);
  raw.getContext('2d').putImageData(new ImageData(r.data,r.width,r.height),0,0);
  ctx.fillStyle='black';ctx.fillRect(0,0,width,height);
  ctx.drawImage(raw,origin[0]/size[0]*width,origin[1]/size[1]*height,r.width/size[0]*width,r.height/size[1]*height);
  const data=ctx.getImageData(0,0,width,height).data;
  const mask=Float32Array.from({length:width*height},(_,i)=>data[i*4]/255);
  const result=scoreAlignment(image,mask,width,height,settings.lensDistort);
  return {...result,id:r.id,width,height,reason:result.apply?'Warp correlation wins by a clear margin':'Off wins or correlation is ambiguous'};
}
