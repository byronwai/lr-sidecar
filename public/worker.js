import {
  parseARW
} from './formats/arw.js';
import { parseCR3 } from './formats/cr3.js';
import {
  parseACR,
  inflateReceipt
} from './formats/acr.js';
import decode from './vendor/jsquash-jxl/decode.js';
import { detectMaskAlignment } from './render/mask-alignment.js';
import {
  Pipeline,
  orientCanvas,
  finishOrientedCanvas,
  finishCanvas
} from './render/gl.js';
let preview=null,arw=null,rasters=new Map(),pipeline=null,outputs=new Map(),settings=null,busy=false;
let alignmentCache=null;
function rasterAlignment(message){
  const key=JSON.stringify([message.settings.lensDistort,message.settings.corrections.map(c=>c.masks)]);
  if(alignmentCache?.key!==key)alignmentCache={key,result:detectMaskAlignment(preview,message.settings,rasters,arw.lensCorrections)};
  const result=alignmentCache.result,mode=message.rasterWarp||'auto';
  const apply=!!message.settings.lensDistort&&(mode==='warp'||(mode==='auto'&&result.apply));
  send('mask-alignment',{job:message.job,report:{...result,mode,enabled:apply}});
  const score=n=>n==null?'n/a':n.toFixed(4);
  send('log',{job:message.job,message:`AI raster alignment: off=${score(result.off)}, warp=${score(result.warp)}; auto=${result.apply?'Warp':'Off'} (${result.reason}); ${mode} → ${apply?'Warp':'Off'}.`});
  return apply?message.settings.lensDistort:null;
}
const send=(type,data={},transfer=[])=>postMessage({
  type,
  ...data
},transfer);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function rawCanvas(r){
  const c=new OffscreenCanvas(r.width,r.height);
  c.getContext('2d').putImageData(new ImageData(r.data,r.width,r.height),0,0);
  return c;
}
async function decodeRaster(bytes,r,job){
  const data=new Uint8ClampedArray(r.width*r.height*4),
  columns=Math.ceil(r.width/r.tileWidth);
  for(let i=0;i<r.tileOffsets.length;i++){
    const at=r.tiffOffset+r.tileOffsets[i],
    tile=await decode(bytes.slice(at,at+r.tileByteCounts[i]).buffer),
    x=(i%columns)*r.tileWidth,
    y=Math.floor(i/columns)*r.tileHeight;
    if(tile.width<Math.min(r.tileWidth,r.width-x)||tile.height<Math.min(r.tileHeight,r.height-y))throw new Error(`Short decoded tile ${r.id}`);
    for(let row=0;row<Math.min(tile.height,r.height-y);row++){
      const w=Math.min(tile.width,r.width-x);
      data.set(tile.data.subarray(row*tile.width*4,(row*tile.width+w)*4),((y+row)*r.width+x)*4);
    }
    send('progress',{
      job,
      stage:'acr',
      message:`JXL ${r.id.slice(0,8)} · tile ${i+1}/${r.tileOffsets.length}`
    });
    await delay(0);
  }
  return {
    ...r,
    data
  };
}
async function thumbnail(bitmap,max=1000){
  const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  return createImageBitmap(bitmap,{
    resizeWidth:Math.max(1,Math.round(bitmap.width*scale)),
    resizeHeight:Math.max(1,Math.round(bitmap.height*scale))
  });
}
// All Reel images share the final crop/straightening, including the before and masks.
async function reelThumbnail(source,max=1600){
  const scale=Math.min(1,max/Math.max(source.width,source.height));
  const canvas=new OffscreenCanvas(Math.round(source.width*scale),Math.round(source.height*scale));
  const ctx=canvas.getContext('2d');
  ctx.drawImage(source,0,0,canvas.width,canvas.height);
  return createImageBitmap(finishCanvas(ctx.getImageData(0,0,canvas.width,canvas.height),settings,settings.orientation||arw.orientation).canvas);
}
async function showOutput(index,job){
  const out=outputs.get(index);
  if(!out)throw new Error('Compile this pass before selecting it');
  const pixels=pipeline.pixels(out),
  done=finishCanvas(pixels,settings,settings.orientation||arw.orientation),
  bitmap=await thumbnail(done.canvas);
  send('intermediate',{
    job,
    index,
    bitmap,
    width:done.canvas.width,
    height:done.canvas.height
  },[bitmap]);
}
async function maskFace(mask,color,renderer=pipeline){
  const bitmap=await renderer.bitmap(mask,650),
  c=new OffscreenCanvas(bitmap.width,bitmap.height),
  ctx=c.getContext('2d');
  ctx.drawImage(bitmap,0,0);
  bitmap.close();
  const image=ctx.getImageData(0,0,c.width,c.height),
  rgb=color.match(/\w\w/g).map(x=>parseInt(x,16));
  for(let i=0;i<image.data.length;i+=4){
    const value=image.data[i]/255;
    image.data[i]=rgb[0]*value;
    image.data[i+1]=rgb[1]*value;
    image.data[i+2]=rgb[2]*value;
    image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  return reelThumbnail(c);
}
function patchFace(areas,width,height){
  const c=new OffscreenCanvas(width,height),
  ctx=c.getContext('2d');
  ctx.fillStyle='#070d18';
  ctx.fillRect(0,0,width,height);
  for(const area of areas){
    const patch=rasters.get(String(area.pm_patch).toUpperCase()),
    mask=rasters.get(String(area.pm_patch_mask).toUpperCase());
    if(!patch||!mask)throw new Error('Missing Remove patch');
    const pc=rawCanvas(patch),
    pctx=pc.getContext('2d'),
    pi=pctx.getImageData(0,0,pc.width,pc.height);
    for(let y=0;y<pc.height;y++)for(let x=0;x<pc.width;x++){
      const mx=Math.min(mask.width-1,Math.floor(x/pc.width*mask.width)),
      my=Math.min(mask.height-1,Math.floor(y/pc.height*mask.height));
      pi.data[(y*pc.width+x)*4+3]=mask.data[(my*mask.width+mx)*4];
    }
    pctx.putImageData(pi,0,0);
    const left=area.pm_whole_image_left??area.pm_full_image_left??0,
    top=area.pm_whole_image_top??area.pm_full_image_top??0,
    w=(area.pm_whole_image_right??area.pm_full_image_right)-left,
    h=(area.pm_whole_image_bottom??area.pm_full_image_bottom)-top;
    ctx.drawImage(pc,(area.pm_target_left-left)/w*width,(area.pm_target_top-top)/h*height,(area.pm_target_right-area.pm_target_left)/w*width,
    (area.pm_target_bottom-area.pm_target_top)/h*height);
  }
  return c;
}
async function prepareFaces(m){
  settings=m.settings;
  const lensDistort=rasterAlignment(m);
  const width=768,
  height=Math.round(width*preview.height/preview.width),
  renderer=new Pipeline(preview,width,height),
  records=new Map();
  try{
    for(const r of rasters.values())records.set(r.id,{
      ...r,
      texture:renderer.texture(rawCanvas(r))
    });
    for(let i=0;i<m.groups.length;i++){
      const group=m.groups[i];
      let face;
      if(group.kind==='globals')face=await thumbnail(orientCanvas(preview,settings.orientation||arw.orientation),850);
      else if(group.kind==='remove')face=await createImageBitmap(orientCanvas(patchFace(settings.remove,width,height),
      settings.orientation||arw.orientation));
      else {
        let union=renderer.target();
        renderer.draw(renderer.copy,union,{}, {
          image:renderer.zero
        });
        for(const index of group.corrections){
          const mask=renderer.buildMask(settings.corrections[index],renderer.input,records,settings.globals,m.rasterEdges,lensDistort),
          next=renderer.target();
          renderer.draw(renderer.mask,next,{
            kind:0,
            warpRaster:false,
            rasterEdgeRadius:[0,0],
            growRaster:false,
            blendMode:0,
            first:false,
            inverted:false,
            strength:1,
            rect:[0,0,1,1]
          },{
            image:renderer.input,
            previous:union.texture,
            raster:mask.texture
          });
          renderer.release(mask);
          renderer.release(union);
          union=next;
        }
        face=await maskFace(union,group.color.slice(1),renderer);
        renderer.release(union);
      }
      send('face',{
        job:m.job,
        index:i,
        face
      },[face]);
    }
    send('faces',{
      job:m.job
    });
  }finally{
    renderer.dispose();
  }
}
// Prepare individual mask geometry in the same crop as the compiled frame.
async function tutorialSources({job, groups, rasterEdges, rasterWarp}) {
  const orientation = settings.orientation || arw.orientation;
  const sensor = await thumbnail(preview,1400);
  let orient, crop = new DOMMatrix();
  const oriented = orientCanvas(sensor,orientation,m=>orient=m);
  const finished = finishOrientedCanvas(oriented,settings,orientation,m=>crop=m).canvas;
  const transform = new DOMMatrix().scale(1/finished.width,1/finished.height)
    .multiply(crop).multiply(orient).scale(sensor.width,sensor.height);
  const camera=new OffscreenCanvas(finished.width,finished.height);
  const scale=Math.min(camera.width/oriented.width,camera.height/oriented.height);
  const w=oriented.width*scale,h=oriented.height*scale,ctx=camera.getContext('2d');
  ctx.fillStyle='#04070f';ctx.fillRect(0,0,camera.width,camera.height);
  ctx.drawImage(oriented,(camera.width-w)/2,(camera.height-h)/2,w,h);
  const original=camera.transferToImageBitmap();
  const cropMotion=settings.globals.HasCrop?{
    image:await createImageBitmap(oriented),width:finished.width,height:finished.height,
    matrix:[crop.a,crop.b,crop.c,crop.d,crop.e,crop.f]
  }:null;
  sensor.close();
  const masks = {};
  const lens = rasterWarp==='warp' || rasterWarp==='auto' && alignmentCache?.result.apply ? settings.lensDistort : null;
  // Individual AI selections can be subtracted or intersected. The chapter's
  // composited face cannot identify any one of those contours.
  for (const [pass, indices] of groups.entries()) {
    let prior=null;
    try {
      for (const [i,index] of indices.entries()) {
        const correction=settings.corrections[index];
        if(correction.CorrectionActive===false)continue;
        const input=prior?.texture || outputs.get(pass-1)?.texture || pipeline.input;
        for (const [j,m] of correction.masks.entries()) {
          if (m.MaskActive===false || !['Mask/Image','Mask/RangeMask','Mask/Paint'].includes(m.What)) continue;
          const target=pipeline.buildMask({masks:[{...m,MaskBlendMode:0,MaskValue:1,MaskInverted:false}]},
            input,rasters,settings.globals,rasterEdges,lens);
          try {
            const key=index+':'+j;
            masks[key]=await maskFace(target,'ffffff');

          }
          finally { pipeline.release(target); }
        }
        // Range selections sample the image entering this correction, which
        // can be partway through a group of parametric edits.
        const needsInput=indices.slice(i+1).some(k=>settings.corrections[k].masks.some(m=>m.What==='Mask/RangeMask'));
        if(needsInput){
          const mask=pipeline.buildMask(correction,input,rasters,settings.globals,rasterEdges,lens);
          try {
            const next=pipeline.correction(input,correction,mask);
            if(prior)pipeline.release(prior);
            prior=next;
          } finally {pipeline.release(mask);}
        }
      }
    } finally {if(prior)pipeline.release(prior);}
  }
  send('tutorial',{job,original,cropMotion,masks,transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f]},
    [original,...(cropMotion?[cropMotion.image]:[]),...Object.values(masks)]);
}

