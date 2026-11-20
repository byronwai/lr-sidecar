export function hasCropMotion(g={}){
  return !!g.HasCrop && (Math.abs(Number(g.CropAngle)||0)>1e-5 ||
    ['CropLeft','CropTop'].some(k=>Math.abs(Number(g[k])||0)>1e-5) ||
    ['CropRight','CropBottom'].some(k=>Math.abs(Number(g[k]??1)-1)>1e-5));
}

// The viewport stays fixed. Only the saved crop/straightening transform moves;
// quintic easing gives zero speed and acceleration at both ends.
export function drawCropTransition(ctx,sources,finished,rect,progress){
  const p=Math.max(0,Math.min(1,progress)),ease=p*p*p*(p*(p*6-15)+10);
  const motion=sources?.cropMotion;
  if(!motion){ctx.drawImage(finished,rect.x,rect.y,rect.w,rect.h);return {progress:1,angle:0};}
  const image=motion.image;
  const end=new DOMMatrix().translate(rect.x,rect.y).scale(rect.w/motion.width,rect.h/motion.height)
    .multiply(new DOMMatrix(motion.matrix));
  const angle=Math.atan2(end.b,end.a),sx=Math.hypot(end.a,end.b);
  const sy=(end.a*end.d-end.b*end.c)/sx,shear=(end.a*end.c+end.b*end.d)/sx;
  const center=end.transformPoint({x:image.width/2,y:image.height/2});
  const fit=Math.min(rect.w/image.width,rect.h/image.height),mix=(a,b)=>a+(b-a)*ease;
  ctx.save();
  ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
  if(p===0)ctx.drawImage(sources.original,rect.x,rect.y,rect.w,rect.h);
  else if(p===1)ctx.drawImage(finished,rect.x,rect.y,rect.w,rect.h);
  else{
    ctx.translate(mix(rect.x+rect.w/2,center.x),mix(rect.y+rect.h/2,center.y));
    ctx.rotate(angle*ease);
    ctx.transform(mix(fit,sx),0,shear*ease,mix(fit,sy),0,0);
    ctx.drawImage(image,-image.width/2,-image.height/2);
  }
  ctx.restore();
  return {progress:ease,angle:angle*ease};
}
