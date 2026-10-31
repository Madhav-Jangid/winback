/**
 * JSON comparison that ignores key order. Postgres JSONB re-orders object keys (by length, then
 * alphabetically), so comparing `JSON.stringify` output of a stored object with a freshly parsed
 * one reports differences that are not there.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortKeys(source[key])]));
  }
  return value;
}

export const stableStringify = (value: unknown): string => JSON.stringify(sortKeys(value));

export const sameJson = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
