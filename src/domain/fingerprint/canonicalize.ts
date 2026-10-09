/**
 * A canonical text for a piece of data, so the same decision input always
 * hashes the same (engine v2, 01 §4).
 *
 * Rules: object keys in code-point order; arrays keep their order, because
 * their order means something; a `Set` has no order of its own and is written
 * sorted; absence is written as an explicit `null`, never skipped; numbers
 * must be finite and `-0` is `0`. Anything that has no stable text — an
 * `undefined`, a function, a `NaN`, a `Date`, a class instance — is an error
 * and not a silent `null`: an input that cannot be written down cannot be
 * fingerprinted.
 */

export class CanonicalizationError extends TypeError {}

function fail(path: string, what: string): never {
  throw new CanonicalizationError(`cannot canonicalize ${what} at ${path || '<root>'}`);
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) return fail(path, String(value));
      return Object.is(value, -0) ? '0' : String(value);
    case 'object':
      break;
    default:
      return fail(path, typeof value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, i) => write(item, `${path}[${i}]`)).join(',')}]`;
  }
  if (value instanceof Set) {
    return `{"$set":[${[...value]
      .map((item) => write(item, `${path}{}`))
      .sort(compareCodePoints)
      .join(',')}]}`;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return fail(path, 'a non-plain object');
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    compareCodePoints(a, b),
  );
  // `{"$set":…}` is how a Set is written; a plain object may not pose as one.
  if (entries.some(([k]) => k === '$set')) return fail(path, 'a key named $set');
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, `${path}.${k}`)}`).join(',')}}`;
}

/** Code-point order (what `Array#sort` on strings does, spelled out so it is not a locale's choice). */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalize(value: unknown): string {
  return write(value, '');
}
