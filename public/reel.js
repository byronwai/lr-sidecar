const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const MAX_VISIBLE_PASSES = 8;
const INTRO_SECONDS = 2.3;
const PASS_SECONDS = 2.2;
const OUTRO_SECONDS = 2.4;
const FRAME = { x: 540, y: 946, boxWidth: 916, boxHeight: 1170 };
const MIME_TYPES = ['video/mp4;codecs=avc1.420028', 'video/mp4;codecs=avc1'];

const button = document.querySelector('#download-reel');
const status = document.querySelector('#reel-status');
const png = document.querySelector('#download-png');
const input = document.querySelector('#input');
const mimeType = MIME_TYPES.find(type => globalThis.MediaRecorder?.isTypeSupported(type));
const supported = mimeType && typeof HTMLCanvasElement.prototype.captureStream === 'function';
let exporting = false;
let currentHref;

function setStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function updateButton() {
  const href = png.getAttribute('href');
  button.disabled = exporting || !supported || !href;
  if (exporting || href === currentHref) return;
  currentHref = href;
  if (!supported) {
    setStatus('H.264 MP4 recording is unavailable in this browser. Open this page in a supported Chrome build.', true);
  } else {
    setStatus(href ? '1080 × 1920 · 30 fps · silent MP4' : 'Compile an edit to export a Reel.');
  }
}

