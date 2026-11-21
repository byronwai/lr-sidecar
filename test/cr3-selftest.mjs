import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCR3 } from '../public/formats/cr3.js';
import { relativeWhiteBalance } from '../public/formats/wb.js';
import { detectMaskAlignment } from '../public/render/mask-alignment.js';

if (!process.argv[2]) throw new Error('Usage: node test/cr3-selftest.mjs <R50 sample.cr3>');
const bytes = await readFile(process.argv[2]), raw = parseCR3(bytes);
const movie = raw.boxes.find(b => b.type === 'moov');
assert.deepEqual(raw.boxes.map(b => b.type), ['ftyp', 'moov', 'uuid', 'uuid', 'free', 'mdat']);
assert.deepEqual(movie.children[0].children.map(b => b.type),
  ['CNCV', 'CCTP', 'CTBO', 'free', 'CMT1', 'CMT2', 'CMT3', 'CMT4', 'THMB']);
assert.equal(movie.children.filter(b => b.type === 'trak').length, 4);
assert.equal(raw.boxes[3].children[0].type, 'PRVW');
assert.deepEqual(raw.tracks.map(t => [t.id, t.codec]), [[1, 'CRAW'], [2, 'CRAW'], [3, 'CRAW'], [4, 'CTMD']]);
assert.deepEqual(raw.chosen, { source: 'Track 1', offset: 500224, length: 3613893, width: 6000, height: 4000 });
assert.deepEqual(raw.jpeg, bytes.subarray(500224, 500224 + 3613893));
assert.equal(raw.tracks[3].offset, 32969216);
assert.equal(raw.tracks[3].length, 117100);
assert.deepEqual(raw.previews.map(p => [p.source, p.width, p.height]), [
  ['Track 1', 6000, 4000], ['PRVW', 1620, 1080], ['THMB', 160, 120]
]);
assert.ok(raw.previews.every(p => bytes.readUInt16BE(p.offset) === 0xffd8));
assert.equal(raw.orientation, 1);
assert.deepEqual(raw.camera, { Make: 'Canon', Model: 'Canon EOS R50',
  ExposureTime: 1/250, FNumber: 5, FocalLength: 50, ISOSpeedRatings: 100 });
assert.equal(raw.lens, 'RF50mm F1.8 STM');
const wb = raw.whiteBalance;
assert.equal(wb.version, 48);
assert.equal(wb.estimated, false);
assert.equal(wb.method, 'Canon ColorData v48 as-shot');
assert.equal(wb.kelvin, 5200);
assert.deepEqual(wb.rawLevels, [1777, 1024, 1024, 1736]);
assert.deepEqual(wb.levels, [1777/1024, 1, 1736/1024]);
assert.ok(relativeWhiteBalance(wb).gains.every(g => Math.abs(g-1) < 1e-12));
assert.ok(relativeWhiteBalance(wb, { Temperature: 6500 }).gains[0] > 1);
assert.deepEqual(raw.lensCorrections, { PeripheralLighting: 'On', ChromaticAberration: 'On',
  DistortionCorrection: 'Off', DigitalLensOptimizer: 'On' });
assert.equal(detectMaskAlignment(null, {}, null, raw.lensCorrections).apply, false);
assert.deepEqual(detectMaskAlignment(null, {}, null, { DistortionCorrection: 'On' }),
  { apply: false, reason: 'camera corrected, coefficients unknown', off: null, warp: null });

for (const end of [4, movie.end - 1, bytes.length - 1]) {
  assert.throws(() => parseCR3(bytes.subarray(0, end)), /CR3: truncated or invalid/);
}
// Change only the in-memory buffer to exercise invalid child sizes, bad JPEG
// pointers and CTMD lengths without creating a second sample on disk.
const bad = Buffer.from(bytes);
for (const [offset, length, message] of [
  [movie.children[0].offset, 4, /uuid header/],
  [raw.chosen.offset, 2, /invalid Track 1 JPEG/],
  [raw.tracks[3].offset, 4, /invalid CTMD record size/]
]) {
  bad.fill(0, offset, offset + length);
  if (offset === movie.children[0].offset) bad.writeUInt32BE(7, offset);
  assert.throws(() => parseCR3(bad), message);
  bytes.copy(bad, offset, offset, offset + length);
}
// Locate the type-8 MakerNote's ColorData IFD entry relative to its TIFF.
let record = raw.tracks[3].offset;
while (bytes.readUInt16LE(record + 4) !== 8) record += bytes.readUInt32LE(record);
const tiff = record + 20, directory = tiff + bytes.readUInt32LE(tiff + 4);
assert.equal(bytes.readUInt16LE(directory + 2), 0x4001);
const color = tiff + bytes.readUInt32LE(directory + 10);
bad.writeUInt16LE(999, color);
const fallback = parseCR3(bad).whiteBalance;
assert.ok(fallback.estimated);
assert.match(fallback.reason, /unknown ColorData version 999/);

// Exercise the documented older layouts via CMT3. These are synthetic
// directories, not measurements from other cameras.
bad.writeUInt16LE(0xffff, directory + 2); // omit CTMD ColorData
const cmt = movie.children[0].children.find(b => b.type === 'CMT3');
const cmtDir = cmt.body + bad.readUInt32LE(cmt.body + 4);
const entry = Array.from({ length: bad.readUInt16LE(cmtDir) }, (_, i) => cmtDir + 2 + i * 12)
  .find(p => bad.readUInt32LE(p + 4) >= 512 && bad.readUInt16LE(p + 2) === 7);
assert.ok(entry, 'MakerNote has space for the synthetic ColorData');
bad.writeUInt16LE(0x4001, entry);
bad.writeUInt16LE(3, entry + 2);
bad.writeUInt32LE(256, entry + 4);
const at = cmt.body + bad.readUInt32LE(entry + 8);
for (const [version, index] of [[16,71], [17,71], [32,85], [33,85], [34,105], [64,105]]) {
  bad.fill(0, at, at + 512);
  bad.writeUInt16LE(version, at);
  [1600, 1000, 1000, 1800, 4200].forEach((v,i) => bad.writeUInt16LE(v, at + 2*(index+i)));
  const shot = parseCR3(bad).whiteBalance;
  assert.equal(shot.estimated, false);
  assert.equal(shot.kelvin, 4200);
  assert.deepEqual(shot.rawLevels, [1600,1000,1000,1800]);
}
console.log('PASS · Canon R50 boxes, tracks, previews, EXIF, WB, lens flags, fallback and bounds');
