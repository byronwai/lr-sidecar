import { BEAT, FPS, HEIGHT, PHOTO_WIDTH, WIDTH } from './timeline.js';
import { displayValue, graphemes, ellipsize } from './text.js';
import {isSubject,subjectMatte} from './subject.js';
import { createSlices } from './slices.js';
import {drawCropTransition} from './crop.js';

const INK = '#edf3ff';
const NAVY = '#04070f';
const SIGNAL = '#87bcff';
// Cover headline: Geist, large, tightly tracked. Two sentences break onto two
// lines with weight contrast ("One frame." bold / "Many edits." light).
const DISPLAY = { family: '"Reel Display", "Noto Sans TC Variable", sans-serif', size: 92, min: 64,
  weights: [680, 400], colors: ['#f4f7fc', '#c4cfe2'], tracking: -0.035, leading: 1.0, maxWidth: 868 };
const PASS_TITLE = '600 56px "Reel Inter", "Noto Sans TC Variable", sans-serif';
const MONO = '500 34px "Reel Mono", "Noto Sans TC Variable", monospace';
const CHIP = '500 30px "Reel Mono", "Noto Sans TC Variable", monospace';
const PANEL = { x: 58, y: 1160, w: 884, h: 306 };

export async function loadReelFonts(programText = '') {
  const results = await Promise.all([
    document.fonts.load('700 70px "Reel Inter"'),
    document.fonts.load(`${DISPLAY.weights[0]} ${DISPLAY.size}px "Reel Display"`),
    document.fonts.load(`${DISPLAY.weights[1]} ${DISPLAY.size}px "Reel Display"`),
    document.fonts.load('500 34px "Reel Mono"'),
    document.fonts.load('500 34px "Noto Sans TC Variable"', '主體背景天空人物遮色片 ' + programText)
  ]);
  if (results.some(faces => !faces.length)) throw new Error('The Reel fonts could not be loaded.');
}

const clamp = t => Math.max(0, Math.min(1, t));
const ease = t => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
// Approach a node ahead of its beat. The frame at the beat belongs to the new node.
const arrive = (time, beat, travel = BEAT) => ease((time - beat + travel) / travel);
const inner = time => (time % BEAT) / BEAT;

export function photoRect(image) {
  const width = PHOTO_WIDTH;
  const height = Math.min(1776, width * image.height / image.width);
  const w = Math.min(width, height * image.width / image.height);
  return { x: (WIDTH - w) / 2, y: (HEIGHT - height) / 2, w, h: height };
}

function photo(ctx, image, rect) {
  // A separately exported JPG can have a different crop. Fit it inside the
  // fixed photo area without stretching it or moving the walkthrough geometry.
  if(Math.abs(Math.log((image.width/image.height)/(rect.w/rect.h)))>.01){
    const scale=Math.min(rect.w/image.width,rect.h/image.height);
    const w=image.width*scale,h=image.height*scale;
    ctx.drawImage(image,rect.x+(rect.w-w)/2,rect.y+(rect.h-h)/2,w,h);
    return;
  }
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
}

export function photoSplit(ctx, after, before, rect, left, accent, guides=ctx) {
  photo(ctx, after, rect);
  if (left <= 0) return;
  const x = rect.x + left * rect.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, left * rect.w, rect.h);
  ctx.clip();
  photo(ctx, before, rect);
  ctx.restore();
  if (left >= 1) return;
  guides.fillStyle = '#ffffffd9';
  guides.fillRect(x - 1.5, rect.y, 3, rect.h);
  // Only the handles in the chrome glow. The divider on the image stays crisp.
  guides.save();
  guides.fillStyle = accent;
  guides.shadowColor = accent;
  guides.shadowBlur = 18;
  guides.fillRect(x - 7, rect.y - 6, 14, 5);
  guides.fillRect(x - 7, rect.y + rect.h + 1, 14, 5);
  guides.restore();
}

