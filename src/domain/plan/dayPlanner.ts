import { fatigueSignals } from '../autoregulation/fatigue';
import {
  AUTOREGULATION_CONFIG,
  BLOCK_CONFIG,
  PLANNER_CONFIG,
  type PlannerConfig,
  PROGRESSION_CONFIG,
  TRAINING_CONFIG,
} from '../config/training';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { bikePrescription, type Ride } from '../progression/bike';
import type { HistorySession } from '../progression/history';
import { layoffState, type LayoffState } from '../progression/layoff';
import { ladderFor } from '../progression/ladder';
import { prescribe, type Prescription, unitOf } from '../progression/prescribe';
import { daysBetween } from '../time/trainingDate';
import type { BandCalibrationMap, Exercise, MuscleGroup } from '../types';
import { countsAsVolume, maxDirectSets, weeklyVolume } from '../volume/weekly';
import { phaseOf } from './block';
import {
  type Avoided,
  avoidedOn,
  isAvoided,
  isLighterDay,
  type PlanConstraint,
} from './constraints';
import {
  allowedCandidates,
  type EligibilityContext,
  isEligible,
  slotByExercise,
} from './eligibility';
import { exerciseSeconds, planMinutes } from './estimate';
import type { DayReason, FatigueSignal, SkipReason } from './reasons';
import type {
  BlockState,
  DailyReadiness,
  DaySelection,
  PlannedExercise,
  SelectedItem,
  SelectionViolation,
  SessionPlan,
  SkippedSlot,
  Slot,
  SlotRegion,
} from './types';
import { lastLoadsOf, validatePlan } from './validatePlan';

export interface PlannerInput {
  asOf: string;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** Already advanced to `asOf` (advanceBlock). */
  block: BlockState;
  /** Completed sessions, oldest first. */
  sessions: readonly HistorySession[];
  /** Bike rides, oldest first. */
  rides: readonly Ride[];
  daily: readonly DailyReadiness[];
  calibrations?: BandCalibrationMap;
  /** What the person asked for; only the ones covering `asOf` matter. */
  constraints?: readonly PlanConstraint[];
}

interface Candidate {
  slot: Slot;
  exercise: Exercise;
  prescription: Prescription;
}

interface Picked extends Candidate {
  sets: number;
}

const ONE_LEGGED = new Set(['UnilateralSupported', 'UnilateralUnsupported']);

/**
 * The state of one day as the planner reads it: layoff, overload signals,
 * block phase, readiness, the week's volume, when each muscle and slot was
 * last trained, and what was asked to be left out. Choosing a day, building
 * it and checking a stored one all read it, so they cannot disagree.
 */
interface DayContext {
  asOf: string;
  past: readonly HistorySession[];
  slotOf: ReadonlyMap<string, Slot>;
  layoff: LayoffState;
  signals: FatigueSignal[];
  phase: 'work' | 'deload';
  lowReadiness: boolean;
  lighter: boolean;
  volume: Record<MuscleGroup, number>;
  lastPrimary: Partial<Record<MuscleGroup, string>>;
  lastSlot: Record<string, string>;
  avoided: Avoided;
  isSore: (e: Exercise) => boolean;
}

function dayContext(
  input: PlannerInput,
  cfg: PlannerConfig,
  training: typeof TRAINING_CONFIG,
): DayContext {
  const { asOf, catalog, slots } = input;
  const slotOf = slotByExercise(slots);
  const past = input.sessions.filter((s) => s.date <= asOf);
  const today = input.daily.find((d) => d.date === asOf);
  const constraints = input.constraints ?? [];
  return {
    asOf,
    past,
    slotOf,
    layoff: layoffState(
      past.map((s) => s.date),
      asOf,
    ),
    signals: fatigueSignals({ asOf, sessions: past, catalog, slotOf, daily: input.daily }),
    phase: phaseOf(input.block, asOf),
    lowReadiness:
      today !== undefined &&
      ((today.sleepHours !== null && today.sleepHours < cfg.lowReadiness.sleepHours) ||
        (today.energy !== null && today.energy <= cfg.lowReadiness.energy)),
    lighter: isLighterDay(constraints, asOf),
    volume: directVolume(past, catalog, asOf, training),
    ...lastTrained(past, catalog, slotOf, training),
    avoided: avoidedOn(constraints, asOf),
    isSore: (e) =>
      e.primaryMuscles.some(
        (m) => (today?.soreness?.[m] ?? 0) >= AUTOREGULATION_CONFIG.highSorenessLevel,
      ),
  };
}

