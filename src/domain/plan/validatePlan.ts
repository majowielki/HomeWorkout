import {
  PLANNER_CONFIG,
  type PlannerConfig,
  PROGRESSION_CONFIG,
  TRAINING_CONFIG,
} from '../config/training';
import { targetMet } from '../progression/doubleProgression';
import { exposuresOf, firstOfEachDay, type HistorySession } from '../progression/history';
import { ladderFor, type LoadLadder } from '../progression/ladder';
import { loadKindOf } from '../progression/load';
import { unitOf } from '../progression/prescribe';
import type { BandCalibrationMap, Exercise, MuscleGroup, PlannedLoad } from '../types';
import { countsAsVolume, maxDirectSets } from '../volume/weekly';
import { type EligibilityContext, ineligibility } from './eligibility';
import { planMinutes } from './estimate';
import type { ValidationCode } from './reasons';
import type { PlanAdjustment, PlannedExercise, Slot } from './types';

/** The last load of an exercise and whether its target was met then. */
export interface LastLoad {
  load: PlannedLoad;
  targetMet: boolean;
}

export interface ValidationContext {
  catalog: Readonly<Record<string, Exercise>>;
  eligibility: EligibilityContext;
  slotOf: ReadonlyMap<string, Slot>;
  /** Direct working sets per muscle (primary only) over the last 7 days, before today's plan. */
  volume: Readonly<Record<MuscleGroup, number>>;
  lastLoads: Readonly<Record<string, LastLoad>>;
  calibrations?: BandCalibrationMap;
}

export interface ValidationResult {
  exercises: PlannedExercise[];
  adjustments: PlanAdjustment[];
}

/** Stands in for the slot of an exercise that has none (an LLM may name any exercise). */
const NO_SLOT: Slot = {
  id: '',
  name: '',
  kind: 'accessory',
  region: 'core',
  exerciseIds: [],
  rir: [2, 3],
  restSec: 60,
  start: {},
};

const clamp = (value: number, [lo, hi]: readonly [number, number]) =>
  Math.min(hi, Math.max(lo, value));

/**
 * The safety clamps every plan passes before it is shown — from the engine
 * or, later, from a model (SPEC §8). A plan is trimmed, never rejected,
 * and every change is reported; a medical violation removes the exercise
 * outright.
 *
 * 1. the exercise exists
 * 2. it passes the knee filter and the person's own list; its equipment is here
 * 3. its load is one the equipment can make
 * 6. sets 1-6, reps 1-30, holds 5-300 s, RIR 0-5
 * 4. at most one step above the last load, and only after the target was met
 * 5. no muscle past the weekly maximum of direct sets — sets where it is
 *    primary (half-sets from other exercises do not count: a full abdomen must not
 *    block a squat)
 * 7. the session fits in the time budget — exercises dropped from the end
 */
export function validatePlan(
  planned: readonly PlannedExercise[],
  ctx: ValidationContext,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): ValidationResult {
  const adjustments: PlanAdjustment[] = [];
  const note = (exerciseId: string, code: ValidationCode) => adjustments.push({ exerciseId, code });
  const added = Object.fromEntries(Object.keys(ctx.volume).map((m) => [m, 0])) as Record<
    MuscleGroup,
    number
  >;
  const kept: PlannedExercise[] = [];

  for (const original of planned) {
    const exercise = ctx.catalog[original.exerciseId];
    if (!exercise) {
      note(original.exerciseId, 'UNKNOWN_EXERCISE');
      continue;
    }
    const out = ineligibility(exercise, ctx.eligibility);
    if (out.some((r) => r.startsWith('KNEE_'))) {
      note(exercise.id, 'MEDICAL_EXCLUSION');
      continue;
    }
    if (out.includes('USER_EXCLUDED')) {
      note(exercise.id, 'USER_EXCLUDED');
      continue;
    }
    if (out.length > 0) {
      note(exercise.id, 'EXERCISE_UNAVAILABLE');
      continue;
    }

    const ladder = ladderFor(exercise, ctx.slotOf.get(exercise.id) ?? NO_SLOT, ctx.calibrations);
    let p = { ...original };

    const snapped = ladder.snap(p.load) ?? ladder.start;
    if (!sameLoad(snapped, p.load)) {
      p = { ...p, load: snapped };
      note(exercise.id, 'LOAD_NOT_AVAILABLE');
    }

    const ranged = clampRanges(p, cfg);
    if (ranged !== p) {
      p = ranged;
      note(exercise.id, 'RANGE_CLAMPED');
    }

    const allowed = allowedTop(ladder, ctx.lastLoads[exercise.id]);
    if (ladder.rank(p.load)! > ladder.rank(allowed)!) {
      p = { ...p, load: allowed };
      note(exercise.id, 'LOAD_JUMP_CLAMPED');
    }

    // Sets planned further from failure than a working set (light practice
    // at RIR 5) are not volume, by the same rule that counts it (SPEC §4.2).
    const working = p.targetRirMin <= training.workingSetMaxRir;
    if (working && countsAsVolume(exercise, training)) {
      const room = Math.floor(
        Math.min(
          ...exercise.primaryMuscles.map(
            (m) => maxDirectSets(m, training) - ctx.volume[m] - added[m],
          ),
        ),
      );
      if (p.sets > room) {
        note(exercise.id, 'VOLUME_TRIMMED');
        if (room < 1) continue;
        p = { ...p, sets: room };
      }
      for (const m of exercise.primaryMuscles) added[m] += p.sets;
    }

    kept.push(p);
  }

  while (kept.length > 0 && planMinutes(kept, ctx.catalog, cfg) > cfg.sessionMinutes.max) {
    note(kept.pop()!.exerciseId, 'TIME_TRIMMED');
  }

  return { exercises: kept, adjustments };
}

