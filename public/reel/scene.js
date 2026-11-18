import { BEAT, FPS, HEIGHT, PHOTO_WIDTH, WIDTH } from './timeline.js';
import { createSlices } from './slices.js';

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
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
// Approach a node ahead of its beat. The frame at the beat belongs to the new node.
const arrive = (time, beat, travel = BEAT) => ease((time - beat + travel) / travel);
const inner = time => (time % BEAT) / BEAT;

function photoRect(image) {
  const width = PHOTO_WIDTH;
  const height = Math.min(1776, width * image.height / image.width);
  const w = Math.min(width, height * image.width / image.height);
  return { x: (WIDTH - w) / 2, y: (HEIGHT - height) / 2, w, h: height };
}

function photo(ctx, image, rect) {
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
}

function photoSplit(ctx, after, before, rect, left, accent) {
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
  ctx.fillStyle = '#ffffffd9';
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillRect(x - 1.5, rect.y, 3, rect.h);
  ctx.restore();
  // Only the handles in the chrome glow. The divider on the image stays crisp.
  ctx.save();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillRect(x - 7, rect.y - 6, 14, 5);
  ctx.fillRect(x - 7, rect.y + rect.h + 1, 14, 5);
  ctx.restore();
}

function maskOverlay(mask, bakedColor, accent, rect) {
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
  if (coverage < 0.01) return { coverage, canvas: null };
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
      data.data[output + 3] = edge ? 248 : Math.round(140 * weights[p]);
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

const displayValue = (x, decimals) => x.toFixed(decimals).replace(/^-/, '−');
function rowText(row, progress) {
  if (row.text) return row.text;
  const from = row.from ?? 0;
  const value = mix(from, row.value, progress);
  const units = row.label === 'WB' ? ' K' : '';
  return `${row.label} ${displayValue(from, Math.min(2, row.decimals))} → ${displayValue(value, row.decimals)}${units}`;
}

function wrap(line) {
  const result = [];
  while (Array.from(line).length > 28) {
    const chars = Array.from(line);
    const head = chars.slice(0, 28).join('');
    const space = head.lastIndexOf(' ');
    const cut = space > 12 ? space : head.length;
    result.push(line.slice(0, cut).trimEnd());
    line = line.slice(cut).trimStart();
  }
  result.push(line);
  return result;
}

// Lay out the cover headline: sentence breaks become lines with weight
// contrast; a single sentence wraps by measured width, shrinking only if a
// line still overflows. Never squeeze glyphs with fillText's maxWidth.
function headlineLayout(ctx, text) {
  const sentences = text.split(/(?<=[.!?。])\s+/).filter(Boolean);
  const contrast = sentences.length > 1;
  for (let size = DISPLAY.size; size >= DISPLAY.min; size -= 4) {
    const fontFor = i => `${DISPLAY.weights[contrast ? Math.min(i, 1) : 0]} ${size}px ${DISPLAY.family}`;
    ctx.letterSpacing = `${(DISPLAY.tracking * size).toFixed(2)}px`;
    const measure = (line, i) => {
      ctx.font = fontFor(i);
      return ctx.measureText(line).width;
    };
    let lines;
    if (contrast) lines = sentences.slice(0, 2);
    else {
      lines = [];
      for (const word of text.split(/\s+/)) {
        const next = lines.length ? `${lines.at(-1)} ${word}` : word;
        if (lines.length && measure(next, 0) <= DISPLAY.maxWidth) lines[lines.length - 1] = next;
        else lines.push(word);
      }
    }
    ctx.letterSpacing = '0px';
    const fits = lines.length <= 2 && lines.every((line, i) => {
      ctx.letterSpacing = `${(DISPLAY.tracking * size).toFixed(2)}px`;
      const ok = measure(line, i) <= DISPLAY.maxWidth;
      ctx.letterSpacing = '0px';
      return ok;
    });
    if (fits || size - 4 < DISPLAY.min) {
      return lines.slice(0, 2).map((line, i) => ({
        text: line, font: fontFor(i), size,
        color: DISPLAY.colors[contrast ? Math.min(i, 1) : 0],
        tracking: `${(DISPLAY.tracking * size).toFixed(2)}px`
      }));
    }
  }
}

export function createScene(ctx, { original, compiled, reference, timeline }) {
  const { schedule, duration, chapterCount } = timeline;
  const final = reference || compiled;
  // One geometry for every source, mask, wipe and frame, for the entire Reel.
  const rect = photoRect(original);
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
  const slices = createSlices(schedule, { panelRect });
  const overlays = new Map();
  for (const cue of schedule.filter(cue => cue.scene === 'program')) {
    overlays.set(cue.pass.index, maskOverlay(cue.pass.mask, cue.pass.color, cue.color, rect));
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
    const priorLead = schedule[sceneIndex - 1]?.lead || cue.lead;
    const leadFade = ease(since / 0.14);
    const level = pane => mix(priorLead === pane ? 1 : 0.42, cue.lead === pane ? 1 : 0.42, leadFade);
    const accent = cue.color || SIGNAL;
    const metrics = { scene: cue.scene, lead: cue.lead, photoRect: { ...rect }, panelDrawn: false,
      photoLevel: level('photo'), programLevel: level('program'), opacity: 0, text: [] };
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
    };

    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    let before, after, split = 0, title, topic, rows = [], typing = 1;
    let shortPanel = false;
    switch (cue.scene) {
      case 'hook':
        before = original;
        after = final;
        split = 0.19 * (1 - arrive(t, BEAT));
        title = coverTitle;
        topic = 'xmp · the edit';
        shortPanel = true;
        break;
      case 'rewind':
        before = final;
        after = original;
        split = Math.min(1 - 1 / PHOTO_WIDTH, 1 - progress);
        title = 'Straight out of camera';
        topic = 'xmp · rewind';
        shortPanel = true;
        break;
      case 'camera':
        before = cue.before;
        after = cue.after;
        split = cue.rows.length ? Math.min(1 - 1 / PHOTO_WIDTH, 1 - progress) : 0;
        title = cue.rows.length ? 'Set the base exposure' : 'Straight out of camera';
        topic = 'xmp · base settings';
        rows = cue.rows;
        typing = arrive(t,cue.t1,BEAT/2);
        shortPanel = !rows.length || since < BEAT/2;
        break;
      case 'program':
      case 'answer':
      case 'hold':
        before = cue.before;
        after = cue.scene === 'program' ? before : cue.after;
        split = cue.scene === 'answer' ? Math.min(1 - 1 / PHOTO_WIDTH, 1 - progress) : 0;
        title = cue.title;
        topic = 'xmp · ' + cue.chip;
        rows = cue.rows;
        typing = cue.scene === 'program' ? arrive(t, cue.t1, BEAT/2) : 1;
        shortPanel = cue.scene === 'program' && since < BEAT/2;
        break;
      case 'payoff': {
        before = original;
        after = final;
        const sweepStart = cue.t0 + BEAT;
        split = t >= sweepStart && t < sweepStart + BEAT * 2
          ? Math.max(2 / PHOTO_WIDTH, 0.36 * (arrive(t, sweepStart + BEAT) - arrive(t, sweepStart + BEAT * 2))) : 0;
        title = 'The finished frame';
        topic = reference ? 'Lightroom finish' : 'Compiled finish';
        rows = cue.also.length ? [{ text: 'Also in the edit' }, ...cue.also.slice(0, 4).map(text => ({ text }))] : [];
        shortPanel = !rows.length;
        break;
      }
      case 'loop':
        before = original;
        after = final;
        split = 0.19 * progress;
        title = coverTitle;
        topic = 'xmp · the edit';
        shortPanel = true;
        break;
    }
    metrics.photoWidth = rect.w;
    metrics.split = split;
    if (before && split > 0) photoSplit(ctx, after, before, rect, split, accent);
    else photo(ctx, after, rect);
    const mask = cue.scene === 'program' ? overlays.get(cue.pass.index) : null;
    if (!shortPanel && level('photo') < 1) {
      ctx.fillStyle = `rgba(0,0,0,${1 - level('photo')})`;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    if (mask?.canvas) {
      metrics.opacity = 0.82 + 0.18 * arrive(t, cue.t0 + BEAT);
      ctx.globalAlpha = metrics.opacity;
      photo(ctx, mask.canvas, rect);
      ctx.globalAlpha = 1;
    }
    brackets(ctx, rect.x, rect.y, rect.w, rect.h, '#a4b9d1', 22);
    const drawSlices=()=>{
      metrics.slices=slices.draw(ctx,cue,t,arrive,setText);
      metrics.sliceBox=metrics.slices.length?slices.layout.placement:null;
      return metrics;
    };
    metrics.titleRect = titleRect;
    metrics.panelRect = panelRect;

    // Title scrim and TUI post effects are composited as separate chrome.
    const cover = cue.scene === 'hook' || cue.scene === 'loop';
    const headline = cover ? headlineLayout(ctx, title) : null;
    // First baseline sits one cap-height below the chip; each extra line adds one leading step.
    const firstBaseline = cover ? 300 + Math.round(headline[0].size * 0.73) : 366;
    const lineStep = cover ? Math.round(headline[0].size * DISPLAY.leading) : 0;
    // Cover scrim holds full strength through the last line, then fades below it.
    const scrimBottom = cover ? firstBaseline + lineStep * (headline.length - 1) + 150 : 425;
    const scrim = ctx.createLinearGradient(0, 235, 0, scrimBottom);
    scrim.addColorStop(0, '#04070f00');
    if (cover) {
      const hold = (firstBaseline + lineStep * (headline.length - 1) + 30 - 235) / (scrimBottom - 235);
      scrim.addColorStop(0.18, '#04070fa6');
      scrim.addColorStop(hold, '#04070fa6');
    } else scrim.addColorStop(0.5, '#04070f8c');
    scrim.addColorStop(1, '#04070f00');
    ctx.fillStyle = scrim;
    ctx.fillRect(rect.x, 235, rect.w, scrimBottom - 235);
    setText(ctx, '/ framebuffer', 76, 281, CHIP, accent);
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
    const maxRows = rows.flatMap(row => wrap(rowText(row, 1))).slice(0, 6).length;
    const h = shortPanel ? 70 : Math.min(PANEL.h, 80 + 36 * maxRows);
    const local = inner(t);
    tui.clearRect(x - 5, y - 28, w + 10, h + 33);
    tui.fillStyle = '#0b1120f7';
    tui.fillRect(x, y, w, h);
    brackets(tui, x, y, w, h, accent);
    tui.fillStyle = '#0b1120';
    tui.fillRect(x + 15, y - 20, 580, 40);
    setText(tui, wrap('/ ' + topic)[0], x + 26, y + 9, CHIP, accent, w-145);
    const allRows = rows.flatMap(row => wrap(rowText(row, typing)));
    const pages = Math.ceil(allRows.length / 6);
    const page = cue.scene === 'hold' ? Math.min(pages - 1, 1 + Math.floor(since / BEAT)) : 0;
    const terminalRows = allRows.slice(Math.max(0, page) * 6, (Math.max(0, page) + 1) * 6);
    const rowStep = 36;
    terminalRows.forEach((line, i) => {
      const reveal = typing < 1 ? clamp(typing * 1.6 - 0.09 * i) : 1;
      const letters = Array.from(line);
      const count = Math.floor(letters.length * reveal);
      const value = letters.slice(0, count).join('');
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
    ctx.globalAlpha = level('program');
    ctx.drawImage(terminal, x - 5, y - 28, w + 10, h + 33, x - 5, y - 28, w + 10, h + 33);
    ctx.globalAlpha = 1;
    return drawSlices();
  }
  return { frame, sliceLayout: slices.layout,
    maskCoverage: [...overlays].map(([index, entry]) => ({ index, coverage: entry?.coverage ?? null, overlay: !!entry?.canvas })) };
}
