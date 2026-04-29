// Unit tests for the typeRef helpers. Tiny but surprisingly load-bearing:
// the emitter uses these to decide where to insert `feel.validate` calls,
// so a regression here can silently disable type validation for a whole
// class of decisions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isScalarTypeRef,
  SCALAR_FEEL_TYPES,
  typeRefLocal,
} from './type-utils.js';

test('typeRefLocal: strips an optional namespace prefix', () => {
  assert.equal(typeRefLocal('feel:string'), 'string');
  assert.equal(typeRefLocal('xsd:integer'), 'integer');
  assert.equal(typeRefLocal('kie:tFlight'), 'tFlight');
  // No prefix → unchanged.
  assert.equal(typeRefLocal('tFooBar'), 'tFooBar');
});

test('typeRefLocal: handles `:` only at the boundary', () => {
  // The `pop()`-on-split form keeps just the last segment; this guards
  // against a future change picking the wrong end.
  assert.equal(typeRefLocal('a:b:c'), 'c');
});

test('isScalarTypeRef: recognises every FEEL primitive', () => {
  for (const t of SCALAR_FEEL_TYPES) {
    assert.equal(isScalarTypeRef(t), true, `expected ${t} to be scalar`);
  }
});

test('isScalarTypeRef: ignores a leading namespace', () => {
  assert.equal(isScalarTypeRef('feel:string'), true);
  assert.equal(isScalarTypeRef('xsd:integer'), false); // not a FEEL type
  assert.equal(isScalarTypeRef('feel:date and time'), true);
});

test('isScalarTypeRef: rejects user types and missing typeRefs', () => {
  assert.equal(isScalarTypeRef(undefined), false);
  assert.equal(isScalarTypeRef(''), false);
  assert.equal(isScalarTypeRef('tFooBar'), false);
  assert.equal(isScalarTypeRef('iTreeNode'), false);
});