/**
 * Why the exercise cannot be trained today regardless of the budget — or
 * null when it can: strong DOMS, a muscle still recovering, or a muscle
 * left out on request.
 */
function blocked(exercise: Exercise, ctx: DayContext, cfg: PlannerConfig): SkipReason | null {
  if (isAvoided(exercise, ctx.avoided)) return 'AVOIDED_BY_REQUEST';
  if (ctx.isSore(exercise)) return 'DOMS_HIGH';
  const recovering = exercise.primaryMuscles.some((m) => {
    const last = ctx.lastPrimary[m];
    return last !== undefined && daysBetween(last, ctx.asOf) <= cfg.recoveryDays;
  });
  return recovering ? 'RECOVERING' : null;
}

/** Sets per exercise today: fewer in a deload week and on a lighter day asked for. */
function setsFor(ctx: DayContext, cfg: PlannerConfig): number {
  if (ctx.lighter) return 1;
  return ctx.phase === 'deload'
    ? Math.max(1, Math.round(cfg.setsPerExercise * BLOCK_CONFIG.deloadSetFactor))
    : cfg.setsPerExercise;
}

/**
 * The plan for one day, SPEC §10.4. Deterministic: the same logs give the
 * same plan, which is what makes it testable and explainable.
 *
 * Every slot gets its block exercise and a chance; the ones that cannot
 * be trained today say why (sore, still recovering, at the weekly maximum,
 * …). The rest compete on how far their muscles are below target and how
 * long the slot has waited, and fill the time budget. A short day is
 * topped up with mobility. The result passes validatePlan like any plan.
 *
 * It is two steps, which the week planner also uses apart: `selectDay`
 * decides what to train, `buildDay` how much, from the logs as they are
 * on the day (SPEC §11).
 */
export function planDay(
  input: PlannerInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): SessionPlan {
  return buildDay(selectDay(input, cfg, training), input, cfg, training);
}

