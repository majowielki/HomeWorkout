/**
 * Engine v2, P1.2 (01 §4): the canonical text and the fingerprint of an input.
 */
import { createHash, randomBytes } from 'node:crypto';

import {
  CanonicalizationError,
  canonicalize,
  fingerprint,
  fingerprintWithout,
  sha256Hex,
} from '../fingerprint';
import { utf8Bytes } from '../fingerprint/sha256';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the FIPS test vector for %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('matches the one-million-a vector (many blocks)', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with Node on lengths around the padding boundaries, with Polish text and emoji', () => {
    for (let length = 0; length <= 130; length += 1) {
      const text = 'zażółć gęślą jaźń 💪 '.repeat(8).slice(0, length);
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('agrees with Node on random strings', () => {
    for (let i = 0; i < 200; i += 1) {
      const text = randomBytes(1 + (i % 97)).toString('latin1');
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('utf8Bytes', () => {
  it('encodes one, two, three and four byte characters', () => {
    expect(utf8Bytes('a')).toEqual([0x61]);
    expect(utf8Bytes('ł')).toEqual([0xc5, 0x82]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Bytes('💪')).toEqual([0xf0, 0x9f, 0x92, 0xaa]);
  });

  it('writes a lone surrogate as U+FFFD, like TextEncoder', () => {
    const replacement = [0xef, 0xbf, 0xbd];
    expect(utf8Bytes('\ud83d')).toEqual(replacement); // at the end
    expect(utf8Bytes('\ud83dx')).toEqual([...replacement, 0x78]); // high, then not a low one
    expect(utf8Bytes('\ude00')).toEqual(replacement); // a low one alone
    for (const text of ['\ud83d', '\ud83dx', '\ude00', 'a💪b']) {
      expect(Buffer.from(utf8Bytes(text))).toEqual(Buffer.from(new TextEncoder().encode(text)));
    }
  });
});

describe('canonicalize', () => {
  it('orders object keys and keeps array order', () => {
    expect(canonicalize({ b: 1, a: [3, 2, 1] })).toBe('{"a":[3,2,1],"b":1}');
    expect(canonicalize({ a: [1, 2] })).not.toBe(canonicalize({ a: [2, 1] }));
  });

  it('is the same for any key order, at any depth', () => {
    const one = { x: { b: 1, a: { d: 4, c: 3 } }, y: [{ q: 1, p: 2 }] };
    const two = { y: [{ p: 2, q: 1 }], x: { a: { c: 3, d: 4 }, b: 1 } };
    expect(canonicalize(one)).toBe(canonicalize(two));
  });

  it('writes a Set sorted, so insertion order does not matter', () => {
    expect(canonicalize({ ids: new Set(['b', 'a', 'c']) })).toBe(
      canonicalize({ ids: new Set(['c', 'b', 'a']) }),
    );
    expect(canonicalize(new Set([2, 1]))).toBe('{"$set":[1,2]}');
  });

  it('keeps two distinct but equal members of a Set', () => {
    expect(canonicalize(new Set([{ a: 1 }, { a: 1 }]))).toBe('{"$set":[{"a":1},{"a":1}]}');
  });

  it('writes absence as an explicit null and keeps null distinct from a missing key', () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });

  it('writes numbers, strings and booleans', () => {
    expect(canonicalize([0, -0, 1.5, -2, 1e21, true, false, 'zażółć "x"\n'])).toBe(
      '[0,0,1.5,-2,1e+21,true,false,"zażółć \\"x\\"\\n"]',
    );
  });

  it.each([
    ['undefined', { a: undefined }],
    ['NaN', [NaN]],
    ['Infinity', { x: Infinity }],
    ['a function', { f: () => 1 }],
    ['a Date', { d: new Date(0) }],
    ['a class instance', new (class Thing {})()],
    ['a bigint', { n: 1n }],
    ['a symbol', [Symbol('s')]],
    ['a key named $set posing as a set', { $set: [1] }],
  ])('refuses %s, because it has no stable text', (_, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizationError);
  });

  it('names the path of what it refuses', () => {
    expect(() => canonicalize({ plan: { sets: [1, NaN] } })).toThrow('.plan.sets[1]');
    expect(() => canonicalize(undefined)).toThrow('<root>');
  });

  it('accepts an object without a prototype', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(canonicalize(bare)).toBe('{"a":1}');
  });
});

describe('fingerprint', () => {
  const input = {
    clock: { trainingDate: '2026-10-09', boundaryHour: 4 },
    revisions: { history: 12, catalog: 'c3', inventory: 1, profile: 2, requests: 0, block: 5 },
    sets: [{ id: 's1/r1/e1/1', kg: 4 }],
    excluded: new Set(['band-row', 'v-up']),
  };

  it('is a 64 character lower-case hex string', () => {
    expect(fingerprint(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order or on how a set was built', () => {
    const shuffled = {
      excluded: new Set(['v-up', 'band-row']),
      sets: [{ kg: 4, id: 's1/r1/e1/1' }],
      revisions: { block: 5, requests: 0, profile: 2, inventory: 1, catalog: 'c3', history: 12 },
      clock: { boundaryHour: 4, trainingDate: '2026-10-09' },
    };
    expect(fingerprint(shuffled)).toBe(fingerprint(input));
  });

  it('changes when any single value changes', () => {
    const base = fingerprint(input);
    const variants = [
      { ...input, clock: { ...input.clock, trainingDate: '2026-10-10' } },
      { ...input, clock: { ...input.clock, boundaryHour: 3 } },
      { ...input, revisions: { ...input.revisions, history: 13 } },
      { ...input, revisions: { ...input.revisions, catalog: 'c4' } },
      { ...input, sets: [{ id: 's1/r1/e1/1', kg: 6 }] },
      { ...input, sets: [] },
      { ...input, excluded: new Set(['band-row']) },
    ];
    const hashes = variants.map(fingerprint);
    expect(hashes).not.toContain(base);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('fingerprintWithout hashes everything but the named fields', () => {
    const plan = { sessionId: 's1', sets: [1, 2], planHash: 'whatever' };
    expect(fingerprintWithout(plan, 'planHash')).toBe(
      fingerprint({ sessionId: 's1', sets: [1, 2] }),
    );
    expect(fingerprintWithout({ ...plan, planHash: 'other' }, 'planHash')).toBe(
      fingerprintWithout(plan, 'planHash'),
    );
  });
});
