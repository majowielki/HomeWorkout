import { canonicalize } from './canonicalize';
import { sha256Hex } from './sha256';

export { canonicalize, CanonicalizationError, compareCodePoints } from './canonicalize';
export { sha256Hex } from './sha256';

/** The SHA-256 of the canonical text of `value`: the identity of one exact input. */
export function fingerprint(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/**
 * The hash of an object without its own hash field, so a plan can carry the
 * hash of everything else in it (01 §4: "hash planu oblicza się przed
 * dopisaniem własnego pola hasha").
 */
export function fingerprintWithout<T extends Record<string, unknown>>(
  value: T,
  ...omit: (keyof T & string)[]
): string {
  return fingerprint(Object.fromEntries(Object.entries(value).filter(([k]) => !omit.includes(k))));
}
