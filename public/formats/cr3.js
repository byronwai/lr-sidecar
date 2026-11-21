import { bytesOf, readTIFF } from './tiff.js';
import { jpegEnd, jpegSize } from './arw.js';

const canonUUID = '85c0b687820f11e08111f4ce462b6a48';
const previewUUID = 'eaf42b5e1c984b88b9fbb7dc406e4d16';
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl']);
const ascii = bytes => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');

function requireBytes(offset, length, end, field) {
  if (!Number.isSafeInteger(length) || length < 0 || length > end - offset) {
    throw new Error(`CR3: truncated or invalid ${field} at ${offset}`);
  }
}

function boxTree(bytes, view) {
  let count = 0;
  function walk(start, end, depth) {
    const result = [];
    for (let offset = start; offset < end;) {
      if (++count > 20000 || depth > 24) throw new Error('CR3: excessive box nesting or count');
      requireBytes(offset, 8, end, 'box header');
      let size = view.getUint32(offset), body = offset + 8;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, body));
      if (size === 1) {
        requireBytes(body, 8, end, type + ' extended size');
        size = Number(view.getBigUint64(body));
        body += 8;
      } else if (!size) size = end - offset;
      requireBytes(offset, size, end, type + ' box');
      const box = { type, offset, size, body, end: offset + size };
      requireBytes(offset, body - offset, box.end, type + ' header');
      let children = containers.has(type) ? body : null;
      if (type === 'uuid') {
        requireBytes(body, 16, box.end, 'UUID');
        box.uuid = Array.from(bytes.subarray(body, body + 16), n => n.toString(16).padStart(2, '0')).join('');
        if (box.uuid === canonUUID) children = body + 16;
        if (box.uuid === previewUUID) {
          requireBytes(body + 16, 8, box.end, 'preview UUID header');
          children = body + 24;
        }
      }
      if (children !== null) box.children = walk(children, box.end, depth + 1);
      result.push(box);
      offset = box.end;
    }
    return result;
  }
  return walk(0, bytes.length, 0);
}

function child(box, type) {
  const found = box?.children?.find(b => b.type === type);
  if (!found) throw new Error(`CR3: missing ${type} box in ${box?.type || 'container'}`);
  return found;
}

function readTrack(box, bytes, view, media) {
  const header = child(box, 'tkhd');
  requireBytes(header.body, 1, header.end, 'tkhd version');
  if (bytes[header.body] > 1) throw new Error('CR3: unsupported tkhd version');
  const idAt = header.body + (bytes[header.body] === 1 ? 20 : 12);
  requireBytes(idAt, 4, header.end, 'track ID');
  const id = view.getUint32(idAt);
  const table = child(child(child(box, 'mdia'), 'minf'), 'stbl');
  const desc = child(table, 'stsd'), sizes = child(table, 'stsz');
  const chunks = table.children.find(b => b.type === 'co64') || child(table, 'stco');
  const wide = chunks.type === 'co64';
  requireBytes(desc.body, 16, desc.end, 'stsd entry');
  const entrySize = view.getUint32(desc.body + 8);
  if (view.getUint32(desc.body + 4) !== 1 || entrySize < 8) throw new Error('CR3: invalid sample description');
  requireBytes(desc.body + 8, entrySize, desc.end, 'sample description');
  const codec = ascii(bytes.subarray(desc.body + 12, desc.body + 16));
  requireBytes(sizes.body, 12, sizes.end, 'stsz table');
  requireBytes(chunks.body, 8, chunks.end, 'chunk table');
  if (view.getUint32(sizes.body + 8) !== 1 || view.getUint32(chunks.body + 4) !== 1) {
    throw new Error(`CR3: unsupported multi-sample or multi-chunk track ${id}`);
  }
  const mapping = child(table, 'stsc');
  requireBytes(mapping.body, 20, mapping.end, 'stsc table');
  // One entry mapping chunk 1 to one sample using the sole description.
  for (const field of [4, 8, 12, 16]) {
    if (view.getUint32(mapping.body + field) !== 1) throw new Error(`CR3: invalid sample-to-chunk mapping for track ${id}`);
  }
  requireBytes(chunks.body + 8, wide ? 8 : 4, chunks.end, 'chunk offset');
  const offset = wide ? Number(view.getBigUint64(chunks.body + 8)) : view.getUint32(chunks.body + 8);
  let length = view.getUint32(sizes.body + 4);
  if (!length) {
    requireBytes(sizes.body + 12, 4, sizes.end, 'sample size');
    length = view.getUint32(sizes.body + 12);
  }
  if (!length || !media.some(m => offset >= m.body && length <= m.end - offset)) {
    throw new Error(`CR3: track ${id} sample outside mdat`);
  }
  return { id, codec, offset, length };
}

