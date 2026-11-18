import { canExport, encodeReel } from './reel/encode.js';
import { buildTimeline, compareFrames, FPS, HEIGHT, WIDTH } from './reel/timeline.js';
import { createScene, loadReelFonts } from './reel/scene.js';

const button = document.querySelector('#download-reel');
const status = document.querySelector('#reel-status');
const png = document.querySelector('#download-png');
const preview = document.querySelector('#reel-preview');
const downloads = document.querySelector('#reel-downloads');
const reelLink = document.querySelector('#save-reel');
const coverLink = document.querySelector('#save-cover');
let prepared;
let exporting = false;
let previewUrls = [];
let lastExport;

function notice(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function clearPreview() {
  preview.pause();
  preview.removeAttribute('src');
  preview.removeAttribute('poster');
  preview.load();
  preview.hidden = downloads.hidden = true;
  for (const url of previewUrls) URL.revokeObjectURL(url);
  reelLink.removeAttribute('href');
  coverLink.removeAttribute('href');
  previewUrls = [];
  lastExport = null;
}

function updateButton() {
  const compiled = png.hasAttribute('href');
  button.disabled = exporting || !compiled || !canExport;
  if (!canExport) notice('This browser has no compatible H.264 encoder.', true);
  else if (!compiled) {
    prepared = null;
    if (previewUrls.length) clearPreview();
    if (!exporting) notice('Compile an edit to export a Reel.');
  }
}
new MutationObserver(updateButton).observe(png, { attributeFilter: ['href'] });
updateButton();

function prepare() {
  const { state, finalFrame, reelPasses, log } = window.lrc;
  if (!state.compiled || !state.reelOriginal) return null;
  if (prepared?.href === png.href) return prepared;
  const original = state.reelOriginal;
  const compiled = finalFrame();
  const reference = state.reference || null;
  if (reference) {
    const { impact, coverage } = compareFrames(compiled, reference);
    log(`Compiled vs Lightroom JPG · mean |ΔRGB| ${impact.toFixed(3)}/255 · ${(coverage * 100).toFixed(2)}% above 4 · scaled to common frame`);
  }
  const timeline = buildTimeline(original, reelPasses(), !!reference);
  log('Reel impact · mean |ΔRGB| × √coverage · threshold 0.600');
  for (const { pass, title, impact, coverage, score, disposition, measured: m } of timeline.scores) {
    log(`  ${pass.index} ${title} · Δ ${impact.toFixed(3)} · ${(100 * coverage).toFixed(2)}% · score ${score.toFixed(3)} · ${disposition} · OKLab mask ${(100*m.maskCoverage).toFixed(2)}% · L ${m.before[0].toFixed(4)}→${m.after[0].toFixed(4)} (Δ${m.deltaL.toFixed(4)}) · C ${m.chromaBefore.toFixed(4)}→${m.chromaAfter.toFixed(4)} (Δ${m.deltaC.toFixed(4)}) · mean Δh ${m.meanHueShift.toFixed(2)}° · mean-color h ${m.hueBefore.toFixed(2)}→${m.hueAfter.toFixed(2)}°`);
  }
  log(`Reel schedule · ${timeline.duration.toFixed(1)} s · ${timeline.duration * FPS} frames · 120 BPM`);
  prepared = { href: png.href, original, compiled, reference, timeline };
  notice(`${timeline.duration.toFixed(1)} s · 1080 × 1920 · silent · preview before download`);
  return prepared;
}

function surface() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas;
}

async function makeRenderer(canvas = surface()) {
  const data = prepare();
  if (!data) throw new Error('Compile an edit first.');
  const programText = data.timeline.schedule.flatMap(cue => [cue.chip, ...(cue.rows || []).map(row => row.text)]).join(' ');
  await loadReelFonts(programText);
  return { canvas, ...createScene(canvas.getContext('2d', { alpha: false }), data) };
}

async function exportReel() {
  if (exporting) throw new Error('A Reel export is already running.');
  const data = prepare();
  if (!data) throw new Error('Compile an edit first.');
  const started = performance.now();
  const visibilityAtStart = document.visibilityState;
  exporting = true;
  window.lrc.setReelExporting(true);
  updateButton();
  notice('Preparing Reel…');
  try {
    const { canvas, frame, maskCoverage } = await makeRenderer();
    frame(0);
    const cover = await new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the cover JPG.'));
    }, 'image/jpeg', 0.95));
    const result = await encodeReel(canvas, frame, data.timeline.duration, notice);
    const duration = data.timeline.duration;
    const wallMilliseconds = performance.now() - started;
    const base = png.download.replace(/-compiled\.png$/i, '');
    clearPreview();
    for (const [link, blob, name] of [[reelLink, result.blob, 'reel.mp4'], [coverLink, cover, 'cover.jpg']]) {
      link.href = URL.createObjectURL(blob);
      link.download = `${base}-${name}`;
      previewUrls.push(link.href);
    }
    preview.src = reelLink.href;
    preview.poster = coverLink.href;
    preview.hidden = downloads.hidden = false;
    const averageMbps = result.blob.size * 8 / duration / 1e6;
    notice(`${duration.toFixed(1)} s · ${(result.blob.size / 1048576).toFixed(2)} MiB · ${averageMbps.toFixed(2)} Mbps · ${result.mode}`);
    window.lrc.log(`Reel export · ${result.mode} · ${result.blob.size} bytes · ${(wallMilliseconds / 1000).toFixed(3)} s wall clock · started ${visibilityAtStart}`);
    if (result.warning) window.lrc.log(`Reel fallback · ${result.warning}`);
    window.lrc.log(`Reel achieved average · ${averageMbps.toFixed(3)} Mbps · target 12–16 Mbps`);
    lastExport = { ...result, cover, duration, averageMbps, wallMilliseconds, visibilityAtStart, maskCoverage };
    return lastExport;
  } catch (error) {
    notice(`Reel export failed. ${error.message}`, true);
    throw error;
  } finally {
    exporting = false;
    window.lrc.setReelExporting(false);
    updateButton();
  }
}

button.addEventListener('click', () => exportReel().catch(() => {}));
window.addEventListener('pagehide', () => previewUrls.forEach(URL.revokeObjectURL));
window.lrcReel = { prepare, export: exportReel, makeRenderer, get last() { return lastExport; } };
