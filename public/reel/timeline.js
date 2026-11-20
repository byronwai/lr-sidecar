import {displayValue} from './text.js';
import { maskExpression } from '../anim/summary.js';

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
export const BEAT = 0.5;
export const PHOTO_WIDTH = 1044;
export const MIN_SCORE = 0.6;
const SUBJECT = /主體|主体|人物|人像|subject|person|people/i;
const BACKGROUND = /背景|background/i;
const SKY = /天空|sky/i;
const FOLIAGE = /植被|植物|vegetation|foliage/i;
const ACCENTS = {
  global: '#6caeff', remove: '#f088b0', background: '#edb47c', subject: '#ffa858',
  sky: '#82d9eb', foliage: '#80d8a0', gradient: '#c19dfb', edge: '#c19dfb'
};

// XMP stores local (mask) sliders as fractions; Lightroom shows them in its own
// units. Local exposure is a fraction of the ±4 EV slider; every other local
// slider is a fraction of ±100. Global values are already in Lightroom units.
export function uiValue(key, raw, local) {
  if (!local) return { value: raw, decimals: key === 'Exposure2012' ? 2 : 0 };
  if (key === 'Exposure2012') return { value: Number((raw * 4).toFixed(2)), decimals: 2 };
  return { value: Math.round(raw * 100), decimals: 0 };
}

export function difference(a, b) {
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += delta;
    if (delta > 4) changed++;
  }
  const count = a.length / 4;
  const impact = sum / count;
  const coverage = changed / count;
  return { impact, coverage, score: impact * Math.sqrt(coverage) };
}

export function compareFrames(before, after) {
  const h = Math.min(HEIGHT, Math.round(PHOTO_WIDTH * after.height / after.width));
  const surface = new OffscreenCanvas(PHOTO_WIDTH, h);
  const ctx = surface.getContext('2d', { alpha: false, willReadFrequently: true });
  const pixels = source => {
    ctx.drawImage(source, 0, 0, PHOTO_WIDTH, h);
    return ctx.getImageData(0, 0, PHOTO_WIDTH, h).data;
  };
  return difference(pixels(before), pixels(after));
}

const maskNames = { 'Mask/Gradient': 'linear', 'Mask/CircularGradient': 'radial', 'Mask/RangeMask': 'range', 'Mask/Paint': 'brush' };
function activeMasks(pass) {
  return (pass.corrections || []).filter(c => c.CorrectionActive !== false)
    .flatMap(c => c.masks.filter(m => m.MaskActive !== false));
}