async function compile(message){
  if(!preview)throw new Error('Read RAW before compiling');
  settings=message.settings;
  const lensDistort=rasterAlignment(message);
  const {
    job,
    groups,
    disabled=[],
    fullRes=false,
    animate=true
  }=message;
  pipeline?.dispose();
  outputs.clear();
  const scale=fullRes?1:Math.min(1,3072/Math.max(preview.width,preview.height)),
  width=Math.round(preview.width*scale),
  height=Math.round(preview.height*scale);
  pipeline=new Pipeline(preview,width,height);
  for(const r of rasters.values())r.texture=pipeline.texture(rawCanvas(r));
  let source=pipeline.input,
  previous=null;
  for(let i=0;i<groups.length;i++){
    const group=groups[i],
    start=performance.now();
    send('pass-start',{
      job,
      index:i,
      name:group.name
    });
    const enabled=!disabled.includes(i);
    let out,
    face;
    if(group.kind==='globals'){
      out=enabled?pipeline.globals(source,settings.globals,arw.whiteBalance):pipeline.target();
      if(!enabled)pipeline.draw(pipeline.copy,out,{}, {
        image:source
      });
      face=await thumbnail(orientCanvas(preview,settings.orientation||arw.orientation),900);
    }
    else if(group.kind==='remove'){
      for(const area of settings.remove){
        const result=pipeline.patch(source,area,rasters);
        if(out&&out!==previous)pipeline.release(out);
        out=result.out;
        source=out.texture;
        send('log',{
          job,
          message:`Remove colour match (linear moments): gain ${result.stats.gain.map(x=>x.toFixed(3)).join(', ')}. pm_remap_info preserved, not interpreted.`
        });
      }
      if(!out) {
        out=pipeline.target();
        pipeline.draw(pipeline.copy,out,{}, {
          image:previous?.texture||pipeline.input
        });
      }
      if(!enabled)pipeline.draw(pipeline.copy,out,{}, {
        image:previous?.texture||pipeline.input
      });
      face=await createImageBitmap(orientCanvas(patchFace(settings.remove,768,Math.round(768*height/width)),settings.orientation||arw.orientation));
    }else{
      const union=pipeline.target();
      pipeline.draw(pipeline.copy,union,{}, {
        image:pipeline.zero
      });
      let maskUnion=union;
      for(const index of group.corrections){
        const c=settings.corrections[index],
        s=performance.now(),
        mask=pipeline.buildMask(c,source,rasters,settings.globals,message.rasterEdges,lensDistort),
        next=pipeline.target();
        pipeline.draw(pipeline.mask,next,{
          kind:0,
          warpRaster:false,
          rasterEdgeRadius:[0,0],
          growRaster:false,
          blendMode:0,
          first:false,
          inverted:false,
          strength:1,
          rect:[0,0,1,1]
        },{
          image:source,
          previous:maskUnion.texture,
          raster:mask.texture
        });
        pipeline.release(maskUnion);
        maskUnion=next;
        const rendered=enabled&&c.CorrectionActive!==false?pipeline.correction(source,c,mask):pipeline.target();
        if(!enabled||c.CorrectionActive===false)pipeline.draw(pipeline.copy,rendered,{}, {
          image:source
        });
        if(out&&out!==previous)pipeline.release(out);
        out=rendered;
        source=out.texture;
        pipeline.release(mask);
        pipeline.gl.finish();
        send('correction',{
          job,
          index,
          name:c.name,
          ms:performance.now()-s
        });
      }
      face=await maskFace(maskUnion,group.color.slice(1));
      pipeline.release(maskUnion);
    }
    pipeline.gl.finish();
    const ms=performance.now()-start;
    outputs.set(i,out);
    source=out.texture;
    previous=out;
    const previewBitmap=await pipeline.bitmap(out,1400);
    const bitmap=await reelThumbnail(previewBitmap);
    previewBitmap.close();
    send('pass-done',{
      job,
      index:i,
      ms,
      enabled,
      bitmap,
      face
    },[bitmap,face]);
    if(animate)await delay(Math.max(0,550-ms));
  }
  const final=finishCanvas(pipeline.pixels(previous),settings,settings.orientation||arw.orientation),
  png=await final.canvas.convertToBlob({
    type:'image/png'
  }),
  jpg=await final.canvas.convertToBlob({
    type:'image/jpeg',
    quality:.95
  }),
  bitmap=await thumbnail(final.canvas,1600),
  original=await reelThumbnail(preview);
  send('compiled',{
    job,
    width:final.canvas.width,
    height:final.canvas.height,
    workingWidth:width,
    workingHeight:height,
    crop:final.crop,
    png,
    jpg,
    bitmap
    ,original
  },[bitmap,original]);
}
onmessage=async event=>{
  const m=event.data,
  {
    job
  }=m;
  const start=performance.now();
  if(busy){
    send('error',{
      job,
      stage:m.type,
      message:'Worker is busy; wait for the current operation'
    });
    return;
  }
  busy=true;
  try{
    if(m.type==='arw'){
      alignmentCache=null;
      preview?.close();
      preview=null;
      arw=null;
      const result=m.format==='CR3'?parseCR3(m.buffer):parseARW(m.buffer);
      preview=await createImageBitmap(new Blob([result.jpeg],{
        type:'image/jpeg'
      }),{
        imageOrientation:'none'
      });
      const display=orientCanvas(preview,result.orientation),
      bitmap=await thumbnail(display,1400);
      const {
        jpeg,
        ...report
      }=result;
      arw=report;
      send('arw',{
        job,
        report,
        bitmap,
        ms:performance.now()-start
      },[bitmap]);
    }else if(m.type==='acr'){
      alignmentCache=null;
      rasters.clear();
      const bytes=new Uint8Array(m.buffer),
      report=parseACR(bytes);
      for(const r of report.records){
        if(r.kind==='raster')rasters.set(r.id,await decodeRaster(bytes,r,job));
        else r.receipt=await inflateReceipt(bytes,r);
      }
      send('acr',{
        job,
        report,
        ms:performance.now()-start
      });
    }else if(m.type==='faces')await prepareFaces(m);
    else if(m.type==='compile')await compile(m);
    else if(m.type==='tutorial'){
      // Temporary curve textures, raster brush textures and range LUTs belong
      // to this request. Retain only the compiler's existing pass outputs.
      const textures=pipeline.textures.length, buffers=pipeline.framebuffers.length;
      try {await tutorialSources(m);}
      finally {
        for(const texture of pipeline.textures.splice(textures))pipeline.gl.deleteTexture(texture);
        for(const buffer of pipeline.framebuffers.splice(buffers))pipeline.gl.deleteFramebuffer(buffer);
      }
    }
    else if(m.type==='show')await showOutput(m.index,job);
  }catch(error){
    send('error',{
      job,
      stage:m.type,
      message:error.message,
      stack:error.stack
    });
  }
  finally{
    busy=false;
  }
};
