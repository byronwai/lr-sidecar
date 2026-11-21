import {
  vertex,
  globalShader,
  localShader,
  removeShader,
  maskShader,
  copyShader,
  blurShader,
  adjustmentUniforms,
  calibrationUniforms,
  curveLUT,
  bands
} from './passes.js';
import { relativeWhiteBalance } from '../formats/wb.js';
const num=(o,k,d=0)=>Number(o[k]??d);
const numbers=s=>String(s??'').trim().split(/[,\s]+/).map(Number);
const clamp=x=>Math.max(0,Math.min(1,x));
export class Pipeline {
  constructor(bitmap,width,height){
    this.width=width;
    this.height=height;
    this.previewWidth=bitmap.width;
    this.previewHeight=bitmap.height;
    this.canvas=new OffscreenCanvas(width,height);
    const gl=this.gl=this.canvas.getContext('webgl2',{
      alpha:false,
      antialias:false,
      preserveDrawingBuffer:true
    });
    if(!gl)throw new Error('WebGL2 is unavailable. Enable hardware acceleration and reload.');
    if(Math.max(width,height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('Working image exceeds GPU texture limit');
    this.textures=[];
    this.framebuffers=[];
    this.programs=[];
    this.global=this.program(globalShader);
    this.local=this.program(localShader);
    this.remove=this.program(removeShader);
    this.mask=this.program(maskShader);
    this.copy=this.program(copyShader);
    this.blur=this.program(blurShader);
    this.input=this.texture(bitmap);
    this.zero=this.texture(new Uint8Array([0,0,0,255]),1,1);
    this.white=this.texture(new Uint8Array([255,255,255,255]),1,1);
    gl.bindVertexArray(gl.createVertexArray());
    this.lost=false;
    this.canvas.addEventListener('webglcontextlost',()=>{
      this.lost=true;
    });
  }
  program(fragment){
    const gl=this.gl,
    compile=(type,src)=>{
      const s=gl.createShader(type);
      gl.shaderSource(s,src);
      gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
        const msg=gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(msg);
      }
      return s;
    };
    const v=compile(gl.VERTEX_SHADER,vertex),
    f=compile(gl.FRAGMENT_SHADER,fragment),
    p=gl.createProgram();
    gl.attachShader(p,v);
    gl.attachShader(p,f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
    const uniforms=new Map();
    for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++){
      const u=gl.getActiveUniform(p,i);
      uniforms.set(u.name.replace('[0]',''),{
        ...u,
        type:u.type,
        location:gl.getUniformLocation(p,u.name)
      });
    }
    const out={
      p,
      uniforms
    };
    this.programs.push(p);
    return out;
  }
  texture(data,width,height){
    const gl=this.gl,
    t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(width)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,data);
    this.textures.push(t);
    return t;
  }
  target(width=this.width,height=this.height){
    const gl=this.gl,
    texture=this.texture(null,width,height),
    fbo=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('GPU framebuffer allocation failed');
    this.framebuffers.push(fbo);
    return {
      texture,
      fbo,
      width,
      height
    };
  }
  release(target){
    const gl=this.gl;
    gl.deleteTexture(target.texture);
    gl.deleteFramebuffer(target.fbo);
    this.textures=this.textures.filter(t=>t!==target.texture);
    this.framebuffers=this.framebuffers.filter(t=>t!==target.fbo);
  }
  draw(program,target,values={},textures={}){
    const gl=this.gl;
    if(this.lost)throw new Error('GPU context lost; try a smaller render');
    gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);
    gl.viewport(0,0,target.width,target.height);
    gl.useProgram(program.p);
    let unit=0;
    for(const [name,u]of program.uniforms){
      if(u.type!==gl.SAMPLER_2D)continue;
      gl.activeTexture(gl.TEXTURE0+unit);
      gl.bindTexture(gl.TEXTURE_2D,textures[name]||this.zero);
      gl.uniform1i(u.location,unit++);
    }
    for(const [name,value]of Object.entries(values)){
      const u=program.uniforms.get(name);
      if(!u)continue;
      const v=Array.isArray(value)||ArrayBuffer.isView(value)?value:[value];
      const funcs={
        [gl.FLOAT]:'uniform1fv',
        [gl.FLOAT_VEC2]:'uniform2fv',
        [gl.FLOAT_VEC3]:'uniform3fv',
        [gl.FLOAT_VEC4]:'uniform4fv',
        [gl.INT]:'uniform1iv',
        [gl.BOOL]:'uniform1iv'
      };
      gl[funcs[u.type]](u.location,v);
    }
    gl.drawArrays(gl.TRIANGLES,0,3);
    const err=gl.getError();
    if(err!==gl.NO_ERROR)throw new Error(`WebGL error 0x${err.toString(16)}`);
  }
  pixels(target){
    const gl=this.gl,
    data=new Uint8ClampedArray(target.width*target.height*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);
    gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    return new ImageData(data,target.width,target.height);
  }
  async bitmap(target,maxEdge=1100){
    const pixels=this.pixels(target),
    c=new OffscreenCanvas(target.width,target.height);
    c.getContext('2d').putImageData(pixels,0,0);
    const scale=Math.min(1,maxEdge/Math.max(c.width,c.height));
    return createImageBitmap(c,{
      resizeWidth:Math.max(1,Math.round(c.width*scale)),
      resizeHeight:Math.max(1,Math.round(c.height*scale))
    });
  }
  curve(settings,local=false){
    const {mode,data}=curveLUT(settings,local);
    return {mode,texture:data?this.texture(data,1024,1):this.white};
  }
  drawAdjustments(program,target,values,textures){
    const [,clarity,texture]=values.detail;
    if(values.glow)values.glowStep=[1/this.width,1/this.height];
    if(!texture&&!clarity)return this.draw(program,target,values,textures);
    let source=textures.image;
    let width=source===this.input?this.previewWidth:this.width;
    let height=source===this.input?this.previewHeight:this.height;
    let level=null;
    const blurs=[];
    try{
      for(const [active,name,edge] of [[texture,'fineBlur',1024],[clarity,'broadBlur',160]]){
        if(!active)continue;
        // Each bilinear 2:1 reduction averages the previous level's footprint.
        while(Math.max(width,height)>edge*1.5){
          width=Math.max(1,Math.ceil(width/2));
          height=Math.max(1,Math.ceil(height/2));
          const next=this.target(width,height);
          this.draw(this.copy,next,{}, {image:source});
          if(level)this.release(level);
          level=next;
          source=level.texture;
        }
        const step=Math.max(width,height)/edge;
        const horizontal=this.target(width,height),vertical=this.target(width,height);
        blurs.push(vertical);
        try{
          this.draw(this.blur,horizontal,{direction:[step/width,0]}, {image:source});
          this.draw(this.blur,vertical,{direction:[0,step/height]}, {image:horizontal.texture});
        }finally{this.release(horizontal);}
        textures[name]=vertical.texture;
      }
      this.draw(program,target,values,textures);
    }finally{
      if(level)this.release(level);
      for(const blur of blurs)this.release(blur);
    }
  }
  globals(source,g,asShot){
    const out=this.target(),
    curve=this.curve(g),
    grade=(hue,sat,l,lumStops=1)=>[num(g,hue)/360,num(g,sat)/100,num(g,l)*lumStops/100,0];
    this.drawAdjustments(this.global,out,{
      ...adjustmentUniforms(g),
      ...calibrationUniforms(g),
      parametricHighlights:[num(g,'ParametricHighlights')/100,Math.min(.99999,clamp(num(g,'ParametricHighlightSplit',75)/100))],
      curveMode:curve.mode,
      whiteBalance: relativeWhiteBalance(asShot, g).gains,
      displayReferred:true,
      hsl:bands.flatMap(b=>['Hue','Saturation','Luminance'].map(k=>num(g,k+'Adjustment'+b)/100)),
      vibrance:num(g,'Vibrance')/100,
      gradeShadow:grade('SplitToningShadowHue','SplitToningShadowSaturation','ColorGradeShadowLum',4),
      gradeMid:grade('ColorGradeMidtoneHue','ColorGradeMidtoneSat','ColorGradeMidtoneLum'),
      gradeHigh:grade('SplitToningHighlightHue','SplitToningHighlightSaturation','ColorGradeHighlightLum'),
      gradeGlobal:grade('ColorGradeGlobalHue','ColorGradeGlobalSat','ColorGradeGlobalLum'),
      gradeMix:[num(g,'SplitToningBalance')/100,num(g,'ColorGradeBlending',50)/100]
    },{
      image:source,
      curve:curve.texture
    });
    return out;
  }
  luminanceLUT(globals){
    const info=globals.RangeMaskMapInfo?.RangeMaskMapInfo||globals.RangeMaskMapInfo||{},
    points=(info.LumEq||['0 0','1 1']).map(numbers),
    data=new Uint8Array(1024*4);
    for(let i=0;i<1024;i++){
      const x=i/1023;
      let j=1;
      while(j<points.length-1&&points[j][0]<x)j++;
      const a=points[j-1],
      b=points[j]||a,
      y=a[1]+(b[1]-a[1])*clamp((x-a[0])/(b[0]-a[0]||1));
      data.fill(Math.round(clamp(y)*255),i*4,i*4+3);
      data[i*4+3]=255;
    }
    return {
      texture:this.texture(data,1024,1),
      info
    };
  }
  buildMask(correction,source,records,globals,rasterEdges={},lensDistort=null){
    let prev=this.target();
    this.draw(this.copy,prev,{}, {
      image:this.zero
    });
    const lut=this.luminanceLUT(globals);
    let first=true;
    for(const m of correction.masks){
      if(m.MaskActive===false)continue;
      const out=this.target(),
      type=m.What,
      values={
        first,
        blendMode:num(m,'MaskBlendMode'),
        inverted:m.MaskInverted===true,
        strength:num(m,'MaskBlendMode')===1?1:Math.abs(num(m,'MaskValue',1)),
        kind:0,
        rasterEdgeRadius:[0,0],
        growRaster:false,
        warpRaster:false,
        lensDistort:[1,0,0,0],
        imageSize:[this.width,this.height],
        rect:[0,0,1,1],
        geometry:[0,0,1,1],
        radial:[0,0,0,0],
        feather:.5,
        flipped:false,
        lumRange:[0,0,1,1],
        colorAmount:.5,
        sampleCount:0,
        samplePoint:[.5,.5],
        labMin:[0,0,0],
        labMax:[1,1,1]
      },
      textures={
        image:source,
        previous:prev.texture,
        raster:this.zero,
        lumEq:lut.texture
      };
      if(type==='Mask/Image'){
        const id=String(m.MaskDigest).toUpperCase();
        const r=records.get(id);
        if(!r)throw new Error(`Missing raster ${m.MaskDigest} (${correction.name})`);
        const origin=numbers(m.Origin),
        size=numbers(m.FullMaskSize);
        if(size.length!==2||size.some(x=>!Number.isFinite(x)||x<=0)||origin.length!==2)throw new Error('Invalid mask Origin/FullMaskSize');
        values.rect=[origin[0]/size[0],origin[1]/size[1],r.width/size[0],r.height/size[1]];
        const edge=Math.max(-32,Math.min(32,Number(rasterEdges[id])||0));
        values.rasterEdgeRadius=[
          Math.abs(edge)/this.previewWidth,
          Math.abs(edge)/this.previewHeight
        ];
        values.warpRaster=!!lensDistort;
        if(lensDistort)values.lensDistort=lensDistort;
        values.growRaster=edge>0;
        textures.raster=r.texture;
      }
      else if(type==='Mask/Gradient'){
        values.kind=1;
        values.geometry=[num(m,'ZeroX'),num(m,'ZeroY'),num(m,'FullX'),num(m,'FullY')];
      }
      else if(type==='Mask/CircularGradient'){
        values.kind=2;
        values.rect=[num(m,'Left'),num(m,'Top'),num(m,'Right')-num(m,'Left'),num(m,'Bottom')-num(m,'Top')];
        values.geometry=[this.width/this.height,0,0,0];
        values.radial=[num(m,'Angle'),num(m,'Midpoint',50),num(m,'Roundness'),0];
        values.feather=Math.max(.001,num(m,'Feather',50)/100);
        // Current XMP records the radial's polarity in both fields. Apply the
        // explicit component inversion once. Older radials only have Flipped.
        values.flipped=m.MaskInverted!=null || m.Flipped===true;
      }
      else if(type==='Mask/RangeMask'){
        const r=m.CorrectionRangeMask||{};
        values.kind=Number(r.Type)===2?3:4;
        values.lumRange=r.LumRange?numbers(r.LumRange):[0,0,1,1];
        values.colorAmount=num(r,'ColorAmount',.5);
        const models=r.AreaModels||[],
        samples=models.flatMap(a=>(a.AreaComponents||[]).map(numbers)).slice(0,16);
        values.sampleCount=samples.length;
        values.samples=samples.flatMap(a=>a.slice(0,3));
        if(!samples.length)delete values.samples;
        const point=models[0]?.ColorRangeMaskAreaSampleInfo;
        if(point)values.samplePoint=numbers(point).slice(0,2);
        values.labMin=numbers(lut.info.LabMin||'0 0 0');
        values.labMax=numbers(lut.info.LabMax||'1 1 1');
      }
      else if(type==='Mask/Paint')textures.raster=this.paint(m);
      else throw new Error(`Unsupported mask type ${type}`);
      this.draw(this.mask,out,values,textures);
      this.release(prev);
      prev=out;
      first=false;
    }
    return prev;
  }
  paint(m){
    const scale=Math.min(1,1536/this.width),
    w=Math.round(this.width*scale),
    h=Math.round(this.height*scale),
    c=new OffscreenCanvas(w,h),
    ctx=c.getContext('2d');
    ctx.fillStyle='black';
    ctx.fillRect(0,0,w,h);
    let radius=num(m,'Radius',.02),
    hard=num(m,'CenterWeight'),
    flow=num(m,'Flow',1);
    ctx.globalCompositeOperation='lighten';
    for(const command of m.Dabs||[]){
      const [op,...p]=String(command).split(/\s+/);
      if(op==='r')radius=+p[0];
      if(op==='h')hard=+p[0];
      if(op==='f')flow=+p[0];
      if(op==='d'){
        const x=+p[0]*w,
        y=+p[1]*h,
        r=Math.max(1,radius*Math.min(w,h));
        const g=ctx.createRadialGradient(x,y,Math.min(.999,hard)*r,x,y,r);
        g.addColorStop(0,`rgba(255,255,255,${clamp(flow)})`);
        g.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle=g;
        ctx.fillRect(x-r,y-r,r*2,r*2);
      }
    }
    return this.texture(c);
  }
  correction(source,c,mask){
    const out=this.target(),
    curve=this.curve(c,true);
    this.drawAdjustments(this.local,out,{
      ...adjustmentUniforms(c,true),
      curveMode:curve.mode,
      whiteBalance:[1,1,1],
      displayReferred:false,
      amount:num(c,'CorrectionAmount',1)
    },{
      image:source,
      curve:curve.texture,
      mask:mask.texture
    });
    return out;
  }
  patch(source,area,records){
    const patch=records.get(String(area.pm_patch).toUpperCase()),
    mask=records.get(String(area.pm_patch_mask).toUpperCase());
    if(!patch||!mask)throw new Error(`Missing Remove patch or blend mask: ${area.pm_patch}`);
    // Whole-image is the active preview within the slightly larger raw processing buffer.
    const left=num(area,'pm_whole_image_left',num(area,'pm_full_image_left')),
    top=num(area,'pm_whole_image_top',num(area,'pm_full_image_top')),
    w=num(area,'pm_whole_image_right',num(area,'pm_full_image_right'))-left,
    h=num(area,'pm_whole_image_bottom',num(area,'pm_full_image_bottom'))-top;
    if(w<=0||h<=0)throw new Error('Invalid Remove image bounds');
    const rect=[(num(area,'pm_target_left')-left)/w,(num(area,'pm_target_top')-top)/h,(num(area,'pm_target_right')-num(area,
    'pm_target_left'))/w,(num(area,'pm_target_bottom')-num(area,'pm_target_top'))/h];
    const stats=this.matchPatch(source,patch,mask,rect),
    out=this.target();
    this.draw(this.remove,out,{
      rect,
      ...stats,
      opacity:num(area,'Opacity',1)
    },{
      image:source,
      patchImage:patch.texture,
      mask:mask.texture
    });
    return {
      out,
      rect,
      stats
    };
  }
  matchPatch(source,patch,mask,rect){
    // Fit channel moments in linear light using the surrounding, unpainted patch pixels.
    const t=this.target(192,128);
    this.draw(this.copy,t,{}, {
      image:source
    });
    const dst=this.pixels(t);
    this.release(t);
    const sums=[new Float64Array(3),new Float64Array(3)],
    squares=[new Float64Array(3),new Float64Array(3)];
    let count=0;
    const lin=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
    for(let y=0;y<patch.height;y+=Math.max(1,Math.floor(patch.height/100)))for(let x=0;x<patch.width;x+=Math.max(1,
    Math.floor(patch.width/180))){
      const mx=Math.min(mask.width-1,Math.floor(x/patch.width*mask.width)),
      my=Math.min(mask.height-1,Math.floor(y/patch.height*mask.height));
      if(mask.data[(my*mask.width+mx)*4]>80)continue;
      const u=rect[0]+x/patch.width*rect[2],
      v=rect[1]+y/patch.height*rect[3];
      if(u<0||u>=1||v<0||v>=1)continue;
      const dp=(Math.floor(v*128)*192+Math.floor(u*192))*4,
      pp=(y*patch.width+x)*4;
      for(let c=0;c<3;c++){
        const a=lin(patch.data[pp+c]/255),
        b=lin(dst.data[dp+c]/255);
        sums[0][c]+=a;
        sums[1][c]+=b;
        squares[0][c]+=a*a;
        squares[1][c]+=b*b;
      }
      count++;
    }
    if(count<32)return {
      gain:[1,1,1],
      bias:[0,0,0]
    };
    const gain=[],
    bias=[];
    for(let c=0;c<3;c++){
      const a=sums[0][c]/count,
      b=sums[1][c]/count,
      sa=Math.sqrt(Math.max(1e-6,squares[0][c]/count-a*a)),
      sb=Math.sqrt(Math.max(1e-6,squares[1][c]/count-b*b)),
      g=Math.max(.25,Math.min(4,sb/sa));
      gain.push(g);
      bias.push(b-a*g);
    }
    return {
      gain,
      bias
    };
  }
  dispose(){
    for(const t of this.textures)this.gl.deleteTexture(t);
    for(const f of this.framebuffers)this.gl.deleteFramebuffer(f);
    for(const p of this.programs)this.gl.deleteProgram(p);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
export function orientCanvas(source,orientation=1,onTransform){
  const swap=orientation>=5,
  c=new OffscreenCanvas(swap?source.height:source.width,swap?source.width:source.height),
  ctx=c.getContext('2d'),
  w=source.width,
  h=source.height;
  const transforms={
    1:[1,0,0,1,0,0],
    2:[-1,0,0,1,w,0],
    3:[-1,0,0,-1,w,h],
    4:[1,0,0,-1,0,h],
    5:[0,1,1,0,0,0],
    6:[0,1,-1,0,h,0],
    7:[0,-1,-1,0,h,w],
    8:[0,-1,1,0,0,w]
  };
  ctx.setTransform(...(transforms[orientation]||transforms[1]));
  onTransform?.(ctx.getTransform());
  ctx.drawImage(source,0,0);
  return c;
}
export function finishCanvas(pixels,settings,orientation){
  const base=new OffscreenCanvas(pixels.width,pixels.height);
  base.getContext('2d').putImageData(pixels,0,0);
  return finishOrientedCanvas(orientCanvas(base,orientation),settings,orientation);
}
// Reel frames and masks are already oriented. Apply the same crop to each.
export function finishOrientedCanvas(src,settings,orientation,onTransform){
  const g=settings.globals;
  if(!g.HasCrop)return {
    canvas:src,
    crop:{
      width:1,
      height:1,
      angle:0
    }
  };
  const angle=num(g,'CropAngle')*Math.PI/180,
  l=num(g,'CropLeft'),
  r=num(g,'CropRight',1),
  t=num(g,'CropTop'),
  b=num(g,'CropBottom',1),
  cw=r-l,
  ch=b-t;
  if(cw<=0||ch<=0||l<0||t<0||r>1||b>1)throw new Error('Invalid XMP crop rectangle');
  // Lightroom stores crop bounds in SENSOR coordinates, including for orientation 8.
  // Rotate the rectangle's diagonal (not its bounding box), then swap for portrait.
  // The sample gives (6515.84,4343.89) before the swap, matching 4344x6516 export.
  const swap=orientation>=5,
  ca=Math.cos(angle),
  sa=Math.sin(angle),
  sw=(swap?src.height:src.width)*cw,
  sh=(swap?src.width:src.height)*ch;
  const rw=Math.abs(sw*ca+sh*sa),
  rh=Math.abs(sh*ca-sw*sa);
  let w=swap?rh:rw,
  h=swap?rw:rh;
  if(w<=0||h<=0)throw new Error('Crop angle and bounds produce an empty crop');
  // Keep the rotated crop inside the source; the stored bounds may touch an edge.
  const fit=Math.min(1,src.width/(w*Math.abs(ca)+h*Math.abs(sa)),src.height/(h*Math.abs(ca)+w*Math.abs(sa)));
  w*=fit;
  h*=fit;
  const centers={
    1:[(l+r)/2,(t+b)/2],
    2:[1-(l+r)/2,(t+b)/2],
    3:[1-(l+r)/2,1-(t+b)/2],
    4:[(l+r)/2,1-(t+b)/2],
    5:[(t+b)/2,(l+r)/2],
    6:[1-(t+b)/2,(l+r)/2],
    7:[1-(t+b)/2,1-(l+r)/2],
    8:[(t+b)/2,1-(l+r)/2]
  };
  const center=centers[orientation]||centers[1];
  const out=new OffscreenCanvas(Math.max(1,Math.round(w)),Math.max(1,Math.round(h))),
  ctx=out.getContext('2d');
  ctx.translate(out.width/2,out.height/2);
  ctx.rotate(-angle);
  onTransform?.(ctx.getTransform().translate(-src.width*center[0],-src.height*center[1]));
  ctx.drawImage(src,-src.width*center[0],-src.height*center[1]);
  return {
    canvas:out,
    crop:{
      width:out.width/src.width,
      height:out.height/src.height,
      storedWidth:cw,
      angle:num(g,'CropAngle')
    }
  };
}
