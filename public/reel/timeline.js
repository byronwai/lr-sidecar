import { maskExpression } from '../anim/summary.js';

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
export const BEAT = 0.5;
export const PHOTO_WIDTH = 1044;
const MIN_SCORE = 0.6;
const SUBJECT = /主體|主体|人物|人像|subject|person|people/i;
const BACKGROUND = /背景|background/i;
const SKY = /天空|sky/i;
const FOLIAGE = /植被|植物|vegetation|foliage/i;
const ACCENTS = {
  global: '#6caeff', remove: '#f088b0', background: '#edb47c', subject: '#ffa858',
  sky: '#82d9eb', foliage: '#80d8a0', gradient: '#c19dfb', edge: '#c19dfb'
};

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
  for (let i = 0; i < a.length; i += 4) {
    const w = mask ? Math.min(1, mask[i + channel] / color[channel]) : 1;
    if (!w) continue;
    const x = lab(a[i], a[i+1], a[i+2]), y = lab(b[i], b[i+1], b[i+2]);
    const cx = Math.hypot(x[1], x[2]), cy = Math.hypot(y[1], y[2]);
    for (let j = 0; j < 3; j++) { from[j] += w*x[j]; to[j] += w*y[j]; }
    ca += w*cx; cb += w*cy; weight += w;
    // Near-neutral pixels have no reliable hue. Weight circular hue differences
    // by both mask coverage and the smaller of the two pixel chromas.
    const hw = w * Math.min(cx, cy);
    const dh = turn(angle(y[1], y[2]) - angle(x[1], x[2])) * Math.PI / 180;
    sin += hw * Math.sin(dh); cos += hw * Math.cos(dh); hueWeight += hw;
  }
  const denominator = weight || 1;
  for (let j = 0; j < 3; j++) { from[j] /= denominator; to[j] /= denominator; }
  const delta = to.map((v, i) => v - from[i]);
  return { space: 'OKLab', maskCoverage: weight / (width * height), before: from, after: to,
    deltaL: delta[0], deltaA: delta[1], deltaB: delta[2],
    chromaBefore: ca / denominator, chromaAfter: cb / denominator, deltaC: (cb-ca) / denominator,
    hueBefore: angle(from[1], from[2]), hueAfter: angle(to[1], to[2]),
    meanHueShift: hueWeight ? Math.atan2(sin, cos) * 180 / Math.PI : 0 };
}

function editorial(pass, measured) {
  const masks = activeMasks(pass);
  const imageNames = masks.filter(m => m.What === 'Mask/Image').map(m => m.MaskName || '');
  const names = imageNames.join(' ') || pass.name;
  const gradient = masks.some(m => m.What !== 'Mask/Image');
  if (pass.kind === 'remove') return ['remove', 'Clean the frame', 'remove', 'clean'];
  const category = pass.kind === 'globals' ? 'global'
    : BACKGROUND.test(names) && SUBJECT.test(names) ? 'edge'
    : SUBJECT.test(names) ? 'subject' : BACKGROUND.test(names) ? 'background'
    : SKY.test(names) ? 'sky' : FOLIAGE.test(names) ? 'foliage' : 'gradient';
  const label = { global: 'Frame', subject: 'Subject', background: 'Background', sky: 'Sky',
    foliage: 'Foliage', gradient: 'Light', edge: 'Edges' }[category];
  const { deltaL: dl, deltaA: da, deltaB: db, deltaC: dc, hueBefore: h0, hueAfter: h1 } = measured;
  const chromatic = Math.hypot(da, db);
  let direction = 'refine', title = `${label} refinements`;
  const redApproach = Math.abs(turn(h0 - 29)) - Math.abs(turn(h1 - 29));
  // A substantial hue rotation is a meaningful colour story even when the
  // same pass also darkens the image. "→ red" describes movement toward red,
  // not a claim that every background pixel ends at pure red.
  if (chromatic > .012 && da > .008 && redApproach > 15 && Math.abs(measured.meanHueShift) > 15) {
    direction = 'red'; title = `${label} → red`;
  } else if (chromatic > .012 && chromatic > Math.abs(dl) * .65) {
    if (db < -.008) direction = 'cooler';
    else if (db > .008) direction = 'warmer';
    else direction = dc > 0 ? 'richer' : 'softer';
    title = `${label} → ${direction}`;
  } else if (Math.abs(dl) > .008) {
    direction = dl > 0 ? 'lift' : 'darker';
    title = `${label} ${direction}`;
  } else if (Math.abs(dc) > .006) {
    direction = dc > 0 ? 'richer' : 'softer';
    title = `${label} → ${direction}`;
  }
  if (category === 'sky' && Math.abs(turn(h1 - 264)) < 45 && dl < -.008 && dc > .004) {
    direction = 'blue'; title = 'Sky deeper blue';
  }
  return [category, title, imageNames[0] || (gradient ? 'light' : category), direction];
}

