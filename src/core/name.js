// A name's Ember code: 8 characters derived from the name, so the same name
// always leads to the same Ember and different names to different ones.
// The code reveals nothing about the name (it is a hash, not an encoding).

import { sha256 } from './sha256.js';
import { utf8 } from './prng.js';

// Crockford base32, lowercase: no i, l, o, u, so codes are easy to read aloud.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const CODE_LENGTH = 8; // 40 bits: collisions are negligible for any realistic crowd
export const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

/** Case, accents' encoding and spacing don't change who you are. */
export function normalizeName(name) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function emberCode(name) {
  const n = normalizeName(name);
  if (!n) throw new Error('Enter your name.');
  const digest = sha256(utf8(`ember/name/v1/${n}`));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CODE_LENGTH) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}
