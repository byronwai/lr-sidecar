export const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const header = `#version 300 es
precision highp float;
in vec2 uv;out vec4 frag;
uniform sampler2D image;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 linearize(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 encode(vec3 c){c=max(c,vec3(0));return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-9)),d/(q.x+1e-9),q.x);}
vec3 rgb(vec3 c){return c.z*mix(vec3(1),clamp(abs(fract(c.xxx+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.),c.y);}
`;
const adjustments = `
uniform vec4 tone; // contrast, highlights, shadows, whites
uniform vec4 detail; // blacks, clarity, texture, dehaze
uniform vec4 color; // exposure, temperature, tint, saturation
uniform vec3 whiteBalance;
uniform bool displayReferred;
uniform vec2 texel;
uniform sampler2D curve;
uniform float glow;
vec3 curveRGB(vec3 c){return vec3(texture(curve,vec2(clamp(c.r,0.,1.),.5)).r,texture(curve,vec2(clamp(c.g,0.,1.),.5)).g,texture(curve,vec2(clamp(c.b,0.,1.),.5)).b);}
vec3 adjust(vec3 src){
  vec3 c=linearize(src)*whiteBalance*vec3(exp(color.y*.16+color.z*.04),exp(-color.z*.06),exp(-color.y*.16+color.z*.04));
  float exposure=exp2(color.x);
  // A camera JPEG has already lost clipped highlights: anchor display white.
  c*=displayReferred?exposure/(1.+(exposure-1.)*pow(clamp(lum(c),0.,1.),4.)):exposure;
  float l=lum(c),lo=1.-smoothstep(.02,.55,l),hi=smoothstep(.2,1.,l);
  c*=exp2(tone.z*lo*.65+tone.y*hi*.65+tone.w*pow(hi,3.)*.45+detail.x*pow(lo,3.)*.45);
  c=pow(max(c,vec3(0))/.18,vec3(max(.2,1.+tone.x*.25)))*.18;
  c=(c-vec3(.025*detail.w))*(1.+detail.w*.35);
  vec3 blur=vec3(0);vec3 broad=vec3(0);
  for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 d=vec2(cos(a),sin(a));blur+=texture(image,uv+d*texel*2.).rgb/8.;broad+=texture(image,uv+d*texel*14.).rgb/8.;}
  c+=(linearize(src)-linearize(blur))*detail.z*.4+(linearize(src)-linearize(broad))*detail.y*.65;
  c+=linearize(broad)*glow*.12*smoothstep(.15,.9,lum(broad));
  c=encode(max(c,vec3(0)));c=mix(vec3(lum(c)),c,1.+color.w);
  return curveRGB(c);
}
`;
export const globalShader = header + adjustments + `
uniform vec3 hsl[8];uniform float vibrance;
uniform vec4 gradeShadow;uniform vec4 gradeMid;uniform vec4 gradeHigh;uniform vec4 gradeGlobal;
uniform vec2 gradeMix;
vec3 grade(vec3 c,vec4 g,float w){
  // Work on linear chroma, preserve Y, and keep the tint proportional to light.
  vec3 source=linearize(c),tint=linearize(rgb(vec3(g.x,1.,1.)));
  vec3 target=tint*lum(source)/max(lum(tint),1e-5);
  return encode(mix(source,target,clamp(g.y*w,0.,1.))*exp2(g.z*w));
}
void main(){vec3 c=adjust(texture(image,uv).rgb);vec3 h=hsv(c);vec3 delta=vec3(0);float total=0.;float centers[8]=float[8](0.,.08333,.16667,.33333,.5,.66667,.75,.83333);
for(int i=0;i<8;i++){float d=abs(h.x-centers[i]);d=min(d,1.-d);float w=exp(-pow(d/.075,2.))*smoothstep(.02,.2,h.y);delta+=hsl[i]*w;total+=w;}
delta/=max(1.,total);h.x=fract(h.x+delta.x/12.+1.);
h.y=clamp(h.y*(1.+delta.y)*(1.+vibrance*(1.-h.y)*.65),0.,1.);
// Hue-weighted luminance changes linear light, rather than HSV value or HSL lightness.
c=encode(linearize(rgb(h))*exp2(delta.z));
float l=lum(c),s=1.-smoothstep(.15+gradeMix.x*.15,.7+gradeMix.x*.15,l),hi=smoothstep(.3+gradeMix.x*.15,.9+gradeMix.x*.15,l);float b=mix(.6,1.4,gradeMix.y);
c=grade(c,gradeShadow,pow(s,b));c=grade(c,gradeMid,max(0.,1.-s-hi));c=grade(c,gradeHigh,pow(hi,b));c=grade(c,gradeGlobal,1.);frag=vec4(clamp(c,0.,1.),1.);}`;
export const localShader = header + adjustments + `
uniform sampler2D mask;uniform float amount;
void main(){vec3 src=texture(image,uv).rgb;frag=vec4(mix(src,adjust(src),clamp(texture(mask,uv).r*amount,0.,1.)),1.);}`;
export const removeShader = header + `
uniform sampler2D patchImage;uniform sampler2D mask;uniform vec4 rect;uniform vec3 gain;uniform vec3 bias;uniform float opacity;
void main(){vec3 c=texture(image,uv).rgb;vec2 p=(uv-rect.xy)/rect.zw;float inside=step(0.,p.x)*step(p.x,1.)*step(0.,p.y)*step(p.y,1.);vec3 fill=encode(max(vec3(0),linearize(texture(patchImage,p).rgb)*gain+bias));frag=vec4(mix(c,fill,texture(mask,p).r*inside*opacity),1.);}`;
export const maskShader = header + `
uniform sampler2D previous;uniform sampler2D raster;uniform sampler2D lumEq;
uniform int kind;uniform int blendMode;uniform bool first;uniform bool inverted;uniform bool flipped;
uniform vec4 rect;uniform vec4 geometry;uniform vec4 radial;uniform vec4 lumRange;
uniform vec3 samples[16];uniform int sampleCount;uniform vec3 labMin;uniform vec3 labMax;
uniform float strength;uniform float feather;uniform float colorAmount;uniform vec2 samplePoint;
uniform vec2 rasterEdgeRadius;uniform bool growRaster;
uniform bool warpRaster;uniform vec4 lensDistort;uniform vec2 imageSize;
float rasterSample(vec2 position){
  if(warpRaster){
    vec2 d=(position-.5)*imageSize;
    float r2=dot(d,d)/dot(imageSize*.5,imageSize*.5);
    float f=lensDistort.x+r2*(lensDistort.y+r2*(lensDistort.z+r2*lensDistort.w));
    position=.5+(position-.5)*f;
  }
  vec2 p=(position-rect.xy)/rect.zw;
  return texture(raster,p).r*step(0.,p.x)*step(p.x,1.)*step(0.,p.y)*step(p.y,1.);
}
float rasterCoverage(vec2 p) {
  float m=rasterSample(p);
  if(rasterEdgeRadius.x>0.){
    for(int i=0;i<8;i++){
      float a=float(i)*.7853981634;
      vec2 q=p+rasterEdgeRadius*vec2(cos(a),sin(a));
      // Edge radii are preview pixels in the image frame. Warp each tap before
      // mapping to the raster rect, including for cropped Origin/FullMaskSize.
      float tap=rasterSample(q);
      m=growRaster?max(m,tap):min(m,tap);
    }
  }
  return m;
}
vec3 lab(vec3 c){c=linearize(c);vec3 xyz=mat3(.4124564,.2126729,.0193339,.3575761,.7151522,.1191920,.1804375,.072175,.9503041)*c/vec3(.95047,1.,1.08883);vec3 f=mix(xyz*7.787+vec3(16./116.),pow(max(xyz,vec3(0)),vec3(1./3.)),step(vec3(.008856),xyz));return vec3((116.*f.y-16.)/100.,(500.*(f.x-f.y)+128.)/255.,(200.*(f.y-f.z)+128.)/255.);}
void main(){float m=0.;
if(kind==0){m=rasterCoverage(uv);}
if(kind==1){vec2 d=geometry.zw-geometry.xy;float t=clamp(dot(uv-geometry.xy,d)/max(dot(d,d),1e-8),0.,1.);m=t*t*(3.-2.*t);}
if(kind==2){vec2 p=uv-(rect.xy+rect.zw*.5);float aspect=max(1e-5,geometry.x);p.x*=aspect;float a=radians(radial.x);p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;vec2 q=abs(p/max(rect.zw*vec2(aspect,1.)*.5,vec2(.00001)));float exponent=clamp(2.+radial.z*.04,.5,8.);float d=pow(pow(q.x,exponent)+pow(q.y,exponent),1./exponent);m=1.-smoothstep(max(0.,1.-feather),1.,d);m=pow(m,log(.5)/log(clamp(radial.y/100.,.01,.99)));if(!flipped)m=1.-m;}
if(kind==3){float l=texture(lumEq,vec2(lum(linearize(texture(image,uv).rgb)),.5)).r;m=smoothstep(lumRange.x, max(lumRange.x+.00001,lumRange.y),l)*(1.-smoothstep(lumRange.z,max(lumRange.z+.00001,lumRange.w),l));}
if(kind==4){vec3 c=lab(texture(image,uv).rgb);float d=10.;for(int i=0;i<16;i++){if(i>=sampleCount)break;vec3 target=mix(labMin,labMax,samples[i]);d=min(d,length((c-target)*vec3(.5,1.,1.)));}if(sampleCount==0){vec3 target=lab(texture(image,samplePoint).rgb);d=length((c-target)*vec3(.5,1.,1.));}float tolerance=mix(.015,.25,colorAmount);m=1.-smoothstep(tolerance*.4,tolerance,d);}
if(inverted)m=1.-m;m*=strength;float p=texture(previous,uv).r;
if(first)p=blendMode==0?0.:1.;float result=blendMode==1?max(0.,p-m):blendMode==2?p*m:max(p,m);frag=vec4(vec3(clamp(result,0.,1.)),1.);}`;
export const copyShader = header + `void main(){frag=texture(image,uv);}`;
export const bands=['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'];
export function adjustmentUniforms(g,local=false){
  const n=(k,d=0)=>Number(g[(local?'Local':'')+k]??d),
  scale=local?1:.01;
  return {
    tone:[n('Contrast2012')*scale,n('Highlights2012')*scale,n('Shadows2012')*scale,n('Whites2012')*scale],
    detail:[n('Blacks2012')*scale,n('Clarity2012')*scale,n('Texture')*scale,n('Dehaze')*scale],
    // LocalExposure2012 is a -1..1 fraction of the +/-4 EV local slider.
    color:[n('Exposure2012')*(local?4:1),local?n('Temperature'):0,local?n('Tint'):0,
    n('Saturation')*scale],
    glow:n('Glow')*(local?1:.01)
  };
}
export function curveData(settings,local=false){
  const names=local?['MainCurve','RedCurve','GreenCurve','BlueCurve']:['ToneCurvePV2012','ToneCurvePV2012Red','ToneCurvePV2012Green',
  'ToneCurvePV2012Blue'];
  const curves=names.map(k=>(settings[k]||['0,0','255,255']).map(p=>String(p).split(/[, ]+/).map(Number)).sort((a,
  b)=>a[0]-b[0]));
  const evalCurve=(curve,x)=>{
    x*=255;
    let i=1;
    while(i<curve.length-1&&curve[i][0]<x)i++;
    const a=curve[i-1],
    b=curve[i]||a;
    return (a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0]||1))))/255;
  };
  const data=new Uint8Array(1024*4);
  for(let i=0;i<1024;i++){
    const x=evalCurve(curves[0],i/1023);
    for(let c=0;c<3;c++)data[i*4+c]=Math.round(Math.max(0,Math.min(1,evalCurve(curves[c+1],x)))*255);
    data[i*4+3]=255;
  }
  return data;
}