/** What to train on `input.asOf`: slots, exercises and sets, and the slots left out with why. */
export function selectDay(
  input: PlannerInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): DaySelection {
  const { asOf, catalog, slots, block } = input;
  const ctx = dayContext(input, cfg, training);
  const { volume, lastSlot } = ctx;

  const skipped: SkippedSlot[] = [];
  const candidates: (Candidate & { swapped: boolean })[] = [];
  for (const slot of slots) {
    if (slot.kind === 'filler') continue;
    const selected = block.selections[slot.id];
    let exercise = selected === undefined ? undefined : catalog[selected];
    const skip = (reason: SkipReason) =>
      skipped.push({ slotId: slot.id, exerciseId: selected ?? null, reason });
    if (!exercise) {
      skip('NO_CANDIDATE');
      continue;
    }
    let swapped = false;
    if (ctx.signals.includes('FATIGUE_HIGH') && ONE_LEGGED.has(exercise.stanceMechanics)) {
      const twoLegged = allowedCandidates(slot, catalog, input.eligibility).find(
        (e) => !ONE_LEGGED.has(e.stanceMechanics),
      );
      if (!twoLegged) {
        skip('FATIGUE_BILATERAL_ONLY');
        continue;
      }
      exercise = twoLegged;
      swapped = true;
    }
    const reason = blocked(exercise, ctx, cfg);
    if (reason) {
      skip(reason);
      continue;
    }
    const prescription = workPrescription(exercise, slot, ctx, input, swapped);
    candidates.push({ slot, exercise, swapped, prescription });
  }

  // Greedy fill: muscles below target first, then the slots that waited longest.
  const targetSets = training.weeklyWorkingSetsPerMuscle.target;
  const added = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  const weekRoom = (e: Exercise) =>
    Math.min(
      ...e.primaryMuscles.map((m) => Math.floor(maxDirectSets(m, training) - volume[m] - added[m])),
    );
  const dayRoom = (e: Exercise) =>
    Math.min(...e.primaryMuscles.map((m) => cfg.maxDirectSetsPerMuscleDay - added[m]));
  // A muscle only one slot can train (hamstrings: the hinge) weighs more
  // than one four slots can (glutes): otherwise the many slots of the
  // common muscle use up the weekly maximum first and the rare one never
  // reaches its target.
  const providers = new Map<MuscleGroup, number>();
  for (const slot of slots) {
    const id = block.selections[slot.id];
    const exercise = id === undefined ? undefined : catalog[id];
    if (slot.kind === 'filler' || !exercise) continue;
    for (const m of exercise.primaryMuscles) providers.set(m, (providers.get(m) ?? 0) + 1);
  }
  const deficit = (e: Exercise) =>
    e.primaryMuscles.reduce(
      (sum, m) =>
        sum + Math.max(0, targetSets - volume[m] - added[m]) / Math.max(1, providers.get(m) ?? 1),
      0,
    );
  const daysAway = (slot: Slot) => {
    const last = lastSlot[slot.id];
    return last === undefined ? Infinity : daysBetween(last, asOf);
  };
  const staleness = (slot: Slot) =>
    Math.min(daysAway(slot), cfg.scoring.stalenessCapDays) / cfg.scoring.stalenessUnitDays;
  const wanted = (c: Candidate) =>
    deficit(c.exercise) > 0 || daysAway(c.slot) >= cfg.forceStaleDays;
  const setsWanted = setsFor(ctx, cfg);
  const secondsOf = (c: Candidate, sets: number) =>
    exerciseSeconds({ ...c.prescription, sets, restSec: c.slot.restSec }, c.exercise, cfg);

  const items: SelectedItem[] = [];
  let seconds = 0;
  let remaining = [...candidates];
  while (items.length < cfg.maxExercisesPerSession && seconds < cfg.sessionMinutes.target * 60) {
    let best: { c: (typeof candidates)[number]; sets: number; secs: number; score: number } | null =
      null;
    for (const c of remaining) {
      const sets = Math.min(setsWanted, weekRoom(c.exercise), dayRoom(c.exercise));
      if (sets < 1 || !wanted(c)) continue;
      const need = deficit(c.exercise);
      const secs = secondsOf(c, sets);
      if (seconds + secs > cfg.sessionMinutes.max * 60) continue;
      const score =
        cfg.scoring.deficitWeight * need +
        staleness(c.slot) +
        (c.slot.kind === 'compound' ? cfg.scoring.compoundBonus : 0);
      if (best === null || score > best.score) best = { c, sets, secs, score };
    }
    if (best === null) break;
    const { c } = best;
    items.push({
      slotId: c.slot.id,
      exerciseId: c.exercise.id,
      sets: best.sets,
      role: 'work',
      ...(c.swapped ? { swapped: true } : {}),
    });
    remaining = remaining.filter((r) => r !== c);
    seconds += best.secs;
    for (const m of c.exercise.primaryMuscles) added[m] += best.sets;
  }
  for (const c of remaining) {
    const reason: SkipReason =
      weekRoom(c.exercise) < 1
        ? 'VOLUME_AT_MAX'
        : dayRoom(c.exercise) < 1
          ? 'ALREADY_TODAY'
          : !wanted(c)
            ? 'VOLUME_ON_TARGET'
            : 'NOT_PICKED';
    skipped.push({ slotId: c.slot.id, exerciseId: c.exercise.id, reason });
  }
  const hardSeconds = seconds;

  // Top a short day up: first light practice of the core and rotator-cuff
  // slots not already in the plan (RIR 5, not a working set), longest
  // waiting first; then mobility, which never progresses.
  const minSeconds = cfg.sessionMinutes.min * 60;
  const inPlan = new Set(items.map((p) => p.slotId));
  const lightSlots = slots
    .filter((s) => s.lightFill && !inPlan.has(s.id))
    .sort((x, y) => staleness(y) - staleness(x));
  for (const slot of lightSlots) {
    const id = block.selections[slot.id];
    const exercise = id === undefined ? undefined : catalog[id];
    if (seconds >= minSeconds || !exercise || ctx.isSore(exercise)) continue;
    if (isAvoided(exercise, ctx.avoided)) continue;
    const candidate = { slot, exercise, prescription: lightPrescription(exercise, slot, ctx, cfg) };
    seconds += secondsOf(candidate, cfg.fillerSets);
    items.push({ slotId: slot.id, exerciseId: exercise.id, sets: cfg.fillerSets, role: 'light' });
  }
  for (const slot of slots.filter((s) => s.kind === 'filler')) {
    for (const exercise of allowedCandidates(slot, catalog, input.eligibility)) {
      if (seconds >= minSeconds) break;
      if (isAvoided(exercise, ctx.avoided)) continue;
      const candidate = { slot, exercise, prescription: mobilityPrescription(exercise, slot) };
      seconds += secondsOf(candidate, cfg.fillerSets);
      items.push({
        slotId: slot.id,
        exerciseId: exercise.id,
        sets: cfg.fillerSets,
        role: 'mobility',
      });
    }
  }

  const dayReasons: DayReason[] = [];
  if (hardSeconds < (cfg.sessionMinutes.min * 60) / 2) dayReasons.push('LIGHT_DAY');
  if (ctx.lighter) dayReasons.push('LIGHTER_DAY_REQUESTED');

  return {
    date: asOf,
    blockIndex: block.index,
    phase: ctx.phase,
    items,
    skipped,
    dayReasons,
  };
}

