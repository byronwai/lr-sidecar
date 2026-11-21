import {
  readTIFF,
  bytesOf,
  array
} from './tiff.js';
import { readSonyWhiteBalance } from './wb.js';
export function jpegEnd(bytes, start) {
  let p = start + 2;
  while (p + 1 < bytes.length) {
    if (bytes[p++] !== 255) continue;
    let marker = bytes[p++];
    while (marker === 255 && p < bytes.length) marker = bytes[p++];
    if (marker === 0xd9) return p;
    if (marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (p + 2 > bytes.length) break;
    const length = bytes[p] * 256 + bytes[p + 1];
    if (length < 2 || p + length > bytes.length) break;
    p += length; // Skip APP segments, including complete nested EXIF thumbnails.
  }
  return null;
}
export function jpegSize(bytes) {
  let p = 2;
  while (p + 8 < bytes.length) {
    if (bytes[p++] !== 255) continue;
    let m = bytes[p++];
    while (m === 255) m = bytes[p++];
    if (m === 0xda || m === 0xd9) break;
    if (m === 0xd8 || m === 1 || (m >= 0xd0 && m <= 0xd7)) continue;
    const n = bytes[p] * 256 + bytes[p + 1];
    if (n < 2) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(m))
    return {
      width: bytes[p + 5] * 256 + bytes[p + 6],
      height: bytes[p + 3] * 256 + bytes[p + 4]
    };
    p += n;
  }
  return {
    width: 0,
    height: 0
  };
}
export function parseARW(input) {
  const bytes = bytesOf(input),
  tiff = readTIFF(bytes),
  previews = [];
  function add(offset, length, source) {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 4 || offset + length > bytes.length) return;
    if (bytes[offset] !== 255 || bytes[offset + 1] !== 216) return;
    if (previews.some(x => x.offset === offset)) return;
    const dims = jpegSize(bytes.subarray(offset, offset + length));
    if (dims.width) previews.push({
      offset,
      length,
      source,
      ...dims
    });
  }
  for (const ifd of tiff.ifds) {
    if (ifd.name.includes('SubIFD')) continue;
    // Sony sensor strips also start with JPEG-like markers.
    const t = ifd.tags;
    add(t[513], t[514], ifd.name);
    array(t[273]).forEach((o, i) => add(o, array(t[279])[i], `${ifd.name} strip`));
  }
  if (!previews.length) {
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 255 && bytes[i + 1] === 216) {
        const end = jpegEnd(bytes, i);
        if (end) add(i, end - i, 'SOI/EOI recovery scan');
      }
    }
  }
  previews.sort((a,b) => b.width*b.height-a.width*a.height || b.length-a.length);
  if (!previews.length) throw new Error('No embedded JPEG found in ARW');
  const chosen = previews[0],
  sensor = tiff.ifds.filter(x => x.name.includes('SubIFD')).map(x => ({
    name:x.name,
    width:x.tags[256],
    height:x.tags[257],
    bytes:array(x.tags[279]).reduce((a,b)=>a+b,0)
  }));
  const dateTag = tiff.ifds.find(ifd => ifd.tags[36867])?.tags[36867];
  const capturedAt = dateTag ? String.fromCharCode(...array(dateTag).slice(0, 19))
    .replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : null;
  return {
    format: 'ARW',
    capturedAt,
    byteOrder:tiff.byteOrder,
    ifds:tiff.ifds,
    previews,
    chosen,
    sensor,
    orientation:tiff.ifds[0].tags[274] || 1,
    whiteBalance: readSonyWhiteBalance(bytes, tiff),
    jpeg:bytes.slice(chosen.offset,chosen.offset+chosen.length)
  };
}