// OKLab uses linear-light sRGB. Measure the rendered pass, never infer its
// visible colour from slider names or curve control points.
const linear = Array.from({ length: 256 }, (_, v) => {
  const x = v / 255;
  return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
});
function lab(r, g, b) {
  r = linear[r]; g = linear[g]; b = linear[b];
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [.2104542553*l + .793617785*m - .0040720468*s,
    1.9779984951*l - 2.428592205*m + .4505937099*s,
    .0259040371*l + .7827717662*m - .808675766*s];
}
const angle = (a, b) => Math.atan2(b, a) * 180 / Math.PI;
const turn = x => ((x + 540) % 360) - 180;
export function measureChange(before, after, pass) {
  const width = 256, height = Math.max(1, Math.round(width * after.height / after.width));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = source => {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const a = pixels(before), b = pixels(after), mask = pass.mask ? pixels(pass.mask) : null;
  const color = pass.color?.slice(1).match(/../g).map(v => parseInt(v, 16));
  const channel = color ? color.indexOf(Math.max(...color)) : 0;
  let weight = 0, ca = 0, cb = 0, hueWeight = 0, sin = 0, cos = 0;
  const from = [0, 0, 0], to = [0, 0, 0];
  const histogram=new Float64Array(72);
  let dominantWeight=0;
  for (let i = 0; i < a.length; i += 4) {
    const w = mask ? Math.min(1, mask[i + channel] / color[channel]) : 1;
    if (!w) continue;
    const x = lab(a[i], a[i+1], a[i+2]), y = lab(b[i], b[i+1], b[i+2]);
    const cx = Math.hypot(x[1], x[2]), cy = Math.hypot(y[1], y[2]);
    for (let j = 0; j < 3; j++) { from[j] += w*x[j]; to[j] += w*y[j]; }
    ca += w*cx; cb += w*cy; weight += w;
    if(cy>.025){
      const hue=(angle(y[1],y[2])+360)%360;
      histogram[Math.round(hue/5)%72]+=w*cy;
      dominantWeight+=w*cy;
    }
    // Near-neutral pixels have no reliable hue. Weight circular hue differences
    // by both mask coverage and the smaller of the two pixel chromas.
    const hw = w * Math.min(cx, cy);
    const dh = turn(angle(y[1], y[2]) - angle(x[1], x[2])) * Math.PI / 180;
    sin += hw * Math.sin(dh); cos += hw * Math.cos(dh); hueWeight += hw;
  }
  const denominator = weight || 1;
  for (let j = 0; j < 3; j++) { from[j] /= denominator; to[j] /= denominator; }
  const delta = to.map((v, i) => v - from[i]);
  // A circular chroma-weighted mode avoids cancelling complementary colours.
  const smoothed=Array.from(histogram,(_,i)=>Array.from({length:7},(_,j)=>histogram[(i+j-3+72)%72]).reduce((a,b)=>a+b,0));
  const mode=smoothed.indexOf(Math.max(...smoothed));
  return { space: 'OKLab', maskCoverage: weight / (width * height), before: from, after: to,
    deltaL: delta[0], deltaA: delta[1], deltaB: delta[2],
    chromaBefore: ca / denominator, chromaAfter: cb / denominator, deltaC: (cb-ca) / denominator,
    hueBefore: angle(from[1], from[2]), hueAfter: angle(to[1], to[2]),
    dominantHue: dominantWeight?mode*5:null,
    dominantShare:dominantWeight?smoothed[mode]/dominantWeight:0,
    meanHueShift: hueWeight ? Math.atan2(sin, cos) * 180 / Math.PI : 0 };
}

export const pipelineHeadline=count=>count+(count===1?' pass':' passes')+' → 1 frame';

export function passLabel(pass) {
  return ['PASS '+pass.index,pass.name].filter(Boolean).join(' · ');
}

export function maskType(mask) {
  if(mask.What==='Mask/Image'){
    if(BACKGROUND.test(mask.MaskName))return 'AI background mask';
    if(SUBJECT.test(mask.MaskName))return 'AI subject mask';
    if(SKY.test(mask.MaskName))return 'AI sky mask';
    return 'AI mask';
  }
  return {'Mask/Gradient':'Linear gradient','Mask/CircularGradient':'Radial gradient',
    'Mask/Paint':'Brush','Mask/RangeMask':Number(mask.CorrectionRangeMask?.Type)===2?'Luminance range':'Color range'}[mask.What] || mask.What;
}
export function passType(pass) {
  if(pass.kind==='remove')return 'Remove';
  if(pass.kind==='globals'){
    const g=pass.globals||{}, panels=['Basic'];
    if(Object.keys(g).some(k=>k.includes('Adjustment') && Number(g[k])))panels.push('HSL');
    if(['ToneCurvePV2012','ToneCurvePV2012Red','ToneCurvePV2012Green','ToneCurvePV2012Blue'].some(k=>g[k]?.some(p=>{
      const [x,y]=String(p).split(',').map(Number);return x!==y;
    })))panels.push('Tone Curve');
    if(Object.keys(g).some(k=>/^(SplitToning|ColorGrade).*(Sat|Lum)/.test(k)&&Number(g[k])))panels.push('Color Grading');
    return 'Global · '+panels.join(' + ');
  }
  const masks=activeMasks(pass),counts=new Map();
  for(const m of masks){const type=maskType(m);counts.set(type,(counts.get(type)||0)+1);}
  const types=[...counts].map(([type,n])=>type+(n>1?' × '+n:''));
  const rasters=masks.filter(m=>m.MaskDigest).length;
  if(rasters)types.push(rasters+(rasters===1?' raster':' rasters'));
  return types.join(' · ') || 'Masking';
}

function chapterCategory(pass) {
  if(pass.kind==='remove')return 'remove';
  const imageNames=activeMasks(pass).filter(m=>m.What==='Mask/Image').map(m=>m.MaskName||'');
  const names=imageNames.join(' ')||pass.name;
  let category = pass.kind === 'globals' ? 'global'
    : BACKGROUND.test(names) && SUBJECT.test(names) ? 'edge'
    : SUBJECT.test(names) ? 'subject' : BACKGROUND.test(names) ? 'background'
    : SKY.test(names) ? 'sky' : FOLIAGE.test(names) ? 'foliage' : 'gradient';
  const partNames=[...new Set(imageNames.map(name=>/clothes|clothing|衣服|服裝/i.test(name)?'Clothes'
    :/facial skin|body skin|skin|皮膚/i.test(name)?'Skin':/hair|頭髮/i.test(name)?'Hair'
    :/teeth|牙齒/i.test(name)?'Teeth':/iris|pupil|eye|眼/i.test(name)?'Eyes':/lips|嘴唇/i.test(name)?'Lips':null).filter(Boolean))];
  if(partNames.length)category=partNames.join(' + ').toLowerCase();
  return category;
}

// The compact panel uses measured chromatic movement to prioritize a channel curve.
function colorShift(m) {
  const chromatic=Math.hypot(m.deltaA,m.deltaB);
  return chromatic>.012 && (Math.abs(m.meanHueShift)>15 ||
    chromatic>Math.abs(m.deltaL)*.65 && Math.abs(m.deltaB)>.008);
}

const sliders = [
  ['Exposure2012', 'Exposure'], ['Highlights2012', 'Highlights'], ['Shadows2012', 'Shadows'],
  ['Contrast2012', 'Contrast'], ['Temperature', 'Temperature'], ['Tint', 'Tint'],
  ['Vibrance', 'Vibrance'], ['Saturation', 'Saturation'], ['Whites2012', 'Whites'], ['Blacks2012', 'Blacks'],
  ['Clarity2012', 'Clarity'], ['Texture', 'Texture'], ['Dehaze', 'Dehaze'], ['Glow', 'Glow']
];

function curveRows(label, points) {
  const pairs = points.map(point => '(' + String(point).trim().replace(/\s+/g, '') + ')');
  const lines = [];
  let current = label;
  for (const pair of pairs) {
    if (current.length + pair.length + 1 > 28) {
      lines.push({ text: current });
      current = '  ' + pair;
    } else current += ' ' + pair;
  }
  lines.push({ text: current });
  return lines;
}

// Preserve the established chapter selection and beat budget independently of
// the compact Reel panel. These detailed rows are used only to measure density.
function pacingRows(pass, correctionIndex = 0) {
  if (pass.kind === 'remove') return [{ text: 'Remove' }];
  const local = pass.kind !== 'globals';
  const corrections = pass.corrections?.filter(c => c.CorrectionActive !== false) || [];
  const correction = corrections[correctionIndex];
  const settings = local ? correction || {} : pass.globals || {};
  const masks = correction?.masks.filter(m => m.MaskActive !== false) || [];
  const rows = [];
  if (masks.length) rows.push({
    text: maskExpression(masks, m => m.What === 'Mask/Image' ? m.MaskName || 'selection' : maskNames[m.What] || 'mask')
  });
  const values = sliders.flatMap(([key, label]) => {
    const value = Number(settings[(local ? 'Local' : '') + key]);
    if (!Number.isFinite(value) || value === 0) return [];
    const { value: shown, decimals } = uiValue(key, value, local);
    const rounded = Number(shown.toFixed(decimals));
    const from = key === 'Temperature' && !local ? pass.asShotKelvin : 0;
    if (key === 'Temperature' && !local && !from) return [{ text: `White balance ${rounded} K` }];
    return [{ label: key === 'Temperature' && !local ? 'WB' : label, value: rounded, decimals, from: from || 0 }];
  });
  const curves = [];
  if(local&&Number(settings.LocalToningSaturation))values.push({text:`Color ${displayValue(settings.LocalToningHue||0)}° / ${displayValue(Number(settings.LocalToningSaturation)*100)}`});
  for (const [key, label] of [['RedCurve', 'Red'], ['MainCurve', 'RGB'], ['GreenCurve', 'Green'], ['BlueCurve', 'Blue']]) {
    if (settings[key]?.length) curves.push(...curveRows(label, settings[key]));
  }
  const rest = correctionIndex + 1 < corrections.length ? pacingRows(pass, correctionIndex + 1) : [];
  if (curves.length) return [...rows, ...values, ...curves, ...rest];
  if (!values.length && !rows.length) return rows.concat({ text: 'Profile' });
  return rows.concat(values, rest);
}

// Rank unrounded settings by distance from neutral / slider half-range. Local
// XMP sliders are normalized to +/-1 (Exposure maps to +/-4 EV); global basic
// sliders use +/-100, Exposure +/-5 EV, WB 2000..50000 K and Tint +/-150.
export function valueCandidates(pass) {
  const local = pass.kind !== 'globals';
  const settings = local ? (pass.corrections || []).filter(c => c.CorrectionActive !== false) : [pass.globals || {}];
  return settings.flatMap(s => {
    const values = sliders.flatMap(([key, label]) => {
      const value = Number(s[(local ? 'Local' : '') + key]);
      if (!Number.isFinite(value) || value === 0) return [];
      const { value: shown, decimals } = uiValue(key, value, local);
      const from = key === 'Temperature' && !local ? pass.asShotKelvin || 0 : 0;
      const range = local ? 1 : key === 'Exposure2012' ? 5 : key === 'Temperature' ? 48000 : key === 'Tint' ? 150 : 100;
      const row = key === 'Temperature' && !local && !from
        ? { text: `White balance ${Math.round(value)} K` }
        : { label: key === 'Temperature' && !local ? 'WB' : label, value: Number(shown.toFixed(decimals)), decimals, from };
      return [{ key, strength: Math.abs(value - from) / range, row }];
    });
    if (local && Number(s.LocalToningSaturation)) values.push({ key: 'Color', strength: Math.abs(Number(s.LocalToningSaturation)),
      row: { text: `Color ${displayValue(s.LocalToningHue || 0)}° / ${displayValue(Number(s.LocalToningSaturation) * 100)}` } });
    if (!local) for (const band of ['Red','Orange','Yellow','Green','Aqua','Blue','Purple','Magenta']) {
      for (const field of ['Hue','Saturation','Luminance']) {
        const value = Number(s[field + 'Adjustment' + band]);
        if (value) values.push({ key: field + band, strength: Math.abs(value) / 100,
          row: { label: `${band} ${field.toLowerCase()}`, value: Math.round(value), decimals: 0, from: 0 } });
      }
    }
    return values;
  });
}

function compactRows(passes, hero, preferCurve, base = false) {
  const candidates = passes.flatMap(valueCandidates).sort((a,b) => b.strength - a.strength);
  const chosen = [];
  const take = (accept, reason) => {
    const value = candidates.find(c => !chosen.includes(c) && accept(c));
    if (value) { value.reason = reason; chosen.push(value); }
  };
  if (base) take(c => c.key === 'Temperature' && (c.row.label === 'WB' || c.row.text), 'White balance first');
  take(c => c.key === 'Exposure2012', 'Exposure first');
  if (!base) {
    const curves = (hero.corrections || []).filter(c => c.CorrectionActive !== false).flatMap(s =>
      [['MainCurve','RGB'],['RedCurve','Red'],['GreenCurve','Green'],['BlueCurve','Blue']].flatMap(([key,label]) => {
        const strength = Math.max(0, ...(s[key] || []).map(p => { const [x,y] = String(p).split(',').map(Number); return Math.abs(y-x)/255; }));
        return strength ? [{ label, strength, points: s[key].length }] : [];
      }));
    const channel = curves.filter(c => c.label !== 'RGB');
    const hueMove = candidates.find(c => ['Temperature','Tint','Color'].includes(c.key))?.strength || 0;
    const curveColour = channel.length && preferCurve
      && Math.max(...channel.map(c => c.strength)) > hueMove;
    if (curveColour) {
      const names = [...new Set(curves.map(c => c.label))];
      chosen.push({ row: { text: names.length === 1 ? `${names[0]} curve · ${curves[0].points} pts` : `${names.join(' + ')} curves` },
        reason: 'Channel curve leads the measured colour change' });
    } else take(c => ['Temperature','Tint','Saturation','Color'].includes(c.key), 'Largest colour move relative to slider range');
    while (chosen.length < 3) {
      const count = chosen.length;
      take(c => ['Highlights2012','Shadows2012','Contrast2012'].includes(c.key), 'Largest remaining tone move relative to slider range');
      if (chosen.length === count) break;
    }
  }
  while (chosen.length < 3) {
    const count = chosen.length;
    take(() => true, 'Strongest remaining move relative to slider range');
    if (chosen.length === count) break;
  }
  // The expression identifies the chapter's representative selection, as in
  // the full program; merged passes stay in the edit, rather than adding rows.
  const masks = hero.corrections?.find(c => c.CorrectionActive !== false)?.masks.filter(m => m.MaskActive !== false) || [];
  const mask = masks.length ? { text: maskExpression(masks, m => m.What === 'Mask/Image'
    ? m.MaskName || 'selection' : maskNames[m.What] || 'mask') }
    : hero.kind === 'remove' ? { text: 'Remove' } : null;
  const rows = [...(!base && mask ? [mask] : []), ...chosen.map(c => ({ ...c.row, reason: c.reason }))];
  return rows.length ? rows : [{ text: 'Profile' }];
}

function allocateBeats(groups) {
  const total = groups.reduce((sum, group) => sum + group.score, 0) || 1;
  const beats = groups.map(group => Math.min(6, Math.max(2, 1 + Math.ceil(group.items.flatMap(item => pacingRows(item.pass)).length / 6))));
  const minimum = beats.reduce((a,b) => a+b, 0);
  const budget = Math.min(18, Math.max(minimum, 8, groups.length * 3), groups.length * 6);
  for (let remaining = budget - minimum; remaining > 0; remaining--) {
    const priorities = groups.map((group, i) => beats[i] >= 6 ? -Infinity : budget * group.score / total - beats[i]);
    beats[priorities.indexOf(Math.max(...priorities))]++;
  }
  return beats;
}

export function groupChapter(groups, item) {
  const last = groups.at(-1);
  if (last && last.category === item.category && item.i - last.end.i <= 2) {
    last.end = item;
    if (item.score > last.hero.score) last.hero = item;
    last.items.push(item);
    last.score += item.score;
  } else groups.push({ category: item.category, end: item, hero: item, score: item.score, items: [item] });
}

export function buildTimeline(original, passes, hasReference, description = '') {
  const scores = passes.map((pass, i) => {
    const before = passes[i - 1]?.result || original;
    const measured = measureChange(before, pass.result, pass);
    const category=chapterCategory(pass), title=passLabel(pass), chip=passType(pass);
    return {
      ...compareFrames(passes[i - 1]?.result || original, pass.result),
      pass, category, title, chip, measured, i, disposition: 'skipped'
    };
  });
  const groups = [];
  let rewindResult = original;
  const rewindPasses = [];
  for (const item of scores) {
    // Establish global colour / a whole-frame exposure in the rewind, instead
    // of spending a full mask chapter on a rectangle covering the entire photo.
    const allFrame = item.pass.kind === 'globals' || wholeFrameMask(item.pass);
    if (!groups.length && allFrame) {
      item.disposition = 'folded into rewind';
      rewindResult = item.pass.result;
      rewindPasses.push(item.pass);
      continue;
    }
    if (item.score < MIN_SCORE) continue;
    groupChapter(groups, item);
  }
  const chosen = groups.sort((a, b) => b.score - a.score).slice(0, 5);
  const minimumBeats = group => Math.min(6, Math.max(2, 1 + Math.ceil(group.items.flatMap(item => pacingRows(item.pass)).length / 6)));
  // Dense program pages must not turn a large edit into a >15 s pipeline tour.
  // The list is already in impact order, so remove its least visible chapter.
  while (chosen.reduce((sum, group) => sum + minimumBeats(group), 0) > 18) chosen.pop();
  chosen.sort((a, b) => a.end.i - b.end.i);
  const beats = allocateBeats(chosen);
  const schedule = [];
  let cursor = 0;
  function cue(scene, count, lead, extra = {}) {
    schedule.push({ t0: cursor * BEAT, t1: (cursor + count) * BEAT, scene, lead, ...extra });
    cursor += count;
  }
  cue('hook', 3, 'photo');
  cue('rewind', 1, 'photo');
  cue('camera', 1, 'program', { before: original, after: rewindResult,
    passLabel: rewindPasses.length ? passLabel(rewindPasses[0]) : 'before',
    rows: rewindPasses.length ? compactRows(rewindPasses, rewindPasses[0], null, true) : [] });
  let previous = rewindResult;
  let payoffBeats = 4;
  chosen.forEach((group, index) => {
    const { hero, end, items } = group;
    items.forEach(item => { item.disposition = item === hero ? `${beats[index]} beats` : `merged into ${hero.pass.index}`; });
    const chapter = {
      pass: hero.pass, before: previous, after: end.pass.result, title: hero.title,
      chip: hero.chip, color: ACCENTS[group.category]||ACCENTS.subject,
      rows: compactRows([hero.pass], hero.pass, colorShift(hero.measured)), number: index
    };
    cue('program', 1, 'program', chapter);
    cue('answer', 2, 'photo', chapter);
    if (beats[index] > 3) cue('hold', beats[index] - 3, 'photo', chapter);
    else if (beats[index] === 2) payoffBeats = Math.max(3, payoffBeats - 1);
    previous = end.pass.result;
  });
  const skipped = scores.filter(item => item.disposition === 'skipped').map(item => item.title);
  const also = skipped;
  cue('payoff', payoffBeats, 'photo', { also });
  cue('loop', 2, 'photo');
  return { schedule, scores, duration: cursor * BEAT, chapterCount: chosen.length, hasReference, description, coverTitle: description || pipelineHeadline(passes.length) };
}

function wholeFrameMask(pass) {
  if (!pass.mask || pass.corrections?.length !== 1) return false;
  const c = new OffscreenCanvas(1044, 1566), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(pass.mask, 0, 0, c.width, c.height);
  const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
  const color = pass.color.slice(1).match(/../g).map(x => parseInt(x, 16));
  const channel = color.indexOf(Math.max(...color));
  let covered = 0;
  for (let i = channel; i < bytes.length; i += 4) if (bytes[i] / color[channel] > .5) covered++;
  return covered / (c.width * c.height) > .98;
}