/**
 * How much, for a day's selection: every exercise prescribed from the logs
 * as they are on `input.asOf` (progression, layoff, deload, readiness),
 * ordered and labelled for the session runner, and checked by validatePlan.
 * A selection made days ahead gets today's loads, not the forecast's.
 */
export function buildDay(
  selection: DaySelection,
  input: PlannerInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): SessionPlan {
  const { asOf, catalog } = input;
  const ctx = dayContext(input, cfg, training);
  const { past, slotOf, layoff } = ctx;
  const slotById = new Map(input.slots.map((s) => [s.id, s]));

  const work: Picked[] = [];
  const light: Picked[] = [];
  const mobility: Picked[] = [];
  for (const item of selection.items) {
    const slot = slotById.get(item.slotId);
    const exercise = catalog[item.exerciseId];
    if (!slot || !exercise) continue;
    if (item.role === 'work') {
      const prescription = workPrescription(exercise, slot, ctx, input, item.swapped === true);
      work.push({ slot, exercise, sets: item.sets, prescription });
    } else if (item.role === 'light') {
      light.push({
        slot,
        exercise,
        sets: item.sets,
        prescription: lightPrescription(exercise, slot, ctx, cfg),
      });
    } else {
      mobility.push({
        slot,
        exercise,
        sets: item.sets,
        prescription: mobilityPrescription(exercise, slot),
      });
    }
  }

  const ordered = orderAndLabel(work, light, mobility);
  const validated = validatePlan(
    ordered,
    {
      catalog,
      eligibility: input.eligibility,
      slotOf,
      volume: ctx.volume,
      lastLoads: lastLoadsOf(
        ordered.map((p) => p.exerciseId),
        past,
        catalog,
        slotOf,
      ),
      calibrations: input.calibrations,
    },
    cfg,
    training,
  );

  const dayReasons: DayReason[] = [];
  if (past.length === 0) dayReasons.push('FIRST_DAY');
  if (ctx.phase === 'deload') dayReasons.push('DELOAD_WEEK');
  if (layoff.tier === 'short') dayReasons.push('LAYOFF_SHORT');
  else if (layoff.tier === 'medium') dayReasons.push('LAYOFF_MEDIUM');
  else if (layoff.tier === 'long') dayReasons.push('LAYOFF_LONG');
  else if (layoff.recalibrating) dayReasons.push('LAYOFF_RECALIBRATION');
  if (ctx.lowReadiness) dayReasons.push('LOW_READINESS');
  dayReasons.push(...selection.dayReasons);

  return {
    version: 1,
    date: asOf,
    blockIndex: selection.blockIndex,
    phase: selection.phase,
    regions: regionsOf(validated.exercises, slotOf),
    bike: bikePrescription(input.rides, layoff),
    exercises: validated.exercises,
    skipped: selection.skipped,
    dayReasons,
    signals: ctx.signals,
    estimatedMinutes: planMinutes(validated.exercises, catalog, cfg),
    adjustments: validated.adjustments,
  };
}

