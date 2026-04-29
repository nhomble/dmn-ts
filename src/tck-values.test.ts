// Unit tests for the TCK value-coercion helpers. Each test pins a small
// piece of the XML→JS conversion so future tweaks can't silently change
// how test inputs / expected outputs are interpreted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castByXsi, normalizeIsoDuration, smartCoerce } from './tck-values.js';

// ---- smartCoerce ----------------------------------------------------------

test('smartCoerce: literal booleans', () => {
  assert.equal(smartCoerce('true'), true);
  assert.equal(smartCoerce('false'), false);
});

test('smartCoerce: empty string preserved, "null" becomes null', () => {
  assert.equal(smartCoerce(''), '');
  assert.equal(smartCoerce('null'), null);
});

test('smartCoerce: integers and decimals', () => {
  assert.equal(smartCoerce('42'), 42);
  assert.equal(smartCoerce('-7'), -7);
  assert.equal(smartCoerce('3.14'), 3.14);
});

test('smartCoerce: leading-dot decimals like .041', () => {
  // Some TCK fixtures elide the leading zero ("rate = .041"); the runner
  // needs to read these as numbers so subsequent FEEL arithmetic works.
  assert.equal(smartCoerce('.041'), 0.041);
  assert.equal(smartCoerce('-.5'), -0.5);
});

test('smartCoerce: scientific notation', () => {
  assert.equal(smartCoerce('1e3'), 1000);
  assert.equal(smartCoerce('1.5E-2'), 0.015);
});

test('smartCoerce: non-numeric strings pass through', () => {
  assert.equal(smartCoerce('hello'), 'hello');
  assert.equal(smartCoerce('1abc'), '1abc');
  // Date / time / duration shapes are kept as strings — the FEEL runtime
  // recognises them by pattern, not by JS type.
  assert.equal(smartCoerce('2021-01-02'), '2021-01-02');
  assert.equal(smartCoerce('PT1H'), 'PT1H');
});

// ---- castByXsi -----------------------------------------------------------

test('castByXsi: numeric xsi types funnel through Number', () => {
  assert.equal(castByXsi('42', 'xsd:decimal'), 42);
  assert.equal(castByXsi('3.14', 'xs:double'), 3.14);
  assert.equal(castByXsi('-1', 'xsd:integer'), -1);
  assert.equal(castByXsi('1e3', 'xsd:float'), 1000);
});

test('castByXsi: boolean type only accepts the literal "true"', () => {
  assert.equal(castByXsi('true', 'xsd:boolean'), true);
  assert.equal(castByXsi('false', 'xsd:boolean'), false);
  // Anything that isn't exactly "true" is treated as false.
  assert.equal(castByXsi('TRUE', 'xsd:boolean'), false);
});

test('castByXsi: tolerates either xsd: or xs: prefix (or none)', () => {
  assert.equal(castByXsi('5', 'xsd:integer'), 5);
  assert.equal(castByXsi('5', 'xs:integer'), 5);
  assert.equal(castByXsi('5', 'integer'), 5);
});

test('castByXsi: string and unknown types pass through verbatim', () => {
  assert.equal(castByXsi('foo', 'xsd:string'), 'foo');
  assert.equal(castByXsi('P1Y', 'xsd:duration'), 'P1Y');
  // Unrecognised type → pass through (don't convert).
  assert.equal(castByXsi('hello', 'xsd:weirdType'), 'hello');
});

test('castByXsi: undefined type falls back to smartCoerce', () => {
  assert.equal(castByXsi('true', undefined), true);
  assert.equal(castByXsi('42', undefined), 42);
  assert.equal(castByXsi('hello', undefined), 'hello');
});

// ---- normalizeIsoDuration ------------------------------------------------

test('normalizeIsoDuration: P1Y and P1Y0M reduce to the same key', () => {
  // The whole point: equality in `deepEqual` should treat these as equal.
  assert.equal(normalizeIsoDuration('P1Y'), normalizeIsoDuration('P1Y0M'));
});

test('normalizeIsoDuration: separates sign, ymd, hms', () => {
  assert.equal(normalizeIsoDuration('P1Y2M3D'), '|1|2|3|0|0|0');
  assert.equal(normalizeIsoDuration('PT4H5M6S'), '|0|0|0|4|5|6');
  assert.equal(normalizeIsoDuration('-P1Y'), '-|1|0|0|0|0|0');
});

test('normalizeIsoDuration: fractional seconds preserved', () => {
  assert.equal(normalizeIsoDuration('PT1.5S'), '|0|0|0|0|0|1.5');
});

test('normalizeIsoDuration: rejects empty / non-duration inputs', () => {
  // `P` alone is not a valid duration.
  assert.equal(normalizeIsoDuration('P'), null);
  assert.equal(normalizeIsoDuration(''), null);
  assert.equal(normalizeIsoDuration('hello'), null);
  assert.equal(normalizeIsoDuration('2021-01-01'), null);
});