function timedMakerNotes(track, bytes, view) {
  const tags = {};
  const end = track.offset + track.length;
  for (let p = track.offset; p < end;) {
    requireBytes(p, 12, end, 'CTMD record header');
    const size = view.getUint32(p, true), type = view.getUint16(p + 4, true);
    requireBytes(p, size, end, 'CTMD record');
    if (size < 12) throw new Error('CR3: invalid CTMD record size');
    if (type === 7 || type === 8) {
      for (let q = p + 12; q < p + size;) {
        requireBytes(q, 8, p + size, 'CTMD block header');
        const length = view.getUint32(q, true), tag = view.getUint32(q + 4, true);
        requireBytes(q, length, p + size, 'CTMD block');
        if (length < 8) throw new Error('CR3: invalid CTMD block size');
        if (tag === 0x927c) {
          const tiff = readTIFF(bytes.subarray(q + 8, q + length), { singleDirectory: true });
          const id = type === 7 ? 0x4016 : 0x4001;
          const value = tiff.ifds[0]?.tags[id];
          if (value != null) tags[id] = value;
        }
        q += length;
      }
    }
    p += size;
  }
  return tags;
}

// ExifTool Canon.pm ColorData9–12. Each pair starts the as-shot and daylight
// groups respectively. The five named presets each store RGGB + temperature.
const layouts = new Map([
  ...[16, 17, 18, 19].map(v => [v, [71, 136]]),
  ...[32, 33].map(v => [v, [85, 150]]),
  ...[34, 48].map(v => [v, [105, 205]]),
  [64, [105, 110]]
]);

function whiteBalance(data) {
  const version = data?.[0], layout = layouts.get(version);
  function group(i) {
    const rawLevels = data.slice(i, i + 4), kelvin = data[i + 4];
    if (rawLevels.length !== 4 || !rawLevels.every(n => n > 0 && n < 32768) || !(kelvin >= 1500 && kelvin <= 50000)) return null;
    const green = (rawLevels[1] + rawLevels[2]) / 2;
    return { kelvin, rawLevels, levels: [rawLevels[0] / green, 1, rawLevels[3] / green] };
  }
  const shot = layout && group(layout[0]);
  if (!shot) {
    const reason = version == null ? 'Missing Canon ColorData' : layout ? 'Invalid Canon as-shot levels or temperature' : `unknown ColorData version ${version}`;
    return { source: 'estimated', estimated: true, version, kelvin: 5500, levels: null, tint: 0, method: 'Daylight estimate', reason };
  }
  // Anchor the relative adjustment to the recorded shot (including any WB
  // shift). An unchanged temperature must preserve the baked camera JPEG.
  const points = new Map();
  for (let p = layout[1]; p < layout[1] + 25; p += 5) {
    const preset = group(p);
    if (preset) points.set(preset.kelvin, preset);
  }
  points.set(shot.kelvin, shot);
  return { ...shot, source: 'Canon ColorData', estimated: false, version, order: 'RGGB',
    tint: 0, method: `Canon ColorData v${version} as-shot`, calibrations: [...points.values()] };
}