/**
 * Whether a selection made earlier — for a week ahead — is still safe and
 * possible on its day: the same rules `selectDay` applies, checked against
 * the logs as they are now (SPEC §11). An empty list keeps the day as
 * planned; anything else makes the week plan it again.
 */
export function checkSelection(
  selection: DaySelection,
  input: PlannerInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): SelectionViolation[] {
  const { catalog, block } = input;
  const ctx = dayContext(input, cfg, training);
  const out: SelectionViolation[] = [];
  if (selection.blockIndex !== block.index || selection.phase !== ctx.phase) {
    out.push({ slotId: null, code: 'BLOCK_CHANGED' });
  }
  if (ctx.lighter !== selection.dayReasons.includes('LIGHTER_DAY_REQUESTED')) {
    out.push({ slotId: null, code: 'REQUEST_CHANGED' });
  }
  const added = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  for (const item of selection.items) {
    const exercise = catalog[item.exerciseId];
    const slot = input.slots.find((s) => s.id === item.slotId);
    if (!exercise || !slot || !isEligible(exercise, input.eligibility)) {
      out.push({ slotId: item.slotId, code: 'NOT_ALLOWED' });
      continue;
    }
    if (item.role !== 'mobility' && !item.swapped && block.selections[slot.id] !== exercise.id) {
      out.push({ slotId: item.slotId, code: 'SELECTION_CHANGED' });
      continue;
    }
    if (item.role === 'work') {
      const reason = blocked(exercise, ctx, cfg);
      if (reason) out.push({ slotId: item.slotId, code: reason });
      for (const m of exercise.primaryMuscles) added[m] += item.sets;
    } else if (
      isAvoided(exercise, ctx.avoided) ||
      (item.role === 'light' && ctx.isSore(exercise))
    ) {
      out.push({
        slotId: item.slotId,
        code: isAvoided(exercise, ctx.avoided) ? 'AVOIDED_BY_REQUEST' : 'DOMS_HIGH',
      });
    }
  }
  for (const m of MUSCLE_GROUPS) {
    if (added[m] === 0) continue;
    if (
      ctx.volume[m] + added[m] > maxDirectSets(m, training) ||
      added[m] > cfg.maxDirectSetsPerMuscleDay
    ) {
      out.push({ slotId: null, code: 'VOLUME_AT_MAX' });
      break;
    }
  }
  return out;
}

