/**
 * Resolve a person's words against the active catalogue (P4b.1, T70, 13 §11).
 * The lexicon is an input, so the same data works offline for touch, voice and
 * AI. Recognition is not eligibility: the session audit still judges whether
 * the identified exercise may be performed by this person today.
 */
import { fold } from '../coach/text';
import { compareCodePoints } from '../fingerprint';
import { EXERCISE_RESOLVER_CONFIG } from '../config/training';
import type { Exercise, MuscleGroup } from '../types';

export type ExerciseRef = { id: string } | { query: string };
export interface MovementLexicon {
  version: number;
  stopWords: readonly string[];
  terms: readonly { canonical: string; forms: readonly string[] }[];
  phrases: readonly { canonical: string; forms: readonly string[] }[];
  qualifierGroups: readonly (readonly string[])[];
  movements: readonly {
    id: string;
    allOf: readonly string[];
    anyOf: readonly string[];
    muscles: readonly MuscleGroup[];
  }[];
}
export interface ExerciseMatch {
  exerciseId: string;
  name: string;
}
export interface MovementHint {
  id: string;
  muscles: readonly MuscleGroup[];
}
export type ResolvedExercise =
  | {
      kind: 'exercise';
      exerciseId: string;
      matchedBy: 'id' | 'name' | 'alias';
      catalogStatus: 'active';
    }
  | { kind: 'ambiguous'; candidates: ExerciseMatch[] }
  | { kind: 'not_found'; query: string; nearest: ExerciseMatch[]; movement: MovementHint | null };

type NamedExercise = Pick<Exercise, 'id' | 'name' | 'aliases' | 'archived'>;

/** The same normalization is used by catalogue alias validation. */
export const normalizeExerciseName = (text: string): string =>
  fold(text.normalize('NFC'))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** One insertion, deletion or substitution; short words never get fuzzy matching. */
