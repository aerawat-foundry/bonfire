// Deterministic, language-neutral pseudo-random stream.
//
// Everything that is part of the Ember convention (ember layout, bit order,
// whitening, hotpoint selection) draws from this stream instead of
// Math.random, so any decoder reproduces the same choices:
// block i of the stream is SHA-256(seed || uint32_be(i)).

import { sha256 } from './sha256.js';

export const utf8 = (s) => new TextEncoder().encode(s);

export class Stream {
  constructor(seed) {
    this.seed = typeof seed === 'string' ? utf8(seed) : Uint8Array.from(seed);
    this.counter = 0;
    this.buf = [];
  }

  bytes(n) {
    while (this.buf.length < n) {
      const input = new Uint8Array(this.seed.length + 4);
      input.set(this.seed);
      new DataView(input.buffer).setUint32(this.seed.length, this.counter++);
      this.buf.push(...sha256(input));
    }
    return Uint8Array.from(this.buf.splice(0, n));
  }

  uint32() {
    const b = this.bytes(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }

  /** Float in [0, 1). */
  random() {
    return this.uint32() / 4294967296;
  }

  /** Integer in [0, n). */
  below(n) {
    return this.uint32() % n;
  }

  uniform(lo, hi) {
    return lo + (hi - lo) * this.random();
  }

  pick(items) {
    return items[this.below(items.length)];
  }

  /** Fisher-Yates, in place, from the end. */
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
