// Unit tests for the FEEL runtime helpers. Run via `npm test`.
// Each test pins a small piece of FEEL semantics so future runtime tweaks
// can't silently regress behaviour the TCK already validates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feel } from './runtime.js';

// ---- Null propagation & three-valued logic --------------------------------

test('and: null propagates only when neither operand is false', () => {
  assert.equal(feel.and(true, true), true);
  assert.equal(feel.and(true, false), false);
  assert.equal(feel.and(null, false), false);
  assert.equal(feel.and(null, true), null);
  assert.equal(feel.and(null, null), null);
});

test('or: null propagates only when neither operand is true', () => {
  assert.equal(feel.or(false, false), false);
  assert.equal(feel.or(true, false), true);
  assert.equal(feel.or(null, true), true);
  assert.equal(feel.or(null, false), null);
  assert.equal(feel.or(null, null), null);
});

test('not: only defined on booleans', () => {
  assert.equal(feel.not(true), false);
  assert.equal(feel.not(false), true);
  assert.equal(feel.not(null), null);
  assert.equal(feel.not(0), null);
  assert.equal(feel.not('foo'), null);
});

// ---- Arithmetic -----------------------------------------------------------

test('add: numbers, string concat, null propagation', () => {
  assert.equal(feel.add(2, 3), 5);
  assert.equal(feel.add('a', 'b'), 'ab');
  assert.equal(feel.add('a', 1), 'a1');
  assert.equal(feel.add(1, null), null);
});

test('div: by zero returns null, not Infinity', () => {
  assert.equal(feel.div(1, 0), null);
  assert.equal(feel.div(10, 2), 5);
  assert.equal(feel.div(null, 1), null);
});

test('pow: non-finite results become null', () => {
  assert.equal(feel.pow(2, 10), 1024);
  assert.equal(feel.pow(10, 1000), null);
});

test('eq: numeric tolerance, deep object/array, cross-type → null', () => {
  assert.equal(feel.eq(0.1 + 0.2, 0.3), true);
  assert.equal(feel.eq(1, '1'), null); // cross-type → null
  assert.equal(feel.eq(true, 1), null); // boolean vs number → null
  assert.equal(feel.eq([1, 2], [1, 2]), true);
  assert.equal(feel.eq({ a: 1 }, { a: 1 }), true);
  assert.equal(feel.eq({ a: 1 }, { a: 1, b: 2 }), false);
});

test('comparisons reject non-numeric, allow string ordering', () => {
  assert.equal(feel.lt(1, 2), true);
  assert.equal(feel.lt('a', 'b'), true);
  assert.equal(feel.lt(null, 1), null);
});

// ---- Singleton-list unwrap ------------------------------------------------

test('singleton: unwraps list-of-1', () => {
  assert.equal(feel.singleton(['x']), 'x');
  assert.deepEqual(feel.singleton(['x', 'y']), ['x', 'y']);
  assert.equal(feel.singleton(42), 42);
});

// ---- Numeric builtins -----------------------------------------------------

test('abs: number; reject other primitives', () => {
  assert.equal(feel.abs(-3), 3);
  assert.equal(feel.abs(3), 3);
  assert.equal(feel.abs('foo'), null);
  assert.equal(feel.abs(true), null);
});

test('abs: arity check', () => {
  assert.equal(feel.abs(), null);
  assert.equal(feel.abs(1, 1), null);
});

test('odd / even', () => {
  assert.equal(feel.even(2), true);
  assert.equal(feel.even(3), false);
  assert.equal(feel.odd(3), true);
  assert.equal(feel.odd('foo'), null);
});

test('decimal: rounds to scale', () => {
  assert.equal(feel.decimal(1 / 3, 2), 0.33);
  assert.equal(feel.decimal(2.555, 2), 2.56);
});

// ---- List builtins (also accept ranges via asList) ------------------------

test('count / sum / mean: arrays', () => {
  assert.equal(feel.count([1, 2, 3]), 3);
  assert.equal(feel.sum([1, 2, 3]), 6);
  assert.equal(feel.mean([2, 4, 6]), 4);
});

test('sum / mean accept varargs', () => {
  assert.equal(feel.sum(1, 2, 3), 6);
  assert.equal(feel.mean(1, 2, 3), 2);
});

test('min / max with strings', () => {
  assert.equal(feel.min(['banana', 'apple', 'cherry']), 'apple');
  assert.equal(feel.max(['banana', 'apple', 'cherry']), 'cherry');
});

test('sublist: 1-based, negative wraps', () => {
  assert.deepEqual(feel.sublist([10, 20, 30, 40], 2, 2), [20, 30]);
  assert.deepEqual(feel.sublist([10, 20, 30, 40], -2), [30, 40]);
});

test('list_replace: 1-based and negative position', () => {
  assert.deepEqual(feel.list_replace([1, 2, 3], 2, 99), [1, 99, 3]);
  assert.deepEqual(feel.list_replace([1, 2, 3], -1, 99), [1, 2, 99]);
  assert.equal(feel.list_replace([1, 2, 3], 0, 99), null);
});

// ---- String builtins ------------------------------------------------------

test('substring: 1-based, length optional', () => {
  assert.equal(feel.substring('foobar', 4), 'bar');
  assert.equal(feel.substring('foobar', 4, 2), 'ba');
  assert.equal(feel.substring('foobar', -2, 1), 'a');
});

