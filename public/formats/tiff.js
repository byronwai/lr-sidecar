// All offsets in an embedded TIFF are relative to that TIFF, never the outer file.
const widths = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
  13: 4
};
export function bytesOf(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}
export function readTIFF(input) {
  const bytes = bytesOf(input),
  view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (offset, length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || length < 0 || offset + length > bytes.length)
    throw new Error(`TIFF out of bounds: ${offset} + ${length} / ${bytes.length}`);
  };
  check(0, 8);
  const order = String.fromCharCode(bytes[0], bytes[1]),
  le = order === 'II';
  if (!['II', 'MM'].includes(order) || view.getUint16(2, le) !== 42) throw new Error('Not a classic TIFF');
  const u16 = o => {
    check(o, 2);
    return view.getUint16(o, le);
  };
  const u32 = o => {
    check(o, 4);
    return view.getUint32(o, le);
  };
  const visited = new Set(),
  ifds = [];
  function walk(offset, name, depth = 0) {
    if (!offset || visited.has(offset)) return;
    if (depth > 16 || ifds.length > 256) throw new Error('TIFF IFD nesting limit');
    visited.add(offset);
    const count = u16(offset);
    check(offset + 2, count * 12 + 4);
    const entries = [],
    tags = {};
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12,
      tag = u16(p),
      type = u16(p + 2),
      n = u32(p + 4);
      if (!widths[type]) {
        entries.push({
          tag,
          type,
          count: n,
          unsupported: true
        });
        continue;
      }
      const size = widths[type] * n,
      at = size <= 4 ? p + 8 : u32(p + 8);
      check(at, size);
      if (n > 4e6) throw new Error('TIFF array too large');
      const values = Array.from({
        length: n
      }, (_, j) => {
        const q = at + j * widths[type];
        if (type === 3) return u16(q);
        if (type === 4 || type === 13) return u32(q);
        if (type === 9) return view.getInt32(q, le);
        if (type === 5 || type === 10) return u32(q) / (u32(q + 4) || 1);
        return bytes[q];
      });
      const value = n === 1 ? values[0] : values;
      entries.push({
        tag,
        type,
        count: n,
        at,
        value
      });
      tags[tag] = value;
    }
    const next = u32(offset + 2 + count * 12),
    ifd = {
      name,
      offset,
      entries,
      tags,
      next
    };
    ifds.push(ifd);
    for (const t of [0x14a, 0x8769, 0x8825]) {
      for (const [i, sub] of array(tags[t]).entries()) walk(sub, `${name}/${t === 0x14a ? 'SubIFD' : 'metadata'}${i}`,
      depth + 1);
    }
    if (next) walk(next, name.replace(/IFD(\d+)$/, (_, n) => `IFD${+n + 1}`), depth);
  }
  walk(u32(4), 'IFD0');
  return {
    byteOrder: order,
    ifds,
    bytes
  };
}
export const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const tagName = tag => ({
  256:'ImageWidth',
  257:'ImageLength',
  258:'BitsPerSample',
  259:'Compression',
  262:'Photometric',
  273:'StripOffsets',
  274:'Orientation',
  277:'SamplesPerPixel',
  279:'StripByteCounts',
  330:'SubIFDs',
  322:'TileWidth',
  323:'TileLength',
  324:'TileOffsets',
  325:'TileByteCounts',
  513:'JPEGOffset',
  514:'JPEGLength'
}[tag] || `0x${tag.toString(16).padStart(4,'0')}`);