/** A working exercise's prescription on the day: progression, layoff, deload, readiness. */
function workPrescription(
  exercise: Exercise,
  slot: Slot,
  ctx: DayContext,
  input: PlannerInput,
  swapped: boolean,
): Prescription {
  const base = prescribe({
    exercise,
    slot,
    sessions: ctx.past,
    asOf: ctx.asOf,
    layoff: ctx.layoff,
    deload: ctx.phase === 'deload',
    calibrations: input.calibrations,
  });
  const reasons = [...base.reasons];
  if (swapped) reasons.push('BILATERAL_SWAP');
  if (!ctx.lowReadiness) return { ...base, reasons };
  reasons.push('LOW_READINESS');
  return { ...base, rir: [Math.min(5, base.rir[0] + 1), Math.min(5, base.rir[1] + 1)], reasons };
}

/** Light practice at RIR 5 to fill a short day — not a working set (SPEC §10.4). */
function lightPrescription(
  exercise: Exercise,
  slot: Slot,
  ctx: DayContext,
  cfg: PlannerConfig,
): Prescription {
  const rx = prescribe({ exercise, slot, sessions: ctx.past, asOf: ctx.asOf, layoff: ctx.layoff });
  return {
    ...rx,
    target: rx.range[0],
    rir: [cfg.lightFillRir, cfg.lightFillRir],
    warmupSet: false,
    reasons: ['LIGHT_FILL'],
  };
}

function mobilityPrescription(exercise: Exercise, slot: Slot): Prescription {
  const unit = unitOf(exercise);
  const range: [number, number] =
    (unit === 'sec' ? slot.timeRange : slot.repRange) ?? PROGRESSION_CONFIG.fallbackRepRange;
  return {
    load: ladderFor(exercise, slot).start,
    unit,
    target: range[0],
    range,
    rir: [slot.rir[0], slot.rir[1]],
    warmupSet: false,
    reasons: [],
    confidence: 'high',
  };
}

/**
 * Direct working sets per muscle over the 7 days ending on `asOf` — sets
 * where it is primary. The research behind 3-6 counts sets aimed at the
 * muscle (SPEC §4.1); half-sets from other exercises would let a squat's
 * core work crowd out every core exercise (SPEC §10.8).
 */
export function directVolume(
  sessions: readonly HistorySession[],
  catalog: Readonly<Record<string, Exercise>>,
  asOf: string,
  training = TRAINING_CONFIG,
): Record<MuscleGroup, number> {
  return weeklyVolume(
    sessions.flatMap((s) =>
      s.sets.map((set) => ({
        exerciseId: set.exerciseId,
        date: s.date,
        isWarmup: set.isWarmup,
        rir: set.rir,
        side: set.side ?? null,
      })),
    ),
    catalog,
    asOf,
    { ...training, secondaryMuscleWeight: 0 },
  );
}

/**
 * When each muscle last had working sets as a primary, and when each slot
 * was last trained. Light practice at RIR 5 is not training here either.
 */
export function lastTrained(
  sessions: readonly HistorySession[],
  catalog: Readonly<Record<string, Exercise>>,
  slotOf: ReadonlyMap<string, Slot>,
  training: typeof TRAINING_CONFIG,
) {
  const lastPrimary: Partial<Record<MuscleGroup, string>> = {};
  const lastSlot: Record<string, string> = {};
  for (const session of sessions) {
    for (const set of session.sets) {
      const exercise = catalog[set.exerciseId];
      const working = set.rir === null || set.rir <= training.workingSetMaxRir;
      if (set.isWarmup || !working || !exercise || !countsAsVolume(exercise, training)) continue;
      for (const m of exercise.primaryMuscles) {
        if ((lastPrimary[m] ?? '') < session.date) lastPrimary[m] = session.date;
      }
      const slot = slotOf.get(exercise.id);
      if (slot && (lastSlot[slot.id] ?? '') < session.date) lastSlot[slot.id] = session.date;
    }
  }
  return { lastPrimary, lastSlot };
}

/**
 * Compounds first, lower body paired with upper body as supersets (A1/A2),
 * then accessories and core in pairs, then the light fill and the
 * mobility as one circuit each. No exercise is left in a group of its
 * own (Documents/PLAN-TYGODNIA-I-POPRAWKI.md, Q-5). The
 * labels drive the existing session runner, which interleaves a group's
 * sets.
 */
