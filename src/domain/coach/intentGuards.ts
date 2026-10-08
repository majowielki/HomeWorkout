import type { ConstraintKind, ConstraintReason } from '../plan/constraints';
import type { MuscleGroup } from '../types';
import { detectTextSignal } from './medicalSignal';
import { fold } from './text';

/*
 * What the coach's planning tools may act on (PLAN-TYGODNIA appendix E, E7).
 * A model proposes a request; these rules decide whether the person's own
 * words allow it. They read folded text, like every other guard here, and
 * err on the side of asking again.
 */

/** A load, a set, a band or a dumbbell — what a request note must never carry. */
const PRESCRIPTION = /\bkg\b|kilogram|\brir\b|powtorzen|powtorz|\bseri[aei]\b|\bgum[aeiy]\b|hantl/;
/** DOMS named as such … */
const NAMES_DOMS = /zakwas|doms/;
/** … and not denied ("to nie zakwasy"). */
const DENIES_DOMS = /nie\s+(?:zakwas|doms)/;
/** Strong: a word for it, or 4-5 on the 1-5 scale. */
const STRONG = /siln|mocn|duze|[45]\s*\/\s*5/;
/** Mild: a word for it, or 1-3 on the scale. */
const MILD = /lekk|lagod|[123]\s*\/\s*5/;
/** "Nie silne", "nie mocne". */
const NOT_STRONG = /nie\s+(?:siln|mocn)/;

/** Whether a request note names a load or the equipment that carries one. */
export function notePrescribes(note: string): boolean {
  return PRESCRIPTION.test(fold(note));
}

/**
 * Whether the person said, in so many words, that their DOMS is strong —
 * the only soreness that may leave a muscle out at the coach's request.
 * Mild, unrated, "not strong" or "not DOMS" all mean asking first.
 */
export function statesStrongDoms(question: string): boolean {
  const text = fold(question);
  return (
    NAMES_DOMS.test(text) &&
    !DENIES_DOMS.test(text) &&
    !MILD.test(text) &&
    !NOT_STRONG.test(text) &&
    STRONG.test(text)
  );
}

/** Soreness that is strong, or of a strength not given, rules out extra work until it is clarified. */
export function sorenessBlocksExtraWork(question: string): boolean {
  if (detectTextSignal(question) !== 'soreness') return false;
  const text = fold(question);
  return STRONG.test(text) || !MILD.test(text);
}

/** DOMS rated at least this on the 1-5 scale counts as strong (appendix D). */
export const STRONG_DOMS_LEVEL = 4;

/** A request in the shape the coach's tool sends it: relative to today. */
export interface RelativeRequest {
  kind: ConstraintKind;
  muscles: readonly MuscleGroup[];
  fromDaysAhead: number;
  days: number;
  reason: ConstraintReason;
  domsLevel?: number;
}

/** Inside the planned days, and with muscles exactly when the kind needs them. */
export function requestFits(request: RelativeRequest, horizonDays: number): boolean {
  const needsMuscles = request.kind === 'avoid_muscle';
  return (
    request.fromDaysAhead + request.days <= horizonDays &&
    needsMuscles === request.muscles.length > 0
  );
}

/**
 * A request to leave muscles out, made about soreness, must rest on strong
 * DOMS the person stated themselves: the model may not rate it, nor call a
 * sore muscle DOMS. Anything short of that is a question back, not a change.
 */
export function avoidNeedsClarification(request: RelativeRequest, question: string): boolean {
  if (request.kind !== 'avoid_muscle') return false;
  if (request.reason !== 'doms' && detectTextSignal(question) !== 'soreness') return false;
  return (
    request.reason !== 'doms' ||
    (request.domsLevel ?? 0) < STRONG_DOMS_LEVEL ||
    !statesStrongDoms(question)
  );
}