export function maskOverlay(mask, bakedColor, accent, rect, minCoverage = 0.01) {
  if (!mask) return null;
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const layer = new OffscreenCanvas(w, h);
  const ctx = layer.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(mask, 0, 0, w, h);
  const color = hex => hex.slice(1).match(/../g).map(byte => parseInt(byte, 16));
  const baked = color(bakedColor);
  const channel = baked.indexOf(Math.max(...baked));
  const data = ctx.getImageData(0, 0, w, h);
  const weights = new Float32Array(w * h);
  let covered = 0;
  for (let p = 0; p < weights.length; p++) {
    const value = weights[p] = clamp(data.data[p * 4 + channel] / baked[channel]);
    if (value >= 0.5) covered++;
  }
  const coverage = covered / weights.length;
  if (coverage < minCoverage) return { coverage, canvas: null };
  const rgb = color(accent);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let edge = false;
      if (x > 0 && x + 1 < w && y > 0 && y + 1 < h) {
        const dx = weights[p - w + 1] + 2 * weights[p + 1] + weights[p + w + 1]
          - weights[p - w - 1] - 2 * weights[p - 1] - weights[p + w - 1];
        const dy = weights[p + w - 1] + 2 * weights[p + w] + weights[p + w + 1]
          - weights[p - w - 1] - 2 * weights[p - w] - weights[p - w + 1];
        edge = dx * dx + dy * dy >= 4;
      }
      const output = p * 4;
      data.data[output] = rgb[0];
      data.data[output + 1] = rgb[1];
      data.data[output + 2] = rgb[2];
      // A selection indicator must not repaint the edit. Keep only its contour;
      // broad background / gradient masks otherwise become a flat colour wash.
      data.data[output + 3] = edge ? 180 : 0;
    }
  }
  ctx.putImageData(data, 0, 0);
  return { coverage, canvas: layer };
}

function brackets(ctx, x, y, w, h, accent, len = 18) {
  ctx.strokeStyle = '#a8b9ce60';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [[x,y,1,1], [x+w,y,-1,1], [x,y+h,1,-1], [x+w,y+h,-1,-1]]) {
    ctx.moveTo(cx + len * dx, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + len * dy);
  }
  ctx.stroke();
}

function rowText(row) {
  if (row.text) return row.text;
  const from = row.from ?? 0;
  const units = row.label === 'WB' ? ' K' : '';
  return `${row.label} ${displayValue(from, Math.min(2, row.decimals))} → ${displayValue(row.value, row.decimals)}${units}`;
}

// Leave three complete frames to read the actual values before the cut. The
// typewriter reveals text; numbers never count through fictitious edit values.
const panelTyping = since => ease((since - BEAT / 2) / (BEAT / 2 - 3 / FPS));

// Lay out the cover headline: sentence breaks become lines with weight
// contrast; a single sentence wraps by measured width, shrinking only if a
// line still overflows. Never squeeze glyphs with fillText's maxWidth.
export function headlineLayout(ctx, text) {
  const sentences = text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  const contrast = sentences.length === 2;
  for (let size = DISPLAY.size; size >= DISPLAY.min; size -= 4) {
    const fontFor = i => `${DISPLAY.weights[contrast ? Math.min(i, 1) : 0]} ${size}px ${DISPLAY.family}`;
    ctx.letterSpacing = `${(DISPLAY.tracking * size).toFixed(2)}px`;
    const measure = (line, i) => {
      ctx.font = fontFor(i);
      return ctx.measureText(line).width;
    };
    const lines=[];
    for(const sentence of contrast?sentences:[text]){
      let line='';
      for(const word of sentence.split(/\s+/)){
        const next=line?line+' '+word:word;
        if(line && measure(next,lines.length)>DISPLAY.maxWidth){lines.push(line);line='';}
        if(line)line+=' ';
        for(const ch of graphemes(word)){
          if(line && measure(line+ch,lines.length)>DISPLAY.maxWidth){lines.push(line);line='';}
          line+=ch;
        }
      }
      if(line)lines.push(line);
    }
    ctx.letterSpacing = '0px';
    const fits = lines.length <= 2 && lines.every((line, i) => {
      ctx.letterSpacing = `${(DISPLAY.tracking * size).toFixed(2)}px`;
      const ok = measure(line, i) <= DISPLAY.maxWidth;
      ctx.letterSpacing = '0px';
      return ok;
    });
    if (fits || size - 4 < DISPLAY.min) {
      if(lines.length>2){
        ctx.letterSpacing=`${(DISPLAY.tracking * size).toFixed(2)}px`;
        lines.splice(1,lines.length-1,ellipsize(lines[1],s=>measure(s,1)<=DISPLAY.maxWidth));
        ctx.letterSpacing='0px';
      }
      return lines.map((line, i) => ({
        text: line, font: fontFor(i), size,
        color: DISPLAY.colors[contrast ? Math.min(i, 1) : 0],
        tracking: `${(DISPLAY.tracking * size).toFixed(2)}px`
      }));
    }
  }
}

