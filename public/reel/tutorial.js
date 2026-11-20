import { MIN_SCORE, maskType, valueCandidates, uiValue } from './timeline.js';
import { bands } from '../render/passes.js';

const wheelKeys = [
  ['Shadows','SplitToningShadowHue','SplitToningShadowSaturation','ColorGradeShadowLum'],
  ['Midtones','ColorGradeMidtoneHue','ColorGradeMidtoneSat','ColorGradeMidtoneLum'],
  ['Highlights','SplitToningHighlightHue','SplitToningHighlightSaturation','ColorGradeHighlightLum'],
  ['Global','ColorGradeGlobalHue','ColorGradeGlobalSat','ColorGradeGlobalLum']
];
export const badge = n => n<=20 ? String.fromCodePoint(0x245f+n) : '('+n+')';
const format = n => String(+n.toFixed(3));
export function cameraLine(camera={},ifds=[]) {
  function read(key,tag) {
    return camera[key] ?? ifds.find(ifd=>Number(ifd.tags[tag])>0)?.tags[tag];
  }
  const focal=read('FocalLength',37386), aperture=read('FNumber',33437);
  const shutter=read('ExposureTime',33434), iso=read('ISOSpeedRatings',34855);
  const reciprocal=1/shutter;
  const time=shutter<1 && Math.abs(reciprocal-Math.round(reciprocal))<.001 ? '1/'+Math.round(reciprocal) : format(Number(shutter));
  return [focal && format(+focal)+'mm',aperture && 'f/'+format(+aperture),shutter && time+'s',iso && 'ISO '+iso].filter(Boolean).join(' · ');
}

function controls(settings,pass,correction=-1) {
  const local=correction>=0, prefix=local?'Local':'';
  const candidates=valueCandidates(local?{kind:'ai',corrections:[settings]}:{...pass,globals:settings});
  const rows=candidates.filter(c=>c.key!=='Color').map(c=>{
    const hsl=c.key.match(/^(Hue|Saturation|Luminance)(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)$/);
    const key=hsl?hsl[1]+'Adjustment'+hsl[2]:prefix+c.key;
    return {key,correction,label:c.key==='Temperature'?'Temperature':c.row.label,value:settings[key],from:c.key==='Temperature'&&!local?(pass.asShotKelvin??settings[key]):c.row.from||0,
      decimals:local||c.key==='Exposure2012'?2:0,range:local?1:c.key==='Exposure2012'?5:c.key==='Temperature'?48000:c.key==='Tint'?150:100,
      strength:c.strength,band:hsl?.[2],display:uiValue(hsl?key:c.key,settings[key],local)};
  });
  const curves=['RGB','Red','Green','Blue'].flatMap(name=>{
    const key=local?(name==='RGB'?'Main':name)+'Curve':'ToneCurvePV2012'+(name==='RGB'?'':name);
    const points=(settings[key]||[]).map(p=>String(p).trim().split(/[,\s]+/).map(Number));
    return points.some(([x,y])=>x!==y)?[{key,name,points,correction}]:[];
  });
  const wheels=(local?[['Color','LocalToningHue','LocalToningSaturation']]:wheelKeys)
    .filter(([,h,s,l])=>settings[s] || settings[l])
    .map(([name,h,s,l])=>({name,keys:[h,s,l],hue:settings[h]||0,sat:settings[s]||0,lum:settings[l]||0,unit:local?1:100,correction}));
  if(!local && wheels.length) for(const [key,label,neutral] of [['ColorGradeBlending','Blending',50],['SplitToningBalance','Balance',0]]) {
    if(settings[key]!=null && settings[key]!==neutral) rows.push({key,label,correction,value:settings[key],from:neutral,range:100,decimals:0,strength:Math.abs(settings[key]-neutral)/100});
  }
  return {rows,curves,wheels};
}

