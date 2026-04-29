// Unit tests for the DMN parser helpers. The full `parseDmn` is exercised
// by the TCK runner; these tests target the small, easily-broken pieces:
// the comma splitter (used for allowedValues / outputValues lists) and
// the version detector.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDmnVersion, splitTopLevelCommas } from './dmn-parse.js';

// ---- splitTopLevelCommas -------------------------------------------------

test('splitTopLevelCommas: simple comma-separated values', () => {
  assert.deepEqual(splitTopLevelCommas('"foo","bar","baz"'), [
    '"foo"',
    '"bar"',
    '"baz"',
  ]);
});

test('splitTopLevelCommas: ignores commas inside parens and brackets', () => {
  assert.deepEqual(splitTopLevelCommas('f(a, b), g(c, d)'), [
    'f(a, b)',
    'g(c, d)',
  ]);
  assert.deepEqual(splitTopLevelCommas('[1, 2], [3, 4]'), ['[1, 2]', '[3, 4]']);
});

test('splitTopLevelCommas: ignores commas inside string literals', () => {
  // Quoted strings are atomic — embedded commas don't split.
  assert.deepEqual(splitTopLevelCommas('"a, b", "c, d"'), ['"a, b"', '"c, d"']);
});

test('splitTopLevelCommas: backslash-escapes inside strings', () => {
  // The escape consumes the next char even if it's a quote, so the
  // closing `"` is preserved as the actual delimiter.
  assert.deepEqual(splitTopLevelCommas('"a\\"b", "c"'), ['"a\\"b"', '"c"']);
});

test('splitTopLevelCommas: range expressions stay intact', () => {
  // The emitter feeds these back to `translateUnaryTest`, so we must NOT
  // shred `[1..3]` at the comma in `[low,high]` (there is none — but the
  // parens guard against future range forms).
  assert.deepEqual(splitTopLevelCommas('[1..3], (5..10]'), ['[1..3]', '(5..10]']);
});

test('splitTopLevelCommas: empty / whitespace-only input', () => {
  assert.deepEqual(splitTopLevelCommas(''), []);
  assert.deepEqual(splitTopLevelCommas('  '), []);
  // Empty fields are dropped.
  assert.deepEqual(splitTopLevelCommas('a,,b'), ['a', 'b']);
});

test('splitTopLevelCommas: trims surrounding whitespace per-part', () => {
  assert.deepEqual(splitTopLevelCommas('  a , b  ,c'), ['a', 'b', 'c']);
});

// ---- detectDmnVersion ----------------------------------------------------

test('detectDmnVersion: maps each spec namespace to its version label', () => {
  const tag = (ns: string) => `<definitions xmlns="${ns}"/>`;
  assert.equal(
    detectDmnVersion(tag('http://www.omg.org/spec/DMN/20151101/dmn.xsd')),
    '1.1',
  );
  assert.equal(
    detectDmnVersion(tag('http://www.omg.org/spec/DMN/20180521/MODEL/')),
    '1.2',
  );
  assert.equal(
    detectDmnVersion(tag('https://www.omg.org/spec/DMN/20191111/MODEL/')),
    '1.3',
  );
  assert.equal(
    detectDmnVersion(tag('https://www.omg.org/spec/DMN/20211108/MODEL/')),
    '1.4',
  );
  assert.equal(
    detectDmnVersion(tag('https://www.omg.org/spec/DMN/20240513/MODEL/')),
    '1.5',
  );
});

test('detectDmnVersion: returns "unknown" when no DMN namespace present', () => {
  assert.equal(detectDmnVersion('<root/>'), 'unknown');
  assert.equal(
    detectDmnVersion('<definitions xmlns="http://example.com/other"/>'),
    'unknown',
  );
});

test('detectDmnVersion: tolerates xmlns on a prefixed attribute', () => {
  // jdmn often emits the DMN namespace via a prefix like `xmlns:dmn=...`.
  // The regex matches `xmlns(:prefix)?` so this still resolves.
  assert.equal(
    detectDmnVersion(
      '<root xmlns:dmn="https://www.omg.org/spec/DMN/20191111/MODEL/"/>',
    ),
    '1.3',
  );
});
