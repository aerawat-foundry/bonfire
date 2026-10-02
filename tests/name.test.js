import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emberCode, normalizeName, CODE_PATTERN } from '../src/core/name.js';

test('a name always gets the same 8-character code', () => {
  const code = emberCode('Asha Rao');
  assert.match(code, CODE_PATTERN);
  assert.equal(emberCode('Asha Rao'), code);
});

test('case and spacing do not change the code', () => {
  const code = emberCode('Asha Rao');
  for (const v of ['asha rao', '  ASHA   rao ', 'Asha\tRao']) assert.equal(emberCode(v), code, v);
});

test('different names get different codes', () => {
  const names = Array.from({ length: 5000 }, (_, i) => `person ${i}`);
  assert.equal(new Set(names.map(emberCode)).size, names.length);
  assert.notEqual(emberCode('Asha'), emberCode('Ashä'));
});

test('codes use only unambiguous characters', () => {
  for (let i = 0; i < 300; i++) assert.doesNotMatch(emberCode(`n${i}`), /[ilou]/);
});

test('unicode names work and an empty name is refused', () => {
  assert.match(emberCode('नमस्ते'), CODE_PATTERN);
  assert.equal(normalizeName('Émile'), normalizeName('Émile'));
  assert.throws(() => emberCode('   '), /name/);
});
