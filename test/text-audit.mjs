// Browser-side audit of canvas text, including intermediate typewriter prefixes.
export async function auditText(){
  const {data,frame}=await lrcReel.makeRenderer(),t=data.timeline;
  const passes=lrc.reelPasses(),input=document.querySelector('#reel-description').value.trim();
  const cover=input || passes.length+(passes.length===1?' pass':' passes')+' → 1 frame';
  const source=new DOMParser().parseFromString(lrc.state.xmpText,'application/xml');
  const ns='http://ns.adobe.com/camera-raw-settings/1.0/';
  const descriptions=[...source.getElementsByTagNameNS('*','Description')];
  const global=descriptions.find(d=>d.hasAttributeNS(ns,'Version'));
  const corrections=descriptions.filter(d=>d.getAttributeNS(ns,'What')==='Correction');
  const read=(d,k)=>d.getAttributeNS(ns,k)??[...d.children].find(el=>el.localName===k)?.textContent.trim();
  const names=passes.map(p=>p.name).concat(lrc.state.settings.corrections.flatMap(c=>c.masks.map(m=>m.MaskName))).filter(Boolean);
  const fixed=['LIGHTROOM','ARW + XMP + ACR','compiled(edit);','before','after','PASS'];
  const vocabulary=new Set(('AI background subject sky mask Masking Linear Radial gradient Luminance Color range Brush raster rasters Global Basic Tone Curve Grading HSL Remove RGB Red Orange Yellow Green Aqua Blue Purple Magenta Hue Saturation Exposure Shadows Highlights Whites Blacks Contrast Temperature Tint Clarity Texture Dehaze Vibrance Glow Midtones Balance Blending WB White balance Profile H S L curves curve pts K full').toLowerCase().split(' '));
  const xmlTargets=new Map();
  const num=(v,d)=>Number(v).toFixed(d).replace(/^-/,'−');
  for(const p of passes){
    const values=new Set(),local=p.kind!=='globals';
    for(const d of (local?p.corrections.filter(c=>c.CorrectionActive!==false).map(c=>corrections[lrc.state.settings.corrections.indexOf(c)]):[global])){
      for(const [key,label] of Object.entries({Exposure2012:'Exposure',Highlights2012:'Highlights',Shadows2012:'Shadows',Contrast2012:'Contrast',Temperature:'Temperature',Tint:'Tint',Vibrance:'Vibrance',Saturation:'Saturation',Whites2012:'Whites',Blacks2012:'Blacks',Clarity2012:'Clarity',Texture:'Texture',Dehaze:'Dehaze',Glow:'Glow'})){
        const v=read(d,(local?'Local':'')+key);
        if(!Number(v))continue;
        // Lightroom units: local exposure is stored as a fraction of ±4 EV, other local sliders of ±100.
        const digits=key==='Exposure2012'?2:0,wb=!local&&key==='Temperature';
        const shown=local?(key==='Exposure2012'?Number(v)*4:Math.round(Number(v)*100)):Number(v);
        values.add((wb?'WB':label)+' '+num(wb?p.asShotKelvin||0:0,digits)+' → '+num(shown,digits)+(wb?' K':''));
        if(wb)values.add('White balance '+Math.round(v)+' K');
      }
      for(const band of ['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta'])for(const field of ['Hue','Saturation','Luminance']){
        const v=read(d,field+'Adjustment'+band);
        if(v)values.add(band+' '+field.toLowerCase()+' 0 → '+num(v,0));
      }
      const sat=read(d,'LocalToningSaturation');
      if(sat)values.add('Color '+Number(read(d,'LocalToningHue')||0).toFixed(0)+'° / '+Number(sat).toFixed(2));
      for(const [key,label] of [['MainCurve','RGB'],['RedCurve','Red'],['GreenCurve','Green'],['BlueCurve','Blue']]){
        const curve=d.getElementsByTagNameNS(ns,key)[0];
        if(curve)values.add(label+' curve · '+curve.getElementsByTagNameNS('*','li').length+' pts');
      }
    }
    xmlTargets.set(p.index,values);
  }
  const strings=new Set(),other=new Set(),valueErrors=new Set();
  const known=str=>{
    if(fixed.includes(str)||cover.includes(str)||t.camera===str||t.lens?.includes(str))return true;
    if(passes.some(p=>('PASS '+p.index+' · '+p.name).toLowerCase().includes(str.toLowerCase())))return true;
    let words=str;
    for(const n of [...names].sort((a,b)=>b.length-a.length))words=words.replaceAll(n,' ');
    words=words.replace(/[0-9.°①-⑳()∩∪−¬×→·+\s/-]+/gu,' ').trim();
    return !words || words.toLowerCase().split(/\s+/).every(w=>vocabulary.has(w));
  };
  const frames=Math.round(t.duration*30);
  for(let i=0;i<frames;i++){
    const m=frame(i/30),cue=t.schedule.find(c=>i/30<c.t1);
    for(const {text} of m.text){
      strings.add(text);
      const target=m.panelRows?.find(r=>r.text===text)?.target;
      if(!known(target||text))other.add(target||text);
      if(target && !target.startsWith(text))other.add(text);
    }
    for(const {target} of m.panelRows||[]){
      if(cue.scene==='payoff'||!(/→|°|\bpts\b|^White balance/.test(target)))continue;
      const ids=cue.pass?[cue.pass.index]:t.scores.filter(s=>s.disposition==='folded into rewind').map(s=>s.pass.index);
      if(!ids.some(id=>xmlTargets.get(id)?.has(target)))valueErrors.add(target);
    }
  }
  if(t.coverTitle!==cover)other.add(t.coverTitle);
  return {frames,strings:[...strings].sort(),other:[...other],valueErrors:[...valueErrors]};
}