function orderAndLabel(
  picked: readonly Picked[],
  light: readonly Picked[],
  mobility: readonly Picked[],
): PlannedExercise[] {
  const byKind = (kind: Slot['kind']) => picked.filter((p) => p.slot.kind === kind);
  const lower = byKind('compound').filter((p) => p.slot.region === 'lower');
  const upper = byKind('compound').filter((p) => p.slot.region !== 'lower');
  const compounds: Picked[] = [];
  for (let i = 0; i < Math.max(lower.length, upper.length); i += 1) {
    if (lower[i]) compounds.push(lower[i]!);
    if (upper[i]) compounds.push(upper[i]!);
  }

  const groups: Picked[][] = [];
  const take = (items: readonly Picked[], pairable: (a: Picked, b: Picked) => boolean) => {
    for (let i = 0; i < items.length;) {
      const a = items[i]!;
      const b = items[i + 1];
      if (b && pairable(a, b)) {
        groups.push([a, b]);
        i += 2;
      } else {
        groups.push([a]);
        i += 1;
      }
    }
  };
  take(compounds, (a, b) => (a.slot.region === 'lower') !== (b.slot.region === 'lower'));
  take(byKind('accessory'), () => true);
  take(byKind('core'), () => true);
  if (light.length > 0) groups.push([...light]);
  if (mobility.length > 0) groups.push([...mobility]);

  return withoutLoners(groups).flatMap((group, g) =>
    group.map((p, i) => toPlanned(p, `${String.fromCharCode(65 + g)}${i + 1}`)),
  );
}

/**
 * A lone exercise would run its sets back to back with nothing in between
 * (Documents/PLAN-TYGODNIA-I-POPRAWKI.md, Q-5). Neighbouring loners pair
 * up; an odd one out joins the group before it — or, first in line, the
 * one after it. Only a session of one exercise keeps it alone.
 */
function withoutLoners(groups: readonly Picked[][]): Picked[][] {
  const out: Picked[][] = [];
  let loner: Picked | null = null;
  for (const group of groups) {
    if (group.length === 1) {
      if (loner) {
        out.push([loner, group[0]!]);
        loner = null;
      } else {
        loner = group[0]!;
      }
      continue;
    }
    const next = [...group];
    if (loner) {
      if (out.length > 0) out[out.length - 1]!.push(loner);
      else next.unshift(loner);
      loner = null;
    }
    out.push(next);
  }
  if (loner) {
    if (out.length > 0) out[out.length - 1]!.push(loner);
    else out.push([loner]);
  }
  return out;
}

function toPlanned(p: Picked, label: string): PlannedExercise {
  const { prescription: rx } = p;
  const amounts =
    rx.unit === 'sec' ? { timeSec: rx.target } : { repMin: rx.range[0], repMax: rx.range[1] };
  return {
    label,
    exerciseId: p.exercise.id,
    sets: p.sets,
    ...amounts,
    targetRirMin: rx.rir[0],
    targetRirMax: rx.rir[1],
    restSec: p.slot.restSec,
    slotId: p.slot.id,
    load: rx.load,
    unit: rx.unit,
    target: rx.target,
    warmupSet: rx.warmupSet,
    reasons: rx.reasons,
    confidence: rx.confidence,
  };
}

/** Regions of the hard work by number of sets, most first; mobility never titles a day. */
function regionsOf(
  exercises: readonly PlannedExercise[],
  slotOf: ReadonlyMap<string, Slot>,
): SlotRegion[] {
  const sets = new Map<SlotRegion, number>();
  for (const e of exercises) {
    const region = slotOf.get(e.exerciseId)?.region;
    if (region === undefined || region === 'mobility') continue;
    sets.set(region, (sets.get(region) ?? 0) + e.sets);
  }
  return [...sets.entries()].sort((a, b) => b[1] - a[1]).map(([region]) => region);
}
