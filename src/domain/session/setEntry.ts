/**
 * The set form and the result it makes: what the logger starts from, and what
 * the person's taps turn into (engine, 06 §1).
 *
 * The form is flat — reps, seconds, a dumbbell mass, a band and its position,
 * the effort — because that is what a phone can show. A planned set is richer:
 * a target with a range and a resistance of any model. The way in reads the
 * plan (or the last result of the exercise) as form values; the way out says
 * which of them the person changed, because a changed value is a report and an
 * unchanged one is the suggestion confirmed.
 */
import { BANDS, LADDER_PAIRED, LADDER_SINGLE } from '../inventory';
import {
  buildObservation,
  defaultEffort,
  FALLBACK_EFFORT_RIR,
  type SetEntry,
} from '../observations/entry';
import type { SetObservation } from '../observations/types';
import type { PlannedSet } from '../plan/plan';
import { loadFromSpec, specFromLoad } from '../resistance/persistedLoad';
import type { ResistanceSpec } from '../resistance/types';
import type { AnchorPosition, Exercise, ShortfallReason } from '../types';

/** Every field the form can show, always filled; which of them count depends on the exercise. */
export interface SetFieldValues {
  reps: number;
  timeSec: number;
  rir: number;
  weightKg: number;
  bandId: string;
  position: AnchorPosition;
  shortfall: ShortfallReason | null;
}

const DEFAULT_REPS = 10;
const DEFAULT_SECONDS = 30;
const DEFAULT_POSITION: AnchorPosition = 1;

export const usesDumbbell = (e: Exercise) => e.equipment.includes('dumbbell');
export const usesBand = (e: Exercise) => e.equipment.includes('band');
export const isTimed = (e: Exercise) => e.forceProfile === 'Isometric';

export function ladderFor(exercise: Exercise): number[] {
  return exercise.dumbbellMode === 'single' ? LADDER_SINGLE : LADDER_PAIRED;
}

/** The values of a spec the form can show, or the form's own starting ones. */
function loadValues(
  exercise: Exercise,
  spec: ResistanceSpec | null,
): Pick<SetFieldValues, 'weightKg' | 'bandId' | 'position'> {
  const load = spec === null ? null : loadFromSpec(spec);
  return {
    weightKg: load?.kind === 'dumbbell' ? load.kg : ladderFor(exercise)[0]!,
    bandId: load?.kind === 'band' ? load.bandId : BANDS[0]!.id,
    position: load?.kind === 'band' ? load.position : DEFAULT_POSITION,
  };
}

/**
 * What the logger suggests for a planned set: the plan's target and load, except
 * that after a result in the same exposure the load the person used stays — a
 * heavier pair of dumbbells grabbed for the first set is not swapped back — and
 * the effort starts from the last one given.
 */
export function suggestedValues(
  exercise: Exercise,
  set: Pick<PlannedSet, 'target' | 'targetRir' | 'resistance'>,
  previous: SetObservation | null,
): SetFieldValues {
  return {
    reps: set.target.kind === 'reps' ? set.target.target : DEFAULT_REPS,
    timeSec: set.target.kind === 'duration' ? set.target.targetSec : DEFAULT_SECONDS,
    rir: defaultEffort(previous, set.targetRir),
    ...loadValues(exercise, previous?.resistance.value ?? set.resistance),
    shortfall: null,
  };
}

/** A stored result as form values: to show it again after it was taken back, or to correct it. */
export function resultValues(exercise: Exercise, result: SetObservation): SetFieldValues {
  const quantity = result.amount.value;
  return {
    reps: quantity?.kind === 'reps' ? quantity.reps : DEFAULT_REPS,
    timeSec: quantity?.kind === 'duration' ? Math.round(quantity.seconds) : DEFAULT_SECONDS,
    rir: result.rir.value ?? FALLBACK_EFFORT_RIR,
    ...loadValues(exercise, result.resistance.value),
    shortfall: result.shortfall,
  };
}

/** The resistance the form stands for; null for an exercise whose load the form does not set. */
export function resistanceOf(exercise: Exercise, values: SetFieldValues): ResistanceSpec | null {
  if (usesDumbbell(exercise)) {
    return specFromLoad({
      kind: 'dumbbell',
      mode: exercise.dumbbellMode ?? 'paired',
      kg: values.weightKg,
    });
  }
  if (usesBand(exercise)) {
    return specFromLoad({ kind: 'band', bandId: values.bandId, position: values.position });
  }
  return null;
}

function sameLoad(exercise: Exercise, a: SetFieldValues, b: SetFieldValues): boolean {
  if (usesDumbbell(exercise)) return a.weightKg === b.weightKg;
  if (usesBand(exercise)) return a.bandId === b.bandId && a.position === b.position;
  return true;
}

/** Whether a set falls short of its target: reps under the range, or a hold under its minimum. */
export function isBelowTarget(
  exercise: Exercise,
  values: Pick<SetFieldValues, 'reps' | 'timeSec'>,
  target: PlannedSet['target'],
): boolean {
  if (isTimed(exercise)) return target.kind === 'duration' && values.timeSec < target.minSec;
  return target.kind === 'reps' && values.reps < target.min;
}

/**
 * The entry a confirmed form makes. A field the person did not change is the
 * suggestion confirmed; a reason for falling short is kept only while the set is short.
 */
export function entryOf(
  exercise: Exercise,
  set: Pick<PlannedSet, 'target' | 'resistance'>,
  values: SetFieldValues,
  suggested: SetFieldValues,
): SetEntry {
  const timed = isTimed(exercise);
  return {
    status: 'performed',
    amount: timed
      ? {
          value: { kind: 'duration', seconds: values.timeSec },
          edited: values.timeSec !== suggested.timeSec,
        }
      : { value: { kind: 'reps', reps: values.reps }, edited: values.reps !== suggested.reps },
    resistance: {
      value: resistanceOf(exercise, values) ?? set.resistance,
      edited: !sameLoad(exercise, values, suggested),
    },
    rir: { value: values.rir, edited: values.rir !== suggested.rir },
    shortfall: isBelowTarget(exercise, values, set.target) ? values.shortfall : null,
  };
}

/**
 * What a correction of a stored result changes: only the fields the person changed, each as
 * reported by them now. A field left alone keeps how it was first recorded.
 */
export function correctionOf(
  exercise: Exercise,
  result: SetObservation,
  values: SetFieldValues,
  at: string,
): Partial<Pick<SetObservation, 'amount' | 'resistance' | 'rir' | 'shortfall'>> {
  const was = resultValues(exercise, result);
  const timed = isTimed(exercise);
  const resistance = resistanceOf(exercise, values);
  const entry: SetEntry = {
    status: result.status,
    amount: timed
      ? {
          value: { kind: 'duration', seconds: values.timeSec },
          edited: values.timeSec !== was.timeSec,
        }
      : { value: { kind: 'reps', reps: values.reps }, edited: values.reps !== was.reps },
    resistance: {
      value: resistance ?? result.resistance.value!,
      edited: resistance !== null && !sameLoad(exercise, values, was),
    },
    rir: { value: values.rir, edited: values.rir !== was.rir },
    shortfall: values.shortfall,
  };
  const made = buildObservation(entry, { channel: 'touch', at, shown: {} });
  return {
    ...(entry.amount.edited ? { amount: made.amount } : {}),
    ...(entry.resistance.edited ? { resistance: made.resistance } : {}),
    ...(entry.rir.edited ? { rir: made.rir } : {}),
    ...(values.shortfall === result.shortfall ? {} : { shortfall: values.shortfall }),
  };
}