function describePass(item,settings,arw) {
  const {pass,score,title:kicker,chip:spec}=item;
  const masks=[], rows=[], curves=[], wheels=[];
  function add(model,numbers=[]) {
    for(const [dest,list] of [[rows,model.rows],[curves,model.curves],[wheels,model.wheels]])
      for(const control of list)dest.push({...control,numbers});
  }
  if(pass.globals){
    const g=pass.globals;
    add(controls(g,pass));
    const from=Math.round(arw.whiteBalance?.tint||0);
    if(g.Tint===0 && from)rows.push({key:'Tint',label:'Tint',value:0,from,range:150,decimals:0,correction:-1,strength:Math.abs(from)/150});
    for(const row of rows)if(row.key==='Tint'){row.from=from;row.strength=Math.abs(row.value-from)/150;}
    // Preserve every explicit mixer value in the caption, including neutral channels.
    for(const band of bands)for(const field of ['Hue','Saturation','Luminance']){
      const key=field+'Adjustment'+band;
      if(g[key]===0)rows.push({key,label:band+' '+field.toLowerCase(),value:0,from:0,range:100,decimals:0,correction:-1,strength:0,band});
    }
  }
  for(const c of pass.corrections||[]){
    if(c.CorrectionActive===false)continue;
    const correction=settings.corrections.indexOf(c),numbers=[];
    c.masks.forEach((g,index)=>{
      if(g.MaskActive===false)return;
      const number=masks.length+1;
      numbers.push(number);
      masks.push({number,correction,index,type:maskType(g),geometry:g});
    });
    add(controls(c,pass,correction),numbers);
  }
  const drawnRows=rows.filter(r=>r.strength>0).sort((a,b)=>b.strength-a.strength).slice(0,4);
  return {pass,number:pass.index,kicker,spec,score,color:pass.color,masks,rows,drawnRows,curves,wheels,
    mixer:rows.some(r=>r.band && r.value),after:pass.result};
}

export function buildTutorialTimeline({original,compiled,reference,timeline},settings,arw,cameraOriginal=original) {
  const all=timeline.scores.map(item=>describePass(item,settings,arw));
  const chosen=new Set(all.filter(s=>s.score>=MIN_SCORE).sort((a,b)=>b.score-a.score).slice(0,7));
  const steps=all.filter(s=>chosen.has(s)),schedule=[];
  const final=reference||compiled;
  let duration=0;
  function cue(scene,seconds,fields){
    schedule.push({scene,t0:duration,t1:duration+seconds,...fields});
    duration+=seconds;
  }
  cue('hook',1,{after:final});
  cue('source',1.5,{after:cameraOriginal});
  for(const s of steps){
    const before=all[all.indexOf(s)-1]?.after||original;
    cue('lift',.5,{...s,after:before});
    cue('step',2,{...s,before});
  }
  cue('before',1,{after:cameraOriginal});
  cue('after',1.5,{before:cameraOriginal,after:final});
  const g=settings.globals;
  const crop=g.HasCrop?['CropAngle','CropLeft','CropTop','CropRight','CropBottom'].filter(k=>g[k]!=null).map(k=>k+' '+g[k]):[];
  return {mode:'tutorial',schedule,steps,all,duration,description:timeline.description,coverTitle:timeline.coverTitle,
    camera:cameraLine(settings.camera,arw.ifds),lens:settings.lensModel||arw.ifds?.find(i=>i.tags[42036])?.tags[42036],crop};
}

export function tutorialCaption(t,indices=t.steps.map(s=>s.number)) {
  const row=r=>r.label+' '+r.value+(r.key==='Temperature'?' K':'');
  const tags=c=>(c.numbers||[]).map(badge).join('');
  const curve=c=>c.name+' curve '+c.points.map(p=>'('+p.join(', ')+')').join(' ');
  const wheel=w=>w.name+' · H '+w.hue+' · S '+w.sat+' · L '+w.lum;
  const summary=t.all.filter(s=>indices.includes(s.number)).map(s=>{
    const values=s.drawnRows.slice(0,2).map(row);
    if(!values.length)values.push(s.curves.length?curve(s.curves[0]):s.wheels.length?wheel(s.wheels[0]):s.spec);
    return [s.kicker,...values].join(' · ');
  }).join('\n');
  const detail=t.all.map(s=>[s.kicker,...s.masks.map(m=>badge(m.number)+' '+(m.geometry.MaskName||m.type)),
    ...s.rows.map(r=>(tags(r)+' '+row(r)).trim()),...s.curves.map(c=>tags(c)+' '+curve(c)),
    ...s.wheels.map(w=>tags(w)+' '+wheel(w))].join('\n'));
  return [t.description,summary,t.camera,...detail,...t.crop,'Every slider is in the video, pause and copy 📌',
    '#lightroom #photoediting #lightroomtutorial'].filter(Boolean).join('\n\n');
}
