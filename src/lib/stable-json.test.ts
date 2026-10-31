import { describe, expect, it } from 'vitest';
import { sameJson, stableStringify } from './stable-json';

describe('stable JSON comparison', () => {
  it('ignores key order at every depth', () => {
    expect(sameJson({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }, { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 })).toBe(true);
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('still detects real differences, including array order', () => {
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined, c: 0 })).toBe(false);
  });
});