export function parseCR3(input) {
  const bytes = bytesOf(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = boxTree(bytes, view), ftyp = boxes.find(b => b.type === 'ftyp');
  if (!ftyp || ftyp.end - ftyp.body < 8 || ascii(bytes.subarray(ftyp.body, ftyp.body + 4)) !== 'crx ') {
    throw new Error('CR3: missing crx file type');
  }
  const movie = boxes.find(b => b.type === 'moov');
  const canon = movie?.children.find(b => b.uuid === canonUUID);
  if (!canon) throw new Error('CR3: missing Canon metadata box');
  const media = boxes.filter(b => b.type === 'mdat');
  const tracks = movie.children.filter(b => b.type === 'trak').map(b => readTrack(b, bytes, view, media));
  const first = tracks.find(t => t.id === 1);
  if (!first) throw new Error('CR3: missing track 1 JPEG');
  function jpeg(offset, length, source) {
    const image = bytes.subarray(offset, offset + length);
    const dims = jpegSize(image);
    if (image[0] !== 255 || image[1] !== 216 || !dims.width || !dims.height) throw new Error(`CR3: invalid ${source} JPEG`);
    if ((image.at(-2) !== 255 || image.at(-1) !== 217) && !jpegEnd(image, 0)) throw new Error(`CR3: truncated ${source} JPEG`);
    return { offset, length, source, ...dims };
  }
  const chosen = jpeg(first.offset, first.length, 'Track 1'), previews = [chosen];
  const previewBox = boxes.find(b => b.uuid === previewUUID)?.children.find(b => b.type === 'PRVW');
  for (const box of [previewBox, canon.children.find(b => b.type === 'THMB')].filter(Boolean)) {
    const p = box.body, isThumb = box.type === 'THMB';
    requireBytes(p, 16, box.end, box.type + ' header');
    const length = view.getUint32(p + (isThumb ? 8 : 12));
    requireBytes(p + 16, length, box.end, box.type + ' JPEG');
    const preview = jpeg(p + 16, length, box.type);
    const dims = p + (isThumb ? 4 : 6);
    if (preview.width !== view.getUint16(dims) || preview.height !== view.getUint16(dims + 2)) {
      throw new Error(`CR3: ${box.type} dimensions disagree with JPEG`);
    }
    previews.push(preview);
  }
  const metadata = {};
  for (const box of canon.children.filter(b => /^CMT[1-4]$/.test(b.type))) {
    metadata[box.type] = readTIFF(bytes.subarray(box.body, box.end)).ifds[0]?.tags;
  }
  const primary = metadata.CMT1, exif = metadata.CMT2 || {};
  if (!primary) throw new Error('CR3: missing CMT1 directory');
  const notes = metadata.CMT3 || {}, ctmd = tracks.find(t => t.codec === 'CTMD');
  const timed = ctmd ? timedMakerNotes(ctmd, bytes, view) : {};
  const flags = timed[0x4016] ?? notes[0x4016];
  const flag = i => flags?.[i] === 1 ? 'On' : flags?.[i] === 0 ? 'Off' : 'Unknown';
  const stringTag = value => value ? ascii(Uint8Array.from(value)) : '';
  return {
    format: 'CR3', boxes, tracks, previews, chosen, orientation: primary[274] || 1,
    camera: { Make: stringTag(primary[271]), Model: stringTag(primary[272]),
      FocalLength: exif[37386], FNumber: exif[33437], ExposureTime: exif[33434], ISOSpeedRatings: exif[34855] },
    lens: stringTag(exif[42036] || notes[0x95]),
    capturedAt: stringTag(exif[36867]).replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') || null,
    whiteBalance: whiteBalance(timed[0x4001] ?? notes[0x4001]),
    lensCorrections: { PeripheralLighting: flag(5), ChromaticAberration: flag(6), DistortionCorrection: flag(7), DigitalLensOptimizer: flag(9) },
    jpeg: bytes.subarray(first.offset, first.offset + first.length)
  };
}
