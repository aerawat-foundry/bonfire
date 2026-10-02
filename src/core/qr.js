// Standard QR layer: build the matrix and know which modules are function patterns.

import qrcode from 'qrcode-generator';

// Encode text as UTF-8 (the library's default truncates to Latin-1).
qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

// Alignment pattern centre coordinates per QR version (ISO/IEC 18004, Annex E).
const ALIGN = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
  [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

/**
 * Standard QR for `text` at error correction H (30%), because the fire
 * recolours and overlaps the code. matrix[y][x] is true for a dark module.
 */
export function makeQr(text) {
  const qr = qrcode(0, 'H');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const matrix = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push(qr.isDark(y, x));
    matrix.push(row);
  }
  return { version: (n - 17) / 4, size: n, matrix };
}

/**
 * Set of "x,y" keys for function-pattern modules (finders, separators,
 * timing, alignment, format and version info). Hotpoints never land on
 * these, so the parts a scanner locks onto stay plain dark.
 */
export function functionMask(version) {
  const n = 17 + 4 * version;
  const f = new Set();
  const box = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(n, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(n, x1); x++) f.add(`${x},${y}`);
  };
  box(0, 0, 9, 9);
  box(n - 8, 0, n, 9);
  box(0, n - 8, 9, n);
  box(6, 0, 7, n);
  box(0, 6, n, 7);
  const c = ALIGN[version];
  const last = c[c.length - 1];
  for (const cy of c)
    for (const cx of c) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
      box(cx - 2, cy - 2, cx + 3, cy + 3);
    }
  if (version >= 7) {
    box(n - 11, 0, n - 8, 6);
    box(0, n - 11, 6, n - 8);
  }
  return f;
}

export function alignmentCenters(version) {
  return ALIGN[version];
}