function sameLoad(a: PlannedLoad, b: PlannedLoad): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The heaviest load allowed today: one step up after a met target, the same load otherwise. */
function allowedTop(ladder: LoadLadder, last: LastLoad | undefined): PlannedLoad {
  const lastLoad = last ? ladder.snap(last.load) : null;
  if (!last || !lastLoad) return ladder.start;
  return last.targetMet ? (ladder.up(lastLoad)?.load ?? lastLoad) : lastLoad;
}

function clampRanges(p: PlannedExercise, cfg: PlannerConfig): PlannedExercise {
  const { limits } = cfg;
  const amountLimits = p.unit === 'sec' ? limits.timeSec : limits.reps;
  const next: PlannedExercise = {
    ...p,
    sets: clamp(p.sets, limits.sets),
    target: clamp(p.target, amountLimits),
    targetRirMin: clamp(p.targetRirMin, limits.rir),
    targetRirMax: clamp(p.targetRirMax, limits.rir),
  };
  if (p.repMin !== undefined) next.repMin = clamp(p.repMin, limits.reps);
  if (p.repMax !== undefined) next.repMax = clamp(p.repMax, limits.reps);
  if (p.timeSec !== undefined) next.timeSec = clamp(p.timeSec, limits.timeSec);
  if (next.repMin !== undefined && next.repMax !== undefined && next.repMin > next.repMax) {
    next.repMin = next.repMax;
  }
  if (next.targetRirMin > next.targetRirMax) next.targetRirMin = next.targetRirMax;
  const changed = (Object.keys(next) as (keyof PlannedExercise)[]).some((k) => next[k] !== p[k]);
  return changed ? next : p;
}

/**
 * What validatePlan needs to know about history: each exercise's last
 * load and whether its target was met then. Exercises never done are
 * absent, which caps them at their start load.
 */
export function lastLoadsOf(
  exerciseIds: readonly string[],
  sessions: readonly HistorySession[],
  catalog: Readonly<Record<string, Exercise>>,
  slotOf: ReadonlyMap<string, Slot>,
): Record<string, LastLoad> {
  const out: Record<string, LastLoad> = {};
  for (const id of exerciseIds) {
    const exercise = catalog[id];
    if (!exercise) continue;
    const slot = slotOf.get(id) ?? NO_SLOT;
    const ladder = ladderFor(exercise, slot);
    const unit = unitOf(exercise);
    const exposures = firstOfEachDay(
      exposuresOf(
        id,
        sessions,
        ladder,
        unit,
        loadKindOf(exercise) === 'band' && PROGRESSION_CONFIG.requireBandWarmup,
      ),
    );
    const last = exposures[exposures.length - 1];
    if (!last) continue;
    const range = (unit === 'sec' ? slot.timeRange : slot.repRange) ?? [Infinity, Infinity];
    out[id] = { load: last.load, targetMet: targetMet(last, { range, minRir: slot.rir[0], unit }) };
  }
  return out;
}
