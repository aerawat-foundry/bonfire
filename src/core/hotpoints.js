// Hotpoints: a few glowing modules inside the QR, placed by the text's hash.
//
// They sit only on dark data modules (never on finder, timing, alignment or
// format modules) and keep a dark rim, so an ordinary scanner still reads
// them as dark. An Ember scanner recomputes where they must be and checks
// for the heat, so a flat black reprint is detectable.

import { Stream, utf8 } from './prng.js';
import { sha256 } from './sha256.js';
import { functionMask } from './qr.js';

const MIN_GAP = 3;

export function selectHotpoints(text, version, matrix) {
  const seed = new Uint8Array([...utf8('ember/v1/hot/'), ...sha256(utf8(text))]);
  const s = new Stream(seed);
  const count = 5 + s.below(4);
  const fn = functionMask(version);
  const n = matrix.length;
  const candidates = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (matrix[y][x] && !fn.has(`${x},${y}`)) candidates.push([x, y]);
  s.shuffle(candidates);
  const chosen = [];
  for (const [x, y] of candidates) {
    if (chosen.every(([a, b]) => Math.max(Math.abs(x - a), Math.abs(y - b)) >= MIN_GAP)) {
      chosen.push([x, y]);
      if (chosen.length === count) break;
    }
  }
  return chosen;
}
