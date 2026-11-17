import { bytesOf } from './tiff.js';

// Sony's 128-word XOR pad uses big-endian stream words, regardless of TIFF order.
// Algorithm documented by dcraw/LibRaw and ExifTool (links in NOTES.md).
export function sonyDecrypt(input, key) {
  const result = new Uint8Array(bytesOf(input));
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  const pad = new Uint32Array(128);
  for (let i = 0; i < 4; i++) {
    key = (Math.imul(key, 48828125) + 1) >>> 0;
    pad[i] = key;
  }
  pad[3] = (pad[3] << 1) | ((pad[0] ^ pad[2]) >>> 31);
  for (let i = 4; i < 127; i++) {
    pad[i] = ((pad[i - 4] ^ pad[i - 2]) << 1) | ((pad[i - 3] ^ pad[i - 1]) >>> 31);
  }
  for (let p = 0; p + 4 <= result.length; p += 4) {
    const i = 127 + p / 4;
    pad[i & 127] = pad[(i + 1) & 127] ^ pad[(i + 65) & 127];
    view.setUint32(p, view.getUint32(p, false) ^ pad[i & 127], false);
  }
  return result;
}

// Read only named SR2 tags. Other private fields can use formats we do not know.
function privateIFD(input, offset, le, tags, offsetBase = 0) {
  const bytes = bytesOf(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function check(at, size) {
    if (!Number.isSafeInteger(at) || at < 0 || at + size > bytes.length) {
      throw new Error('Sony SR2 directory or value is out of bounds');
    }
  }
  check(offset, 2);
  const count = view.getUint16(offset, le);
  if (count > 1024) throw new Error('Sony SR2 directory is too large');
  check(offset + 2, count * 12 + 4);
  const result = {};
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12, tag = view.getUint16(p, le);
    if (!tags.has(tag)) continue;
    const type = view.getUint16(p + 2, le), n = view.getUint32(p + 4, le);
    const width = ({ 1: 1, 7: 1, 3: 2, 8: 2, 4: 4, 9: 4 })[type];
    if (!width || n > 1024) throw new Error(`Unsupported Sony WB field 0x${tag.toString(16)}`);
    const at = n * width <= 4 ? p + 8 : view.getUint32(p + 8, le) + offsetBase;
    check(at, n * width);
    const values = Array.from({ length: n }, (_, j) => {
      const q = at + j * width;
      if (type === 8) return view.getInt16(q, le);
      if (type === 3) return view.getUint16(q, le);
      if (type === 9) return view.getInt32(q, le);
      if (type === 4) return view.getUint32(q, le);
      return bytes[q];
    });
    // UNDEFINED[4] keys are raw 32-bit words, not a four-element array of gains.
    result[tag] = (type === 7 && n === 4) ? view.getUint32(at, le) : n === 1 ? values[0] : values;
  }
  return result;
}

const kelvinTags = new Map([
  [0x782d, 2500], [0x782c, 3200], [0x7824, 4500], [0x782b, 6000], [0x782a, 8500]
]);
const normalise = levels => [levels[0] / levels[1], 1, levels[2] / levels[1]];
const validLevels = levels => Array.isArray(levels) && levels.length === 3 && levels.every(v => Number.isFinite(v) && v > 0);
const logRatios = levels => [Math.log(levels[0] / levels[1]), Math.log(levels[2] / levels[1])];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Tint is a small green/magenta offset in log gain, not an uncalibrated Kelvin offset.
const TINT_LOG_GAIN = 0.002;

export function inferIlluminant(levels, calibrations) {
  if (!validLevels(levels) || calibrations.length < 2) throw new Error('Insufficient Sony WB calibration');
  const points = calibrations.map(p => ({ ...p, xy: logRatios(p.levels), mired: 1e6 / p.kelvin }))
    .sort((a, b) => a.mired - b.mired);
  const sample = logRatios(levels);
  let best;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    // Temperature changes opposing R and B gains; tint changes their common mode.
    const da = a.xy[0] - a.xy[1], db = b.xy[0] - b.xy[1];
    if (Math.abs(db - da) < 1e-9) continue;
    const t = clamp((sample[0] - sample[1] - da) / (db - da), 0, 1);
    const xy = a.xy.map((v, c) => v + (b.xy[c] - v) * t);
    const error = Math.abs(sample[0] - sample[1] - (xy[0] - xy[1]));
    if (!best || error < best.error) {
      const residual = (sample[0] - xy[0] + sample[1] - xy[1]) / 2;
      best = {
        kelvin: 1e6 / (a.mired + (b.mired - a.mired) * t),
        tint: residual / TINT_LOG_GAIN,
        error,
        bracket: [a.kelvin, b.kelvin],
        residual
      };
    }
  }
  if (!best || best.error > 0.15) throw new Error('As-shot WB lies outside the camera calibration locus');
  return best;
}

