// Unit tests for the emitter helpers. We pin the *shape* of the JS we
// generate — actually executing it is the job of the TCK runner, but the
// patterns here are easy to break (regexes, switch arms) and worth
// guarding directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateUnaryTest } from './dmn-emit.js';

// Convenience: compile a unary test against the placeholder `__in0`.
const t = (text: string, names: string[] = []) =>
  translateUnaryTest(text, '__in0', names);

test('translateUnaryTest: empty / dash matches anything', () => {
  // Decision-table cells use `-` to mean "any" — they unconditionally match.
  assert.equal(t(''), 'true');
  assert.equal(t('-'), 'true');
});

test('translateUnaryTest: equality with a literal', () => {
  assert.equal(t('"foo"'), 'feel.eq(__in0, "foo")');
  assert.equal(t('42'), 'feel.eq(__in0, 42)');
});

test('translateUnaryTest: comparison operators route through feel.<op>', () => {
  assert.equal(t('< 10'), 'feel.lt(__in0, 10)');
  assert.equal(t('<= 10'), 'feel.le(__in0, 10)');
  assert.equal(t('> 10'), 'feel.gt(__in0, 10)');
  assert.equal(t('>= 10'), 'feel.ge(__in0, 10)');
  assert.equal(t('= 10'), 'feel.eq(__in0, 10)');
});

test('translateUnaryTest: closed range `[a..b]` → ge / le', () => {
  assert.equal(
    t('[1..10]'),
    '(feel.ge(__in0, 1) && feel.le(__in0, 10))',
  );
});

test('translateUnaryTest: open / half-open range openness', () => {
  assert.equal(
    t('(1..10)'),
    '(feel.gt(__in0, 1) && feel.lt(__in0, 10))',
  );
  assert.equal(
    t('[1..10)'),
    '(feel.ge(__in0, 1) && feel.lt(__in0, 10))',
  );
  assert.equal(
    t('(1..10]'),
    '(feel.gt(__in0, 1) && feel.le(__in0, 10))',
  );
});

test('translateUnaryTest: not(...) negates the inner test', () => {
  assert.equal(t('not("foo")'), '!(feel.eq(__in0, "foo"))');
});

test('translateUnaryTest: comma-separated alternatives become OR', () => {
  // `"a", "b"` matches if input equals either — emitted as `(eq || eq)`.
  assert.equal(
    t('"a", "b"'),
    '(feel.eq(__in0, "a") || feel.eq(__in0, "b"))',
  );
});

test('translateUnaryTest: combines comparisons and ranges in one cell', () => {
  // Plausible decision-table cell: `< 5, [10..20]`.
  assert.equal(
    t('< 5, [10..20]'),
    '(feel.lt(__in0, 5) || (feel.ge(__in0, 10) && feel.le(__in0, 20)))',
  );
});