const coverPhrases = {
  red: noun => `Paint the ${noun} red`, cooler: noun => `Cool the ${noun}`,
  warmer: noun => `Warm the ${noun}`, darker: noun => `A deeper ${noun}`,
  lift: noun => `Lift the ${noun}`, richer: noun => `Richer ${noun} color`,
  softer: noun => `Soften the ${noun}`, blue: () => 'A deeper blue sky'
};
function measuredCover(groups) {
  const ranked = [...groups].sort((a, b) => b.score - a.score);
  const hero = ranked[0];
  const total = ranked.reduce((sum, group) => sum + group.score, 0);
  if (!hero || hero.score < total * .55 || hero.score < (ranked[1]?.score || 0) * 1.5) return 'One frame. Many edits.';
  const noun = { global: 'frame', gradient: 'light', edge: 'edges' }[hero.category] || hero.category;
  return coverPhrases[hero.hero.direction]?.(noun) || 'One frame. Many edits.';
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

function programRows(pass, correctionIndex = 0) {
  if (pass.kind === 'remove') return [{ text: 'Remove · selected patch' }];
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
    const digits = local || key === 'Exposure2012' ? 2 : 0;
    const decimals = digits;
    const rounded = Number(value.toFixed(decimals));
    const from = key === 'Temperature' && !local ? pass.asShotKelvin : 0;
    if (key === 'Temperature' && !local && !from) return [{ text: `White balance ${rounded} K` }];
    return [{ label: key === 'Temperature' && !local ? 'WB' : label, value: rounded, decimals, from: from || 0 }];
  });
  const curves = [];
  for (const [key, label] of [['RedCurve', 'Red'], ['MainCurve', 'RGB'], ['GreenCurve', 'Green'], ['BlueCurve', 'Blue']]) {
    if (settings[key]?.length) curves.push(...curveRows(label, settings[key]));
  }
  const rest = correctionIndex + 1 < corrections.length ? programRows(pass, correctionIndex + 1) : [];
  if (curves.length) return [...rows, ...values, ...curves, ...rest];
  if (!values.length && !rows.length) return rows.concat({ text: 'Base color profile' });
  return rows.concat(values, rest);
}

function allocateBeats(groups) {
  const total = groups.reduce((sum, group) => sum + group.score, 0) || 1;
  const beats = groups.map(group => Math.min(6, Math.max(2, 1 + Math.ceil(group.items.flatMap(item => programRows(item.pass)).length / 6))));
  const minimum = beats.reduce((a,b) => a+b, 0);
  const budget = Math.min(18, Math.max(minimum, 8, groups.length * 3), groups.length * 6);
  for (let remaining = budget - minimum; remaining > 0; remaining--) {
    const priorities = groups.map((group, i) => beats[i] >= 6 ? -Infinity : budget * group.score / total - beats[i]);
    beats[priorities.indexOf(Math.max(...priorities))]++;
  }
  return beats;
}

export function buildTimeline(original, passes, hasReference) {
  const scores = passes.map((pass, i) => {
    const before = passes[i - 1]?.result || original;
    const measured = measureChange(before, pass.result, pass);
    const [category, title, chip, direction] = editorial(pass, measured);
    return {
      ...compareFrames(passes[i - 1]?.result || original, pass.result),
      pass, category, title, chip, direction, measured, i, disposition: 'skipped'
    };
  });
  const groups = [];
  let rewindResult = original;
  const rewindRows = [];
  for (const item of scores) {
    // Establish global colour / a whole-frame exposure in the rewind, instead
    // of spending a full mask chapter on a rectangle covering the entire photo.
    const allFrame = item.pass.kind === 'globals' || wholeFrameMask(item.pass);
    if (!groups.length && allFrame) {
      item.disposition = 'folded into rewind';
      rewindResult = item.pass.result;
      const rows = programRows(item.pass);
      rewindRows.push(...rows.filter(row => row.label || /white balance/i.test(row.text)).slice(0, 2));
      continue;
    }
    if (item.score < MIN_SCORE) continue;
    const last = groups.at(-1);
    if (last && last.category === item.category && item.i - last.end.i <= 2) {
      last.end = item;
      if (item.score > last.hero.score) last.hero = item;
      last.items.push(item);
      last.score += item.score;
    } else groups.push({
      category: item.category, end: item, hero: item, score: item.score, items: [item]
    });
  }
  const chosen = groups.sort((a, b) => b.score - a.score).slice(0, 5);
  const minimumBeats = group => Math.min(6, Math.max(2, 1 + Math.ceil(group.items.flatMap(item => programRows(item.pass)).length / 6)));
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
  cue('camera', 1, 'program', { before: original, after: rewindResult, rows: rewindRows });
  let previous = rewindResult;
  chosen.forEach((group, index) => {
    const { hero, end, items } = group;
    items.forEach(item => { item.disposition = item === hero ? `${beats[index]} beats` : `merged into ${hero.pass.index}`; });
    const chapter = {
      pass: hero.pass, before: previous, after: end.pass.result, title: hero.title,
      chip: hero.chip, color: ACCENTS[group.category], rows: items.flatMap(item => programRows(item.pass)), number: index
    };
    cue('program', 1, 'program', chapter);
    cue('answer', 1, 'photo', chapter);
    if (beats[index] > 2) cue('hold', beats[index] - 2, 'photo', chapter);
    previous = end.pass.result;
  });
  const skipped = scores.filter(item => item.disposition === 'skipped').map(item => item.title);
  const also = [...new Set(skipped)];
  cue('payoff', 4, 'photo', { also });
  cue('loop', 2, 'photo');
  return { schedule, scores, duration: cursor * BEAT, chapterCount: chosen.length, hasReference, coverTitle: measuredCover(chosen) };
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