test('substring before / after: prefix/suffix split', () => {
  assert.equal(feel.substring_before('foo.bar.baz', '.'), 'foo');
  assert.equal(feel.substring_after('foo.bar.baz', '.'), 'bar.baz');
  assert.equal(feel.substring_after('foo', '.'), '');
});

// ---- Date / time / duration ----------------------------------------------

test('date: rejects invalid forms', () => {
  assert.equal(feel.date('2017-01-01'), '2017-01-01');
  assert.equal(feel.date('0000-02-01'), null);
  assert.equal(feel.date('2017-00-01'), null);
  assert.equal(feel.date('2017-13-01'), null);
  assert.equal(feel.date('2017-02-30'), null);
  assert.equal(feel.date('2012-12-25T'), null);
  assert.equal(feel.date('01211-12-31'), null);
});

test('date: extends to year 999999999, rejects 10-digit', () => {
  assert.equal(feel.date('999999999-12-31'), '999999999-12-31');
  assert.equal(feel.date('-999999999-12-31'), '-999999999-12-31');
  assert.equal(feel.date('9999999999-12-25'), null);
});

test('date(y, m, d): nulls propagate', () => {
  assert.equal(feel.date(2017, 1, 1), '2017-01-01');
  assert.equal(feel.date(null, 1, 1), null);
  assert.equal(feel.date(2017, null, 1), null);
});

test('time: extracts from date-and-time, normalizes UTC offset to Z', () => {
  assert.equal(feel.time('10:20:30'), '10:20:30');
  assert.equal(feel.time('2017-08-10T10:20:00'), '10:20:00');
  assert.equal(feel.time('10:00:00+00:00'), '10:00:00Z');
  assert.equal(feel.time('10:00:00-00:00'), '10:00:00Z');
});

test('time(h, m, s, …) null-propagates', () => {
  assert.equal(feel.time(12, null, 0, null), null);
});

test('date_and_time: pure date appends midnight', () => {
  assert.equal(feel.date_and_time('2017-01-01'), '2017-01-01T00:00:00');
});

test('duration: canonical zero (legacy form) and rollover', () => {
  // Note: duration() and dt_format use slightly different canonical zero
  // forms because TCK 1.1 (1120) wants "PT0S" while TCK 1.3+ arithmetic
  // (0100) wants "P0D". duration() preserves the older form here.
  assert.equal(feel.duration('PT0M'), 'PT0S');
  assert.equal(feel.duration('PT0.000S'), 'PT0S');
  assert.equal(feel.duration('PT1000M'), 'PT16H40M');
});

test('years_and_months_duration: day-of-month adjustment', () => {
  assert.equal(
    feel.years_and_months_duration('2017-08-15', '2018-10-15'),
    'P1Y2M',
  );
  assert.equal(
    feel.years_and_months_duration('2017-08-15', '2018-10-14'),
    'P1Y1M',
  );
});

// ---- Range membership -----------------------------------------------------

test('list_contains on range bounds object', () => {
  const r = feel.range(1, 10, false, false);
  assert.equal(feel.list_contains(r, 5), true);
  assert.equal(feel.list_contains(r, 1), true);
  assert.equal(feel.list_contains(r, 10), true);
  assert.equal(feel.list_contains(r, 11), false);
});

test('list_contains on open range', () => {
  const r = feel.range(1, 10, true, true);
  assert.equal(feel.list_contains(r, 1), false);
  assert.equal(feel.list_contains(r, 5), true);
  assert.equal(feel.list_contains(r, 10), false);
});

test('list_contains on null-bounded ranges', () => {
  // (>= 10) — lo=10, hi=null
  const ge = feel.range(10, null, false, true);
  assert.equal(feel.list_contains(ge, 10), true);
  assert.equal(feel.list_contains(ge, 100), true);
  assert.equal(feel.list_contains(ge, 9), false);
});

test('list_contains recurses into nested ranges/lists', () => {
  const nested = [feel.range(1, 5, false, false), feel.range(20, 30, false, false)];
  assert.equal(feel.list_contains(nested, 3), true);
  assert.equal(feel.list_contains(nested, 25), true);
  assert.equal(feel.list_contains(nested, 10), false);
});

// ---- Property access ------------------------------------------------------

test('prop on date string', () => {
  assert.equal(feel.prop('2017-08-10', 'year'), 2017);
  assert.equal(feel.prop('2017-08-10', 'month'), 8);
  assert.equal(feel.prop('2017-08-10', 'day'), 10);
  // 2017-08-10 was a Thursday → weekday=4
  assert.equal(feel.prop('2017-08-10', 'weekday'), 4);
});

test('prop on duration string', () => {
  assert.equal(feel.prop('P1Y2M', 'years'), 1);
  assert.equal(feel.prop('P1Y2M', 'months'), 2);
  assert.equal(feel.prop('PT3H', 'hours'), 3);
  assert.equal(feel.prop('-P1D', 'days'), -1);
});

test('prop on range bounds', () => {
  const r = feel.range(1, 10, true, false);
  assert.equal(feel.prop(r, 'start'), 1);
  assert.equal(feel.prop(r, 'end'), 10);
  assert.equal(feel.prop(r, 'start included'), false);
  assert.equal(feel.prop(r, 'end included'), true);
});

// ---- is(a, b) -------------------------------------------------------------

test('is: strict same-type same-value', () => {
  assert.equal(feel.is_fn(1, 1), true);
  assert.equal(feel.is_fn(1, '1'), false);
  assert.equal(feel.is_fn('foo', 'foo'), true);
  assert.equal(feel.is_fn(null, null), true);
});