new MutationObserver(updateButton).observe(png, { attributeFilter: ['href'] });
updateButton();

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function snapshot(source, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = makeCanvas(Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function ease(start, end, time) {
  const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function drawFitted(ctx, image, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
}

function drawCard(ctx, photo, { x, y, boxWidth, boxHeight, skew = 0, tilt = 0,
  opacity = 1, color, texture, textureOpacity = 0 }) {
  const scale = Math.min(boxWidth / photo.width, boxHeight / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.fillStyle = '#0d1424';
  ctx.shadowColor = '#030713';
  ctx.shadowBlur = 24;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.shadowBlur = 0;
  drawFitted(ctx, photo, width, height);
  if (texture && textureOpacity > 0) {
    ctx.globalAlpha = opacity * textureOpacity;
    drawFitted(ctx, texture, width, height);
    ctx.globalAlpha = opacity;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

function createScene(ctx, original, compiled, passes) {
  const background = makeCanvas(WIDTH, HEIGHT);
  const bg = background.getContext('2d');
  const glow = bg.createRadialGradient(540, 900, 70, 540, 900, 920);
  glow.addColorStop(0, '#23344d');
  glow.addColorStop(1, '#0d1424');
  bg.fillStyle = glow;
  bg.fillRect(0, 0, WIDTH, HEIGHT);
  bg.strokeStyle = '#b2caff13';
  bg.beginPath();
  for (let x = 0; x < WIDTH; x += 48) {
    bg.moveTo(x, 0);
    bg.lineTo(x, HEIGHT);
  }
  for (let y = 0; y < HEIGHT; y += 48) {
    bg.moveTo(0, y);
    bg.lineTo(WIDTH, y);
  }
  bg.stroke();

  const layers = passes.slice(0, MAX_VISIBLE_PASSES);
  const outroStart = INTRO_SECONDS + passes.length * PASS_SECONDS;
  return time => {
    ctx.drawImage(background, 0, 0);
    let title, caption, source, accent = '#95c8ff';
    if (time < INTRO_SECONDS) {
      title = time < 0.7 ? 'Camera preview' : 'The edit, layer by layer';
      caption = 'LR Sidecar Compiler';
      const spread = ease(0.48, 1.65, time);
      layers.forEach(({ color, mask, result }, index) => {
        const offset = index - (layers.length - 1) / 2;
        const isFront = index === layers.length - 1;
        drawCard(ctx, original, {
          x: FRAME.x + offset * 44 * spread,
          y: FRAME.y + offset * 80 * spread,
          boxWidth: 916 - spread * 238,
          boxHeight: 1170 - spread * 560,
          skew: -0.16 * spread,
          tilt: -0.19 * spread,
          opacity: isFront ? 1 : spread,
          color,
          texture: mask || result,
          textureOpacity: spread
        });
      });
      if (!layers.length) drawCard(ctx, original, { ...FRAME, color: accent });
    } else if (time < outroStart) {
      const index = Math.floor((time - INTRO_SECONDS) / PASS_SECONDS);
      const elapsed = time - INTRO_SECONDS - index * PASS_SECONDS;
      const pass = passes[index];
      accent = pass.color;
      title = pass.name;
      source = pass.source;
      if (pass.mask && elapsed < 1.05) {
        drawCard(ctx, pass.mask, { ...FRAME, color: accent });
        caption = `${index + 1}/${passes.length} · ${pass.kind === 'remove' ? 'ACR patch' : 'Mask coverage'}`;
      } else {
        const before = passes[index - 1]?.result || original;
        const progress = ease(pass.mask ? 1.05 : 0.35, pass.mask ? 1.75 : 1.6, elapsed);
        drawCard(ctx, before, { ...FRAME, color: accent });
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, WIDTH * progress, HEIGHT);
        ctx.clip();
        drawCard(ctx, pass.result, { ...FRAME, color: accent });
        ctx.restore();
        caption = `${index + 1}/${passes.length} · Rendered change`;
      }
    } else {
      title = 'Compiled image';
      caption = 'ARW + XMP + ACR';
      accent = '#ffa24a';
      drawCard(ctx, compiled, { ...FRAME, color: accent });
    }
    ctx.fillStyle = accent;
    ctx.font = '600 32px monospace';
    ctx.fillText(caption, 82, 254, 820);
    ctx.fillStyle = '#e8edf6';
    ctx.font = '600 52px system-ui';
    ctx.fillText(title, 82, 326, 820);
    if (source) {
      ctx.fillStyle = '#b6c7dd';
      ctx.font = '400 30px system-ui';
      ctx.fillText(source, 82, 1610, 820);
    }
  };
}

async function record(canvas, draw, duration) {
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks();
  try {
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    return await new Promise((resolve, reject) => {
      let animation;
      let stopTimeout;
      let completed = false;
      const cancel = () => {
        if (document.hidden) finish(new Error('Keep this tab visible while recording and try again.'));
      };
      const finish = (error, blob) => {
        if (completed) return;
        completed = true;
        cancelAnimationFrame(animation);
        clearTimeout(stopTimeout);
        document.removeEventListener('visibilitychange', cancel);
        if (recorder.state !== 'inactive') recorder.stop();
        if (error) reject(error);
        else resolve(blob);
      };
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = event => finish(event.error || new Error('The video encoder failed.'));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/mp4' });
        if (!stopTimeout || !blob.size) finish(new Error('The encoder did not finish the MP4.'));
        else finish(null, blob);
      };

      let started;
      let lastFrame = -1;
      const tick = now => {
        try {
          started ??= now;
          const elapsed = (now - started) / 1000;
          if (elapsed >= duration) {
            setStatus('Finalizing MP4…');
            stopTimeout = setTimeout(() => finish(new Error('The MP4 encoder timed out.')), 15_000);
            recorder.stop();
            return;
          }
          const frame = Math.floor(elapsed * FPS);
          if (frame !== lastFrame) {
            draw(frame / FPS);
            track.requestFrame();
            if (Math.floor(frame / FPS) !== Math.floor(lastFrame / FPS)) {
              setStatus(`Recording Reel… ${Math.floor(frame / FPS) + 1}/${Math.ceil(duration)} s · keep this tab visible`);
            }
            lastFrame = frame;
          }
          animation = requestAnimationFrame(tick);
        } catch (error) {
          finish(error);
        }
      };

      try {
        if (document.hidden) throw new Error('Keep this tab visible while recording and try again.');
        draw(0);
        recorder.start();
        document.addEventListener('visibilitychange', cancel);
        animation = requestAnimationFrame(tick);
      } catch (error) {
        finish(error);
      }
    });
  } finally {
    track.stop();
  }
}

function download(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

document.addEventListener('click', async event => {
  if (event.target.closest('#download-reel') !== button || button.disabled) return;
  exporting = true;
  updateButton();
  setStatus('Preparing Reel…');
  try {
    if (input.hidden || !input.width || !input.height) throw new Error('The camera preview is unavailable.');
    const filename = png.download.replace(/\.png$/i, '') + '-reel.mp4';
    const original = snapshot(input, 1400);
    const passes = window.lrc.reelPasses();
    const response = await fetch(png.href);
    if (!response.ok) throw new Error('The compiled PNG is unavailable. Compile the edit and try again.');
    const bitmap = await createImageBitmap(await response.blob());
    let compiled;
    try {
      compiled = snapshot(bitmap, 1400);
    } finally {
      bitmap.close();
    }
    const canvas = makeCanvas(WIDTH, HEIGHT);
    const draw = createScene(canvas.getContext('2d', { alpha: false }), original, compiled, passes);
    const duration = INTRO_SECONDS + passes.length * PASS_SECONDS + OUTRO_SECONDS;
    download(await record(canvas, draw, duration), filename);
    setStatus('Reel exported · MP4 download started.');
  } catch (error) {
    setStatus(`Reel export failed. ${error.message || error}`, true);
  } finally {
    exporting = false;
    updateButton();
  }
});
