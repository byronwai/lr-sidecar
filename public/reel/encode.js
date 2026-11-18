import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.js';
import { FPS, WIDTH, HEIGHT } from './timeline.js';
import { recordFallback } from './record-fallback.js';

const MIME = ['video/mp4;codecs=avc1.64002a', 'video/mp4;codecs=avc1.420028', 'video/mp4;codecs=avc1'];
const fallbackType = MIME.find(type => globalThis.MediaRecorder?.isTypeSupported(type));
const encoderConfig = {
  codec: 'avc1.64002a', width: WIDTH, height: HEIGHT, framerate: FPS,
  bitrate: 16_000_000, bitrateMode: 'constant', latencyMode: 'quality', avc: { format: 'avc' }
};
export const canExport = Boolean(globalThis.VideoEncoder || fallbackType);

function yieldTask(channel) {
  return new Promise(resolve => {
    channel.port1.onmessage = resolve;
    channel.port2.postMessage(null);
  });
}

async function encodeOffline(canvas, frame, duration, config, onProgress) {
  const count = Math.round(duration * FPS);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory',
    video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS }
  });
  const channel = new MessageChannel();
  let failed, profile, openingKeyframe, chunks = 0;
  const failure = new AbortController();
  const fail = error => {
    failed = error;
    failure.abort(error);
  };
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      try {
        // The renderer closes on frame 0. Reuse its independently decodable
        // IDR at the final timestamp too: rate control can otherwise quantize
        // the identical closing image differently and introduce a loop flash.
        if (chunk.timestamp === 0) {
          if (chunk.type !== 'key') throw new Error('The opening frame must be a keyframe.');
          openingKeyframe = new Uint8Array(chunk.byteLength);
          chunk.copyTo(openingKeyframe);
        } else if (chunk.timestamp === Math.round((count - 1) * 1_000_000 / FPS)) {
          if (!openingKeyframe) throw new Error('The opening keyframe is unavailable.');
          chunk = new EncodedVideoChunk({ type: 'key', timestamp: chunk.timestamp,
            duration: chunk.duration, data: openingKeyframe });
        }
        if (metadata?.decoderConfig?.description) {
          const description = metadata.decoderConfig.description;
          profile = ArrayBuffer.isView(description)
            ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)[1]
            : new Uint8Array(description)[1];
        }
        muxer.addVideoChunk(chunk, metadata);
        chunks++;
      } catch (error) {
        fail(error);
      }
    },
    error: fail
  });
  try {
    encoder.configure(config);
    for (let i = 0; i < count; i++) {
      if (failed) throw failed;
      if (encoder.encodeQueueSize >= 8) {
        await new Promise((resolve, reject) => {
          const stop = () => {
            encoder.removeEventListener('dequeue', ready);
            reject(failed);
          };
          const ready = () => {
            failure.signal.removeEventListener('abort', stop);
            resolve();
          };
          encoder.addEventListener('dequeue', ready, { once: true });
          failure.signal.addEventListener('abort', stop, { once: true });
        });
      }
      const timestamp = Math.round(i * 1_000_000 / FPS);
      const end = Math.round((i + 1) * 1_000_000 / FPS);
      frame(i / FPS);
      const videoFrame = new VideoFrame(canvas, { timestamp, duration: end - timestamp });
      try {
        encoder.encode(videoFrame, { keyFrame: i % (FPS * 2) === 0 || i === count - 1 });
      } finally {
        videoFrame.close();
      }
      if (i % 8 === 0) {
        onProgress(`Encoding Reel · ${Math.round(100 * i / count)}%`);
        await yieldTask(channel);
      }
    }
    await encoder.flush();
    if (failed) throw failed;
    if (profile !== 100) throw new Error(`The encoder returned AVC profile ${profile ?? 'unknown'} instead of High.`);
    if (chunks !== count) throw new Error(`The encoder returned ${chunks} of ${count} frames.`);
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mode: 'WebCodecs · H.264 High · 30 fps CFR', frames: count };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    channel.port1.close();
    channel.port2.close();
  }
}

export async function encodeReel(canvas, frame, duration, onProgress) {
  const errors = [];
  if (globalThis.VideoEncoder && globalThis.VideoFrame) {
    for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
      try {
        const { supported, config } = await VideoEncoder.isConfigSupported({ ...encoderConfig, hardwareAcceleration });
        if (supported) return await encodeOffline(canvas, frame, duration, config, onProgress);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  if (!fallbackType) throw new Error(errors.join(' · ') || 'H.264 MP4 is unavailable in this browser.');
  if (document.hidden) throw new Error('The fallback recorder needs a visible tab.');
  onProgress('Using the real-time fallback · keep this tab visible');
  return {
    blob: await recordFallback(canvas, frame, duration, fallbackType, onProgress),
    mode: 'MediaRecorder fallback · real time', warning: errors.join(' · ')
  };
}
