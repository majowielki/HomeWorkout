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
import { layoffState } from '../progression/layoff';
import { ladderFor } from '../progression/ladder';
import { prescribe, type Prescription, unitOf } from '../progression/prescribe';
import { daysBetween } from '../time/trainingDate';
import type { BandCalibrationMap, Exercise, MuscleGroup } from '../types';
import { countsAsVolume, maxDirectSets, weeklyVolume } from '../volume/weekly';
import { phaseOf } from './block';
import { allowedCandidates, type EligibilityContext, slotByExercise } from './eligibility';
import { exerciseSeconds, planMinutes } from './estimate';
import type { DayReason, SkipReason } from './reasons';
import type {
  BlockState,
  DailyReadiness,
  PlannedExercise,
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
 * The plan for one day, SPEC §10.4. Deterministic: the same logs give the
 * same plan, which is what makes it testable and explainable.
 *
 * Every slot gets its block exercise and a chance; the ones that cannot
 * be trained today say why (sore, still recovering, at the weekly maximum,
 * …). The rest compete on how far their muscles are below target and how
 * long the slot has waited, and fill the time budget. A short day is
 * topped up with mobility. The result passes validatePlan like any plan.
 */
export function planDay(
  input: PlannerInput,
  cfg: PlannerConfig = PLANNER_CONFIG,
  training = TRAINING_CONFIG,
): SessionPlan {
  const { asOf, catalog, slots, block } = input;
  const slotOf = slotByExercise(slots);
  const past = input.sessions.filter((s) => s.date <= asOf);
  const layoff = layoffState(
    past.map((s) => s.date),
    asOf,
  );
  const signals = fatigueSignals({ asOf, sessions: past, catalog, slotOf, daily: input.daily });
  const phase = phaseOf(block, asOf);
  const deload = phase === 'deload';
  const today = input.daily.find((d) => d.date === asOf);
  const isSore = (e: Exercise) =>
    e.primaryMuscles.some(
      (m) => (today?.soreness?.[m] ?? 0) >= AUTOREGULATION_CONFIG.highSorenessLevel,
    );
  const lowReadiness =
    today !== undefined &&
    ((today.sleepHours !== null && today.sleepHours < cfg.lowReadiness.sleepHours) ||
      (today.energy !== null && today.energy <= cfg.lowReadiness.energy));

  // Direct sets: the research behind 3-6 counts sets aimed at the muscle
  // (SPEC §4.1), and half-sets from other exercises would let a squat's
  // core work crowd out every core exercise.
  const volume = weeklyVolume(
    past.flatMap((s) =>
      s.sets
        .filter((set) => !set.isWarmup)
        .map((set) => ({
          exerciseId: set.exerciseId,
          date: s.date,
          isWarmup: false,
          rir: set.rir,
        })),
    ),
    catalog,
    asOf,
    { ...training, secondaryMuscleWeight: 0 },
  );
  const { lastPrimary, lastSlot } = lastTrained(past, catalog, slotOf, training);

  const skipped: SkippedSlot[] = [];
  const candidates: Candidate[] = [];
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
    if (signals.includes('FATIGUE_HIGH') && ONE_LEGGED.has(exercise.stanceMechanics)) {
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
    if (isSore(exercise)) {
      skip('DOMS_HIGH');
      continue;
    }
    if (
      exercise.primaryMuscles.some((m) => {
        const last = lastPrimary[m];
        return last !== undefined && daysBetween(last, asOf) <= cfg.recoveryDays;
      })
    ) {
      skip('RECOVERING');
      continue;
    }

    const base = prescribe({
      exercise,
      slot,
      sessions: past,
      asOf,
      layoff,
      deload,
      calibrations: input.calibrations,
    });
    const reasons = [...base.reasons];
    let rir = base.rir;
    if (swapped) reasons.push('BILATERAL_SWAP');
    if (lowReadiness) {
      reasons.push('LOW_READINESS');
      rir = [Math.min(5, rir[0] + 1), Math.min(5, rir[1] + 1)];
    }
    candidates.push({ slot, exercise, prescription: { ...base, rir, reasons } });
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
  const setsWanted = deload
    ? Math.max(1, Math.round(cfg.setsPerExercise * BLOCK_CONFIG.deloadSetFactor))
    : cfg.setsPerExercise;
  const secondsOf = (c: Candidate, sets: number) =>
    exerciseSeconds({ ...c.prescription, sets, restSec: c.slot.restSec }, c.exercise, cfg);

  const picked: Picked[] = [];
  let seconds = 0;
  let remaining = [...candidates];
  while (picked.length < cfg.maxExercisesPerSession && seconds < cfg.sessionMinutes.target * 60) {
    let best: { c: Candidate; sets: number; secs: number; score: number } | null = null;
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
    picked.push({ ...best.c, sets: best.sets });
    remaining = remaining.filter((c) => c !== best!.c);
    seconds += best.secs;
    for (const m of best.c.exercise.primaryMuscles) added[m] += best.sets;
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
  const light: Picked[] = [];
  const inPlan = new Set(picked.map((p) => p.slot.id));
  const lightSlots = slots
    .filter((s) => s.lightFill && !inPlan.has(s.id))
    .sort((x, y) => staleness(y) - staleness(x));
  for (const slot of lightSlots) {
    const id = block.selections[slot.id];
    const exercise = id === undefined ? undefined : catalog[id];
    if (seconds >= minSeconds || !exercise || isSore(exercise)) continue;
    const rx = prescribe({ exercise, slot, sessions: past, asOf, layoff });
    const candidate: Candidate = {
      slot,
      exercise,
      prescription: {
        ...rx,
        target: rx.range[0],
        rir: [cfg.lightFillRir, cfg.lightFillRir],
        warmupSet: false,
        reasons: ['LIGHT_FILL'],
      },
    };
    seconds += secondsOf(candidate, cfg.fillerSets);
    light.push({ ...candidate, sets: cfg.fillerSets });
  }
  const mobility: Picked[] = [];
  for (const slot of slots.filter((s) => s.kind === 'filler')) {
    for (const exercise of allowedCandidates(slot, catalog, input.eligibility)) {
      if (seconds >= minSeconds) break;
      const candidate = { slot, exercise, prescription: mobilityPrescription(exercise, slot) };
      seconds += secondsOf(candidate, cfg.fillerSets);
      mobility.push({ ...candidate, sets: cfg.fillerSets });
    }
  }

  const ordered = orderAndLabel(picked, light, mobility);
  const validated = validatePlan(
    ordered,
    {
      catalog,
      eligibility: input.eligibility,
      slotOf,
      volume,
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
  if (deload) dayReasons.push('DELOAD_WEEK');
  if (layoff.tier === 'short') dayReasons.push('LAYOFF_SHORT');
  else if (layoff.tier === 'medium') dayReasons.push('LAYOFF_MEDIUM');
  else if (layoff.tier === 'long') dayReasons.push('LAYOFF_LONG');
  else if (layoff.recalibrating) dayReasons.push('LAYOFF_RECALIBRATION');
  if (lowReadiness) dayReasons.push('LOW_READINESS');
  if (hardSeconds < (cfg.sessionMinutes.min * 60) / 2) dayReasons.push('LIGHT_DAY');

  return {
    version: 1,
    date: asOf,
    blockIndex: block.index,
    phase,
    regions: regionsOf(validated.exercises, slotOf),
    bike: bikePrescription(input.rides, layoff),
    exercises: validated.exercises,
    skipped,
    dayReasons,
    signals,
    estimatedMinutes: planMinutes(validated.exercises, catalog, cfg),
    adjustments: validated.adjustments,
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
 * When each muscle last had working sets as a primary, and when each slot
 * was last trained. Light practice at RIR 5 is not training here either.
 */
function lastTrained(
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
 * mobility as one circuit each. The
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

  return groups.flatMap((group, g) =>
    group.map((p, i) => toPlanned(p, `${String.fromCharCode(65 + g)}${i + 1}`)),
  );
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