export function createScene(output, { original, compiled, reference, timeline, subjectFaces=[],sources }) {
  const { schedule, duration, chapterCount } = timeline;
  const final = reference || compiled;
  // One geometry for every source, mask, wipe and frame, for the entire Reel.
  const rect = photoRect(original);
  const matte=subjectFaces.length?subjectMatte(subjectFaces,rect):null;
  const surface=()=>new OffscreenCanvas(WIDTH,HEIGHT).getContext('2d');
  const cut=surface(),ctx=surface();
  // Keep the cover geometry and the approved panel slot fixed for the export.
  const coverLines = headlineLayout(ctx, timeline.coverTitle);
  const baseline = 300 + Math.round(coverLines[0].size * 0.73);
  const step = Math.round(coverLines[0].size * DISPLAY.leading);
  const titleBottom = Math.max(382, ...coverLines.map((line, i) => {
    ctx.font = line.font;
    return baseline + i * step + ctx.measureText(line.text).actualBoundingBoxDescent + 12;
  }));
  const titleRect = { x: 60, y: 250, w: 900, h: titleBottom - 250 };
  const panelRect = { ...PANEL };
  const slices = createSlices(schedule, { panelRect, faceCut:matte?null:cut });
  const overlays = new Map(),subjectGuides=new Set();
  for (const cue of schedule.filter(cue => cue.scene === 'program')) {
    const overlay=maskOverlay(cue.pass.mask,cue.pass.color,cue.color,rect);
    overlays.set(cue.pass.index,overlay);
    const masks=cue.pass.corrections?.filter(c=>c.CorrectionActive!==false)
      .flatMap(c=>c.masks.filter(m=>m.MaskActive!==false))||[];
    if(overlay?.canvas&&masks.length&&masks.every(isSubject))subjectGuides.add(overlay.canvas);
  }
  const coverTitle = timeline.coverTitle;
  const terminal = new OffscreenCanvas(WIDTH, HEIGHT);
  const tui = terminal.getContext('2d');

  function frame(time) {
    const lastFrame = (Math.round(duration * FPS) - 1) / FPS;
    const t = time >= lastFrame ? 0 : Math.max(0, time);
    const sceneIndex = schedule.findIndex(cue => t < cue.t1);
    const cue = schedule[sceneIndex];
    const since = t - cue.t0;
    const progress = arrive(t, cue.t1, cue.t1 - cue.t0);
    // The opaque panel already separates code from photo. Dimming either pane
    // introduced a half-beat black flash and made held panel text unreadable.
    const accent = cue.color || SIGNAL;
    const metrics = { scene: cue.scene, lead: cue.lead, photoRect: { ...rect }, panelDrawn: false,
      photoLevel: 1, programLevel: 1, opacity: 0, text: [] };
    const setText = (surface, text, x, baseline, font, color, max = 868) => {
      if (!text) return;
      surface.font = font;
      surface.fillStyle = color;
      const bounds = surface.measureText(text);
      const w = Math.min(max, bounds.width), transform = surface.getTransform();
      metrics.text.push({ text, left: transform.a * x + transform.e, right: transform.a * (x + w) + transform.e,
        top: transform.d * (baseline - bounds.actualBoundingBoxAscent) + transform.f,
        bottom: transform.d * (baseline + bounds.actualBoundingBoxDescent) + transform.f, font });
      surface.fillText(text, x, baseline, max);
      // Keep the lettering and a narrow backing readable wherever the subject
      // crosses the fixed panel. The rest of the panel sits behind the subject.
      cut.font=font;cut.letterSpacing=surface.letterSpacing;
      cut.lineWidth=1.5;cut.strokeText(text,x,baseline,max);cut.fillText(text,x,baseline,max);
    };

    output.fillStyle=NAVY;
    output.fillRect(0,0,WIDTH,HEIGHT);
    ctx.clearRect(0,0,WIDTH,HEIGHT);
    cut.globalCompositeOperation='copy';
    if(matte)cut.drawImage(matte,0,0);
    else{
      cut.clearRect(0,0,WIDTH,HEIGHT);
      cut.fillRect(rect.x,rect.y,rect.w,rect.h);
    }
    cut.globalCompositeOperation='destination-out';
    let before, after, split = 0, title, topic, rows = [], typing = 1;
    let shortPanel = false;
    switch (cue.scene) {
      case 'hook':
        before = original;
        after = final;
        title = coverTitle;
        topic = 'LIGHTROOM';
        shortPanel = true;
        break;
      case 'rewind':
        before = final;
        after = schedule.some(c=>c.scene==='crop')?sources.original:original;
        split = Math.min(1 - 1 / PHOTO_WIDTH, 1 - progress);
        title = 'before';
        topic = 'before';
        shortPanel = true;
        break;
      case 'crop':
        metrics.crop=drawCropTransition(output,sources,original,rect,since/Math.max(.01,cue.t1-cue.t0-.1));
        metrics.photoWidth=rect.w;metrics.split=0;metrics.slices=[];
        return metrics;
      case 'camera':
        before = cue.before;
        after = cue.after;
        split = cue.rows.length ? Math.min(1 - 1 / PHOTO_WIDTH, 1 - progress) : 0;
        title = cue.passLabel || 'before';
        topic = 'Basic';
        rows = cue.rows;
        typing = panelTyping(since);
        shortPanel = !rows.length || since < BEAT/2;
        break;
      case 'program':
      case 'answer':
      case 'hold':
        before = cue.before;
        after = cue.scene === 'program' ? before : cue.after;
        // Reveal over the first beat, then give the finished answer a full beat
        // at rest. Retain the existing wipe direction and half-second speed.
        split = cue.scene === 'answer' ? Math.min(1 - 1 / PHOTO_WIDTH, 1 - arrive(t, cue.t0 + BEAT)) : 0;
        title = cue.title;
        topic = cue.chip;
        rows = cue.rows;
        typing = cue.scene === 'program' ? panelTyping(since) : 1;
        shortPanel = cue.scene === 'program' && since < BEAT/2;
        break;
      case 'payoff': {
        before = original;
        after = final;
        const sweepStart = cue.t0 + BEAT;
        split = t >= sweepStart && t < sweepStart + BEAT * 2
          ? Math.max(2 / PHOTO_WIDTH, 0.36 * (arrive(t, sweepStart + BEAT) - arrive(t, sweepStart + BEAT * 2))) : 0;
        title = 'after';
        topic = 'after';
        rows = cue.also.length ? [{ text: 'PASS' }, ...cue.also.slice(0, 3).map(text => ({ text }))] : [];
        shortPanel = !rows.length;
        break;
      }
      case 'loop':
        before = original;
        after = final;
        title = coverTitle;
        topic = 'LIGHTROOM';
        shortPanel = true;
        break;
    }
    metrics.photoWidth = rect.w;
    metrics.split = split;
    if (before && split > 0) photoSplit(output, after, before, rect, split, accent,matte?ctx:output);
    else photo(output, after, rect);
    const mask = cue.scene === 'program' ? overlays.get(cue.pass.index) : null;
    if (mask?.canvas) {
      metrics.opacity = 0.82 + 0.18 * arrive(t, cue.t0 + BEAT);
      const layer=!matte||subjectGuides.has(mask.canvas)?output:ctx;
      layer.globalAlpha=metrics.opacity;
      photo(layer,mask.canvas,rect);
      layer.globalAlpha=1;
    }
    brackets(ctx, rect.x, rect.y, rect.w, rect.h, '#a4b9d1', 22);
    const drawSlices=()=>{
      metrics.slices=slices.draw(ctx,cue,t,arrive,setText);
      metrics.sliceBox=metrics.slices.length?slices.layout.placement:null;
      ctx.globalCompositeOperation='destination-out';
      ctx.drawImage(cut.canvas,0,0);
      ctx.globalCompositeOperation='source-over';
      output.drawImage(ctx.canvas,0,0);
      return metrics;
    };
    metrics.titleRect = titleRect;
    metrics.panelRect = panelRect;

    // Title scrim and TUI post effects are composited as separate chrome.
    const cover = cue.scene === 'hook' || cue.scene === 'loop';
    const headline = cover ? coverLines : null;
    // First baseline sits one cap-height below the chip; each extra line adds one leading step.
    const firstBaseline = cover ? 300 + Math.round(headline[0].size * 0.73) : 366;
    const lineStep = cover ? Math.round(headline[0].size * DISPLAY.leading) : 0;
    // Keep the approved two-line scrim geometry independent of the editor’s text.
    const scrimBaseline = 300 + Math.round(DISPLAY.size * .73) + DISPLAY.size;
    const scrimBottom = cover ? scrimBaseline + 150 : 425;
    const scrim = ctx.createLinearGradient(0, 235, 0, scrimBottom);
    scrim.addColorStop(0, '#04070f00');
    if (cover) {
      const hold = (scrimBaseline + 30 - 235) / (scrimBottom - 235);
      scrim.addColorStop(0.18, '#04070fa6');
      scrim.addColorStop(hold, '#04070fa6');
    } else scrim.addColorStop(0.5, '#04070f8c');
    scrim.addColorStop(1, '#04070f00');
    ctx.fillStyle = scrim;
    ctx.fillRect(rect.x, 235, rect.w, scrimBottom - 235);
    setText(ctx, cue.chip || 'LIGHTROOM', 76, 281, CHIP, accent);
    if (cover) {
      headline.forEach((line, i) => {
        ctx.letterSpacing = line.tracking;
        setText(ctx, line.text, 70, firstBaseline + i * lineStep, line.font, line.color, 10000);
        ctx.letterSpacing = '0px';
      });
    } else setText(ctx, title, 72, 366, PASS_TITLE, INK);

    // A program panel with nothing to type is just a box over the photo: skip it.
    if (shortPanel) return drawSlices();

    metrics.panelDrawn = true;
    const { x, y, w } = PANEL;
    const maxRows = rows.length;
    const h = shortPanel ? 70 : Math.min(PANEL.h, 80 + 36 * maxRows);
    const local = inner(t);
    tui.clearRect(x - 5, y - 28, w + 10, h + 33);
    tui.fillStyle = '#0b1120f7';
    tui.fillRect(x, y, w, h);
    brackets(tui, x, y, w, h, accent);
    tui.fillStyle = '#0b1120';
    tui.fillRect(x + 15, y - 20, 580, 40);
    setText(tui, topic, x + 26, y + 9, CHIP, accent, w-145);
    // One logical row per line; fit long mask expressions to the panel width.
    const terminalRows = rows.map(rowText);
    metrics.panelRows = [];
    const rowStep = 36;
    terminalRows.forEach((line, i) => {
      const reveal = typing < 1 ? clamp(typing * 1.6 - 0.09 * i) : 1;
      const letters = graphemes(line);
      const count = Math.ceil(letters.length * reveal);
      const value = letters.slice(0, count).join('').replace(/[\s·∪∩×−]+$/u,'');
      metrics.panelRows.push({ text: value, target: line, complete: count === letters.length });
      const baseline = y + 59 + i * rowStep;
      if (cue.scene === 'program' && value) {
        tui.font = MONO;
        tui.globalAlpha = 0.42 * (1 - typing);
        tui.fillStyle = accent;
        tui.fillText(value, x + 28, baseline + 4, w - 52);
        tui.globalAlpha = 1;
      }
      tui.shadowColor = accent;
      tui.shadowBlur = 4;
      setText(tui, value, x + 25, baseline, MONO, i === 0 ? INK : accent, w - 52);
      tui.shadowBlur = 0;
    });
    tui.fillStyle = accent;
    tui.globalAlpha = t === 0 ? 0.9 : 0.62 + 0.28 * Math.cos(local * Math.PI * 2);
    tui.shadowColor = accent;
    tui.shadowBlur = 4;
    tui.fillRect(x + w - 31, y + 34, 10, 22);
    tui.shadowBlur = 0;
    tui.globalAlpha = 1;
    if (cue.number != null && chapterCount > 1) {
      for (let i = 0; i < chapterCount; i++) {
        tui.fillStyle = i <= cue.number ? accent : '#596479';
        tui.beginPath();
        tui.arc(x + w - 30 - (chapterCount - 1 - i) * 24, y + h - 17, 4, 0, Math.PI * 2);
        tui.fill();
      }
    }
    tui.fillStyle = '#04070f25';
    for (let line = y + 2; line < y + h - 1; line += 3) tui.fillRect(x + 2, line, w - 4, 1);
    ctx.fillStyle = '#050914e8';
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(terminal, x - 5, y - 28, w + 10, h + 33, x - 5, y - 28, w + 10, h + 33);
    return drawSlices();
  }
  return { frame, subjectGuides, sliceLayout: slices.layout,
    maskCoverage: [...overlays].map(([index, entry]) => ({ index, coverage: entry?.coverage ?? null, overlay: !!entry?.canvas })) };
}
