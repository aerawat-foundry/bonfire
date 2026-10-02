// Projective transform from four point correspondences.

/**
 * Solve for H (3x3, h33 = 1) mapping src[i] -> dst[i]; points are {x, y}.
 * Exact for four points, least squares for more.
 */
export function homography(src, dst) {
  const rows = [];
  const rhs = [];
  for (let i = 0; i < src.length; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  // Normal equations (A^T A) h = A^T b.
  const A = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const b = Array.from({ length: 8 }, (_, i) => rows.reduce((s, r, k) => s + r[i] * rhs[k], 0));
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('degenerate points');
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function apply(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/** H composed with an affine pre-transform on the source plane. */
export function preAffine(H, [a, b, c, d, e, f]) {
  // source (x, y) -> (a x + b y + c, d x + e y + f) -> H
  return [
    H[0] * a + H[1] * d, H[0] * b + H[1] * e, H[0] * c + H[1] * f + H[2],
    H[3] * a + H[4] * d, H[3] * b + H[4] * e, H[3] * c + H[4] * f + H[5],
    H[6] * a + H[7] * d, H[6] * b + H[7] * e, H[6] * c + H[7] * f + H[8],
  ];
}