function oneEdit(a: string, b: string): boolean {
  const min = EXERCISE_RESOLVER_CONFIG.typoMinLength;
  if (a.length < min || b.length < min || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length <= b.length) j += 1;
    if (a.length >= b.length) i += 1;
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

const matchOf = (e: NamedExercise): ExerciseMatch => ({ exerciseId: e.id, name: e.name });

/**
 * Build once for a catalogue/lexicon revision, then resolve any number of refs.
 * A returned ambiguous list is always in id order, independent of DB order.
 */
export function createExerciseResolver(
  catalog: Readonly<Record<string, NamedExercise>>,
  lexicon: MovementLexicon,
): (ref: ExerciseRef) => ResolvedExercise {
  const active = Object.values(catalog)
    .filter((e) => !e.archived)
    .sort((a, b) => compareCodePoints(a.id, b.id));
  const words = new Map(
    lexicon.terms.flatMap((t) =>
      [t.canonical, ...t.forms].map((form) => [normalizeExerciseName(form), t.canonical] as const),
    ),
  );
  const empty = new Set(lexicon.stopWords.map(normalizeExerciseName));
  // Exercise-specific words (e.g. Superman) also support one-letter typos;
  // authored inflections still take precedence over those literal tokens.
  for (const e of active) {
    for (const label of [e.name, ...(e.aliases ?? [])]) {
      for (const word of normalizeExerciseName(label).split(' ')) {
        if (word !== '' && !empty.has(word) && !words.has(word)) words.set(word, word);
      }
    }
  }
  const phrases = lexicon.phrases
    .flatMap((p) =>
      p.forms.map((form) => ({
        canonical: p.canonical,
        words: normalizeExerciseName(form).split(' '),
      })),
    )
    .sort((a, b) => b.words.length - a.words.length || compareCodePoints(a.canonical, b.canonical));

  const tokens = (text: string): Set<string> => {
    const raw = normalizeExerciseName(text).split(' ');
    const out = new Set<string>();
    for (let i = 0; i < raw.length; i += 1) {
      const phrase = phrases.find((p) => p.words.every((word, j) => raw[i + j] === word));
      if (phrase !== undefined) {
        out.add(phrase.canonical);
        i += phrase.words.length - 1;
        continue;
      }
      const word = raw[i]!;
      if (word === '' || empty.has(word)) continue;
      const exact = words.get(word);
      if (exact !== undefined) {
        out.add(exact);
        continue;
      }
      // All label words were indexed above; only unknown query words reach here.
      const corrections = new Set(
        [...words].filter(([form]) => oneEdit(word, form)).map(([, canonical]) => canonical),
      );
      out.add(corrections.size === 1 ? [...corrections][0]! : word);
    }
    return out;
  };
  const movementOf = (ts: ReadonlySet<string>): MovementHint | null => {
    const found = lexicon.movements
      .filter(
        (m) =>
          m.allOf.every((t) => ts.has(t)) &&
          (m.anyOf.length === 0 || m.anyOf.some((t) => ts.has(t))),
      )
      .sort(
        (a, b) =>
          b.allOf.length +
            Math.min(1, b.anyOf.length) -
            (a.allOf.length + Math.min(1, a.anyOf.length)) || compareCodePoints(a.id, b.id),
      )[0];
    return found === undefined ? null : { id: found.id, muscles: [...found.muscles] };
  };
  const entries = active.map((e) => {
    const name = tokens(e.name);
    const aliases = (e.aliases ?? []).map((a) => tokens(a));
    const all = new Set([...name, ...aliases.flatMap((a) => [...a])]);
    return { e, name, aliases, all, movement: movementOf(all) };
  });
  const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
    const common = [...a].filter((t) => b.has(t)).length;
    const union = a.size + b.size - common;
    return union === 0 ? 0 : common / union;
  };
  const exercise = (e: NamedExercise, matchedBy: 'id' | 'name' | 'alias'): ResolvedExercise => ({
    kind: 'exercise',
    exerciseId: e.id,
    matchedBy,
    catalogStatus: 'active',
  });
  const exactResult = (hits: NamedExercise[], by: 'name' | 'alias'): ResolvedExercise =>
    hits.length === 1
      ? exercise(hits[0]!, by)
      : { kind: 'ambiguous', candidates: hits.map(matchOf) };

  return (ref) => {
    if ('id' in ref) {
      const found = active.find((e) => e.id === ref.id);
      return found === undefined
        ? { kind: 'not_found', query: ref.id, nearest: [], movement: null }
        : exercise(found, 'id');
    }
    const query = normalizeExerciseName(ref.query);
    const names = active.filter((e) => normalizeExerciseName(e.name) === query);
    if (names.length > 0) return exactResult(names, 'name');
    const aliases = active.filter((e) =>
      e.aliases?.some((a) => normalizeExerciseName(a) === query),
    );
    if (aliases.length > 0) return exactResult(aliases, 'alias');
    const ts = tokens(ref.query);
    // Authored inflections are exact token equivalences, before approximate scoring.
    const same = (label: ReadonlySet<string>) =>
      label.size === ts.size && [...label].every((t) => ts.has(t));
    if (ts.size > 0) {
      const named = entries.filter((e) => same(e.name));
      if (named.length > 0)
        return exactResult(
          named.map((e) => e.e),
          'name',
        );
      const aliased = entries.filter((e) => e.aliases.some(same));
      if (aliased.length > 0)
        return exactResult(
          aliased.map((e) => e.e),
          'alias',
        );
    }
    const movement = movementOf(ts);
    const ranked = entries
      .map((entry) => ({
        ...entry,
        score:
          jaccard(ts, entry.all) +
          (movement !== null && entry.movement?.id === movement.id
            ? EXERCISE_RESOLVER_CONFIG.movementBonus
            : 0),
        // Explicit position/direction/equipment words may never be dropped to make a match.
        compatible: lexicon.qualifierGroups.every((group) =>
          group.filter((t) => ts.has(t)).every((t) => entry.all.has(t)),
        ),
      }))
      .sort((a, b) => b.score - a.score || compareCodePoints(a.e.id, b.e.id));
    const eligible = ranked.filter((r) => r.compatible);
    const best = eligible[0];
    if (best !== undefined && best.score >= EXERCISE_RESOLVER_CONFIG.minScore) {
      const close = eligible.filter((r) => best.score - r.score < EXERCISE_RESOLVER_CONFIG.minLead);
      if (close.length > 1)
        return {
          kind: 'ambiguous',
          candidates: close
            .map((r) => matchOf(r.e))
            .sort((a, b) => compareCodePoints(a.exerciseId, b.exerciseId)),
        };
      const by = best.aliases.some((a) => jaccard(ts, a) > jaccard(ts, best.name))
        ? 'alias'
        : 'name';
      return exercise(best.e, by);
    }
    return {
      kind: 'not_found',
      query: ref.query,
      movement,
      nearest: ranked
        .filter((r) => r.score > 0)
        .slice(0, EXERCISE_RESOLVER_CONFIG.nearestCount)
        .map((r) => matchOf(r.e)),
    };
  };
}

export function resolveExerciseRef(
  ref: ExerciseRef,
  catalog: Readonly<Record<string, NamedExercise>>,
  lexicon: MovementLexicon,
): ResolvedExercise {
  return createExerciseResolver(catalog, lexicon)(ref);
}