export function calibrationAt(calibrations, kelvin) {
  const points = calibrations.slice().sort((a, b) => a.kelvin - b.kelvin);
  const temperature = clamp(kelvin, points[0].kelvin, points.at(-1).kelvin);
  let i = 1;
  while (i < points.length - 1 && points[i].kelvin < temperature) i++;
  const a = points[i - 1], b = points[i];
  const t = (1e6 / temperature - 1e6 / a.kelvin) / (1e6 / b.kelvin - 1e6 / a.kelvin);
  return a.levels.map((v, c) => Math.exp(Math.log(v) + (Math.log(b.levels[c]) - Math.log(v)) * t));
}

export function readSonyWhiteBalance(input, tiff) {
  const bytes = bytesOf(input), le = tiff.byteOrder === 'II';
  try {
    const entry = tiff.ifds[0].entries.find(e => e.tag === 0xc634);
    if (!entry || !(entry.count === 4 || ([4, 13].includes(entry.type) && entry.count === 1))) {
      throw new Error('Sony SR2 private pointer is missing');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const privateOffset = view.getUint32(entry.at, le);
    const header = privateIFD(bytes, privateOffset, le, new Set([0x7200, 0x7201, 0x7221]));
    const offset = header[0x7200], length = header[0x7201], key = header[0x7221];
    if (!Number.isInteger(offset) || !Number.isInteger(length) || length < 6 || length > 10 * 1024 * 1024 ||
      offset < 0 || offset + length > bytes.length || key == null) throw new Error('Invalid encrypted Sony SR2 bounds');
    const block = sonyDecrypt(bytes.subarray(offset, offset + length), key);
    const fields = privateIFD(block, 0, le, new Set([0x7313, 0x7303, 0x7800, ...kelvinTags.keys()]), -offset);
    const tag = fields[0x7313] ? 0x7313 : 0x7303, rggb = fields[tag];
    if (!Array.isArray(rggb) || rggb.length !== 4 || rggb.some(v => v <= 0)) throw new Error('Sony as-shot WB levels are missing');
    const rgb = tag === 0x7313 ? [rggb[0], (rggb[1] + rggb[2]) / 2, rggb[3]] :
      [rggb[1], (rggb[0] + rggb[3]) / 2, rggb[2]];
    const levels = normalise(rgb);
    const calibrations = [...kelvinTags].filter(([id]) => validLevels(fields[id])).map(([id, kelvin]) => ({
      tag: `0x${id.toString(16)}`, kelvin, levels: normalise(fields[id])
    }));
    const fit = inferIlluminant(levels, calibrations);
    return {
      source: 'Sony SR2', estimated: false, method: 'Camera Kelvin presets, log gains interpolated in mired space',
      tag: `0x${tag.toString(16)}`, order: tag === 0x7313 ? 'RGGB' : 'GRBG', rawLevels: rggb,
      levels, kelvin: fit.kelvin, tint: fit.tint, fit, calibrations,
      colorMatrix: fields[0x7800]?.map(v => v / 1024),
      privateOffset, encryptedOffset: offset, encryptedLength: length
    };
  } catch (error) {
    const lightSource = tiff.ifds.find(i => i.tags[0xa408] != null)?.tags[0xa408];
    const kelvin = ({ 1: 5500, 3: 2850, 4: 5500, 9: 5500, 10: 6500, 11: 7500, 17: 2856, 18: 4874, 19: 6774 })[lightSource] || 5500;
    return { source: 'estimated', estimated: true, kelvin, tint: 0, reason: error.message,
      method: lightSource ? 'EXIF LightSource illuminant estimate' : 'No usable illuminant metadata; daylight estimate' };
  }
}

export function relativeWhiteBalance(asShot, settings = {}) {
  const source = asShot || { kelvin: 5500, tint: 0, estimated: true };
  const kelvin = Number(settings.Temperature ?? source.kelvin), tint = Number(settings.Tint ?? source.tint ?? 0);
  let gains;
  if (source.calibrations?.length >= 2 && source.levels) {
    const target = calibrationAt(source.calibrations, kelvin);
    const tintGain = Math.exp(clamp(tint, -150, 150) * TINT_LOG_GAIN);
    gains = target.map((v, c) => v * (c === 1 ? 1 : tintGain) / source.levels[c]);
  } else {
    // Estimated path: a broad RGB sensitivity model, with the shift expressed in mired.
    const delta = 1e6 / Math.max(1500, kelvin) - 1e6 / source.kelvin;
    const magenta = (tint - (source.tint || 0)) * TINT_LOG_GAIN;
    gains = [Math.exp(-delta * 0.001 + magenta), 1, Math.exp(delta * 0.001 + magenta)];
  }
  // Chromatic adaptation should not introduce a second exposure adjustment.
  const y = gains[0] * 0.2126 + gains[1] * 0.7152 + gains[2] * 0.0722;
  return { gains: gains.map(v => v / y), sourceKelvin: source.kelvin, targetKelvin: kelvin,
    deltaMired: 1e6 / Math.max(1500, kelvin) - 1e6 / source.kelvin, estimated: source.estimated };
}
