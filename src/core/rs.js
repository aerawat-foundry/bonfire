// Reed-Solomon over GF(256), primitive polynomial 0x11d, generator roots
// alpha^0..alpha^(nsym-1) (same convention as QR codes and Python's reedsolo).
// Codewords are message || parity. Decoding corrects errors and erasures
// (2*errors + erasures <= nsym).

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => {
  if (!b) throw new Error('division by zero');
  return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0;
};
const pow = (a, n) => EXP[(LOG[a] * n) % 255];
const inv = (a) => EXP[255 - LOG[a]];

// Polynomials are arrays, highest degree first.
const polyScale = (p, x) => p.map((c) => mul(c, x));
function polyAdd(p, q) {
  const r = new Array(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}
function polyMul(p, q) {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j]);
  return r;
}
function polyEval(p, x) {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

function generator(nsym) {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(2, i)]);
  return g;
}

export function rsEncode(msg, nsym) {
  const gen = generator(nsym);
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i];
    if (coef) for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], coef);
  }
  out.set(msg);
  return out;
}

function syndromes(cw, nsym) {
  const s = [];
  for (let i = 0; i < nsym; i++) s.push(polyEval(Array.from(cw), pow(2, i)));
  return s;
}

// Error locator via Berlekamp-Massey, seeded with the erasure locator.
// Polynomials here are lowest degree first.
function findLocator(synd, nsym, eraseLoc, eraseCount) {
  let errLoc = eraseLoc ? eraseLoc.slice() : [1];
  let oldLoc = errLoc.slice();
  for (let i = 0; i < nsym - eraseCount; i++) {
    const k = i + eraseCount;
    let delta = synd[k];
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - 1 - j], synd[k - j]);
    oldLoc = oldLoc.concat([0]);
    if (delta) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, inv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  if ((errLoc.length - 1) * 2 - eraseCount > nsym) throw new Error('too many errors');
  return errLoc;
}

function erasureLocator(positions, n) {
  let loc = [1];
  for (const p of positions) loc = polyMul(loc, polyAdd([1], [pow(2, n - 1 - p), 0]));
  return loc;
}

function findErrors(errLoc, n) {
  const errs = errLoc.length - 1;
  const pos = [];
  for (let i = 0; i < n; i++) if (polyEval(errLoc, pow(2, i)) === 0) pos.push(n - 1 - i);
  if (pos.length !== errs) throw new Error('could not locate errors');
  return pos;
}

function correct(cw, synd, positions) {
  const n = cw.length;
  const coefPos = positions.map((p) => n - 1 - p);
  const loc = erasureLocator(positions, n);
  const sRev = synd.slice().reverse().concat([0]);
  // Error evaluator: (x*S(x) * Lambda(x)) mod x^len(Lambda), highest degree first.
  const prod = polyMul(sRev, loc);
  const omega = prod.slice(prod.length - loc.length);
  const X = coefPos.map((c) => pow(2, c));
  const out = Uint8Array.from(cw);
  X.forEach((Xi, i) => {
    const XiInv = inv(Xi);
    let denom = 1;
    X.forEach((Xj, j) => {
      if (j !== i) denom = mul(denom, 1 ^ mul(XiInv, Xj));
    });
    const y = mul(Xi, polyEval(omega, XiInv));
    out[positions[i]] ^= div(y, denom);
  });
  return out;
}

/** Returns { message, corrected } or throws. */
export function rsDecode(codeword, nsym, erasures = []) {
  if (erasures.length > nsym) throw new Error('too many erasures');
  const cw = Uint8Array.from(codeword);
  for (const p of erasures) cw[p] = 0;
  let synd = syndromes(cw, nsym);
  if (synd.every((v) => v === 0)) {
    return { message: cw.slice(0, cw.length - nsym), corrected: 0 };
  }
  const n = cw.length;
  // Forney syndromes remove the erasures' contribution before BM.
  const fsynd = synd.slice();
  for (const p of erasures) {
    const x = pow(2, n - 1 - p);
    for (let j = 0; j < fsynd.length - 1; j++) fsynd[j] = mul(fsynd[j], x) ^ fsynd[j + 1];
  }
  fsynd.length = nsym - erasures.length;
  const errLoc = findLocator(fsynd, nsym - erasures.length, null, 0);
  const errPos = findErrors(errLoc.slice().reverse(), n);
  const all = [...new Set([...erasures, ...errPos])];
  const fixed = correct(cw, synd, all);
  synd = syndromes(fixed, nsym);
  if (synd.some((v) => v !== 0)) throw new Error('could not correct message');
  let changed = 0;
  for (let i = 0; i < n; i++) if (fixed[i] !== codeword[i]) changed++;
  return { message: fixed.slice(0, n - nsym), corrected: changed };
}
