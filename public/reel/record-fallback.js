import { FPS } from './timeline.js';

export async function recordFallback(canvas, draw, duration, mimeType, setStatus) {
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

