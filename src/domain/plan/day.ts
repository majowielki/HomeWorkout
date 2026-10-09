/**
 * The day of the engine (engine, 04 §1-§4, 01 §3): the one place a
 * plan for a training day is made, whatever asked for it.
 *
 * Every slot of the block gets its exercise and a chance;
 * its exercise and a chance; the ones that cannot be trained today say why; the
 * rest compete for the time of the day on how far their muscles are below the
 * weekly target and how long the slot has waited; a short day is topped up with
 * light work and mobility. Planning uses these parts:
 *
 * - each exercise is prescribed by `prescribeNext` from what was really done,
 * - the number of sets is `recommendSets`, inside the room of the day, the week
 *   and the time,
 * - the choice is greedy with the gain of every addition worked out again after
 *   the last one, and its score is written out in named parts,
 * - the plan is compiled by `compileSession`, which is also what says how long
 *   an addition takes, so the choice and the plan cannot count time differently,
 * - and audited and, if need be, mended by `planWithRepair`.
 *
 * Deterministic: the same records and the same context give the same plan; ties
 * are broken by the order of the slots.
 */

import { repCapOf } from '../catalog/attributes';
import { buildVariantGraph, nextVariant } from '../catalog/variants';
import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { fatigueSignals } from '../autoregulation/signals';
import { PREFERENCE_CONFIG, SETS_CONFIG, type PlannerConfig } from '../config/training';
import { buildHistoryIndex, type HistoryIndex } from '../history';
import type { IsoDate } from '../observations/date';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed, referenceResistance } from '../observations/qualify';
import { BASE_POLICY, type PlanIntent, resolveDayPolicy } from '../policy/dayPolicy';
import { preferenceScore, type TrainingPreferences } from '../preferences/preferences';
import { type BikePrescription, bikePrescription, type Ride } from '../progression/bike';
import type { Draft } from '../progression/draft';
import { layoffState } from '../progression/layoff';
import { prescribeNext } from '../progression/next';
import { unitOf } from '../progression/prescribe';
import { DEFAULT_MODEL_CONTEXT, type ModelContext } from '../resistance/registry';
import type { ResistanceSpec } from '../resistance/types';
import { sideOrder } from '../session/sides';
import { daysBetween } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';
import type { AuditContext, AuditDay } from './audit';
import { phaseOf } from './block';
import {
  compileSession,
  type CompileInput,
  type ExposureSpec,
  type SetSpec,
  type SideMode,
} from './compile';
import {
  type PlanConstraint,
  avoidedOn,
  isAvoided,
  isLighterDay,
  isTrainingDay,
  TRAIN_DAILY,
  type TrainingWeek,
} from './constraints';
import {
  allowedCandidates,
  type EligibilityContext,
  isEligible,
  slotByExercise,
} from './eligibility';
import type { DecisionTrace, PlannedExposure, PlanVersions, SessionPlan } from './plan';
import type { DayReason, FatigueSignal, SkipReason } from './reasons';
import { type PlanningResult, planWithRepair } from './repair';
import { type ExerciseResistance, modelFor, resistanceOf } from './resistanceOf';
import { recommendSets, type SetsRecommendation } from './sets';
import type { BlockState, DailyReadiness, SkippedSlot, Slot, SlotRegion } from './types';

/** The numbers that differ between the engines and belong to the second one (12 §5.2, 04 §3). */
export const DAY_CONFIG = {
  /** Direct sets one muscle may get in a day: one full compound exposure. */
  maxDirectSetsPerMuscleDay: 3,
  /** The weight of a preference in the score, against 2 for a volume deficit (12 §4.3). */
  preferenceWeight: PREFERENCE_CONFIG.scoreWeight,
} as const;

export interface DayInput {
  asOf: IsoDate;
  intent?: PlanIntent;
  catalog: Readonly<Record<string, Exercise>>;
  slots: readonly Slot[];
  eligibility: EligibilityContext;
  /** Already advanced to `asOf`. */
  block: BlockState;
  /** Everything that was done, normalized: progression reads the primary ones, volume and recovery all of them. */
  records: readonly ExposureRecord[];
  rides: readonly Ride[];
  daily: readonly DailyReadiness[];
  constraints?: readonly PlanConstraint[];
  week?: TrainingWeek;
  preferences: TrainingPreferences;
  models?: ModelContext;
  /** What the person answered to what was proposed, by comparison key. */
  answers?: Readonly<Record<string, { stepUp?: 'yes' | 'no'; variantDownDeferredAt?: IsoDate }>>;
  /** For an extra session: only these slots, with at most these sets. */
  only?: readonly { slotId: string; sets?: number }[];
  session: {
    sessionId: string;
    planRevision: number;
    kind: 'main' | 'extra';
    versions: PlanVersions;
    snapshotFingerprint: string;
    inputFingerprint: string;
  };
  acknowledged?: readonly string[];
  /**
   * The choice made for this day earlier (the week keeps it firm, 04 §5): it stays while the day, planned
   * with these slots and numbers of sets, still passes the planner's rules; otherwise the day is chosen anew.
   */
  kept?: readonly KeptItem[];
}

/** What a day's choice is: which exercise trains in which slot, for how many sets. Loads are never part of it. */
export interface KeptItem {
  slotId: string;
  exerciseId: string;
  sets: number;
}

export interface DayOutput {
  result: PlanningResult;
  skipped: SkippedSlot[];
  dayReasons: DayReason[];
  signals: FatigueSignal[];
  phase: 'work' | 'deload';
  bike: BikePrescription;
  /** Regions of the hard work, most sets first — the title of the day. */
  regions: SlotRegion[];
  /** What the prescriptions put to the person: a harder or an easier variant, a step up to confirm. */
  proposals: { exerciseId: string; kind: string; to: string | null }[];
  /** The choice of the day, to be kept: its working exercises. Empty when there is no plan. */
  selection: KeptItem[];
  /** With a kept choice: it `held`, or the day was chosen anew (`changed`) and `keptViolations` say why. Null otherwise. */
  kept: 'held' | 'changed' | null;
  keptViolations: { slotId: string; reason: SkipReason }[];
}

interface Prepared {
  slot: Slot;
  exercise: Exercise;
  res: ExerciseResistance;
  /** The primary exposures before today. */
  history: readonly ExposureRecord[];
  scope: 'primary' | 'supplemental';
  order: number;
}

const ONE_LEGGED = new Set(['UnilateralSupported', 'UnilateralUnsupported']);

const sideModeOf = (e: Exercise): SideMode =>
  e.sides === 'perSet'
    ? 'per_set'
    : e.sides === 'alternating'
      ? 'alternating'
      : ONE_LEGGED.has(e.stanceMechanics)
        ? 'both'
        : 'bilateral';

const unitFor = (e: Exercise) => (unitOf(e) === 'sec' ? ('duration' as const) : ('reps' as const));

export function hasLowReadiness(
  today: DailyReadiness | undefined,
  cfg: Pick<PlannerConfig, 'lowReadiness'>,
): boolean {
  return (
    today !== undefined &&
    ((today.sleepHours !== null && today.sleepHours < cfg.lowReadiness.sleepHours) ||
      (today.energy !== null && today.energy <= cfg.lowReadiness.energy))
  );
}

const rangeOf = (p: Pick<Prepared, 'exercise' | 'slot'>) => {
  const r = (unitFor(p.exercise) === 'duration' ? p.slot.timeRange : p.slot.repRange) ?? [8, 15];
  return { lo: r[0], hi: r[1] };
};

/**
 * The working exercises of a plan as the choice that can be kept. The sets are the number the
 * planner was asked for, a probe set included: it takes one of them, so a day with a probe asks
 * for the same number again and holds.
 */
export function selectionOf(plan: SessionPlan): KeptItem[] {
  return plan.exposures
    .filter((e) => e.slotId !== null && e.sets.some((s) => s.role === 'work' || s.role === 'probe'))
    .map((e) => ({
      slotId: e.slotId!,
      exerciseId: e.exercise.id,
      sets: new Set(
        e.sets.filter((s) => s.role === 'work' || s.role === 'probe').map((s) => s.logicalSetId),
      ).size,
    }));
}

export function planDay(input: DayInput): DayOutput {
  if (input.kept === undefined) {
    return { ...planDayCore(input, null), kept: null, keptViolations: [] };
  }
  const keep = input.kept;
  if (keep.length === 0) {
    // A day kept with no working exercise (only light work) holds while the day still has none.
    const fresh = planDayCore(input, null);
    return {
      ...fresh,
      kept: fresh.selection.length === 0 ? 'held' : 'changed',
      keptViolations: [],
    };
  }
  const held = planDayCore(input, keep);
  const has = new Map(held.selection.map((k) => [k.slotId, k]));
  // A deload or a lighter day gives fewer sets of the same exercises: the choice holds, the sets follow the day.
  const eased = held.phase === 'deload' || isLighterDay(input.constraints ?? [], input.asOf);
  const lost = keep.filter((k) => {
    const found = has.get(k.slotId);
    return (
      found === undefined ||
      found.exerciseId !== k.exerciseId ||
      (found.sets !== k.sets && !(eased && found.sets < k.sets))
    );
  });
  if (lost.length === 0) return { ...held, kept: 'held', keptViolations: [] };
  const why = (k: KeptItem): SkipReason =>
    held.skipped.find((x) => x.slotId === k.slotId)?.reason ?? 'NOT_PICKED';
  return {
    ...planDayCore(input, null),
    kept: 'changed',
    keptViolations: lost.map((k) => ({ slotId: k.slotId, reason: why(k) })),
  };
}

function planDayCore(
  input: DayInput,
  keep: readonly KeptItem[] | null,
): Omit<DayOutput, 'kept' | 'keptViolations'> {
  const { asOf, catalog, slots, block, eligibility } = input;
  const policy = resolveDayPolicy(
    BASE_POLICY,
    input.week,
    input.intent ?? 'auto_day',
    input.preferences,
  );
  const cfg = policy.planner;
  const training = policy.training;
  const dayMax = DAY_CONFIG.maxDirectSetsPerMuscleDay;
  const models = input.models ?? DEFAULT_MODEL_CONTEXT;
  const constraints = input.constraints ?? [];
  const slotOf = slotByExercise(slots);
  const idx = buildHistoryIndex(input.records, catalog, {
    muscleWeights: input.preferences.muscleWeights,
  });

  // ---- the day as the planner reads it
  const done = input.records.filter((r) => r.sets.some(isPerformed) || r.extra.length > 0);
  const layoff = layoffState([...new Set(done.map((r) => r.trainingDate))], asOf);
  const modelOf = (spec: ResistanceSpec) => modelFor(spec, models);
  const signals = fatigueSignals({
    asOf,
    records: input.records,
    slotOf,
    daily: input.daily,
    modelOf,
  });
  const phase = phaseOf(block, asOf);
  const today = input.daily.find((d) => d.date === asOf);
  const lowReadiness = hasLowReadiness(today, cfg);
  const lighter = isLighterDay(constraints, asOf);
  const avoided = avoidedOn(constraints, asOf);
  const sore = (e: Exercise) => e.primaryMuscles.some((m) => (today?.soreness?.[m] ?? 0) >= 4);
  // Recovery is advice, also for what the person asked for (D18): it is left out unless they confirmed it.
  // Pain is a hard rule and says so itself: the audit finds it, so it is not hidden behind recovery.
  const recoveryConfirmed = (input.acknowledged ?? []).includes('RECOVERING');
  const hurting = painToday(input.records, asOf, catalog);
  const hurts = (e: Exercise) =>
    [...e.primaryMuscles, ...e.secondaryMuscles].some((m) => hurting.has(m));
  const recovering = (e: Exercise) =>
    e.primaryMuscles.some((m) => {
      const last = idx.lastPrimary[m];
      return last !== undefined && daysBetween(last, asOf) <= cfg.recoveryDays;
    });
  const week = weekWork(idx, asOf);
  const doneToday = Object.fromEntries(
    MUSCLE_GROUPS.map((m) => {
      const w = idx.muscleDay.get(asOf)?.[m];
      return [m, (w?.certain ?? 0) + (w?.uncertain ?? 0)];
    }),
  ) as Record<MuscleGroup, number>;
  const weekMax = (m: MuscleGroup) =>
    training.maxDirectSetsOverride[m] ?? training.weeklyWorkingSetsPerMuscle.max;
  const graph = buildVariantGraph(Object.values(catalog));
  const primaryToday = new Set(
    input.records
      .filter(
        (r) =>
          r.trainingDate === asOf && r.progressionScope === 'primary' && r.sets.some(isPerformed),
      )
      .map((r) => r.comparisonKey),
  );
  const likes = (e: Exercise) => preferenceScore(e, input.preferences);

  // ---- which slot trains which exercise today
  const skipped: SkippedSlot[] = [];
  const prepared: Prepared[] = [];
  const wanted = input.only === undefined ? null : new Set(input.only.map((o) => o.slotId));
  const keptSlots = keep === null ? null : new Set(keep.map((k) => k.slotId));
  slots.forEach((slot, order) => {
    if (slot.kind === 'filler' || (wanted !== null && !wanted.has(slot.id))) return;
    if (keptSlots !== null && !keptSlots.has(slot.id)) return;
    const selected = block.selections[slot.id];
    let exercise = selected === undefined ? undefined : catalog[selected];
    const skip = (reason: SkipReason) =>
      skipped.push({ slotId: slot.id, exerciseId: selected ?? null, reason });
    if (exercise === undefined || !isEligible(exercise, eligibility)) return skip('NO_CANDIDATE');
    if (signals.includes('FATIGUE_HIGH') && ONE_LEGGED.has(exercise.stanceMechanics)) {
      const twoLegged = allowedCandidates(slot, catalog, eligibility).find(
        (e) => !ONE_LEGGED.has(e.stanceMechanics),
      );
      if (twoLegged === undefined) return skip('FATIGUE_BILATERAL_ONLY');
      exercise = twoLegged;
    }
    const blocked: SkipReason | null = isAvoided(exercise, avoided)
      ? 'AVOIDED_BY_REQUEST'
      : sore(exercise)
        ? 'DOMS_HIGH'
        : !recoveryConfirmed && !hurts(exercise) && recovering(exercise)
          ? 'RECOVERING'
          : null;
    if (blocked !== null) return skip(blocked);
    const res = resistanceOf(exercise, slot, models);
    if (res === null) return skip('NO_CANDIDATE');
    prepared.push({
      slot,
      exercise,
      res,
      // What came before today: a second exposure of the day is the same recipe, not a step further.
      history: (idx.byKey.get(res.comparisonKey) ?? []).filter((r) => r.trainingDate < asOf),
      scope: primaryToday.has(res.comparisonKey) ? 'supplemental' : 'primary',
      order,
    });
  });

  // ---- the recipe of an exercise for a number of sets
  const memo = new Map<string, { draft: Draft; spec: ExposureSpec }>();
  const recipe = (p: Prepared, sets: SetsRecommendation) => {
    // Only recommendations with room reach the recipe builder.
    const key = `${p.slot.id}|${sets.recommended}|${sets.allowed![1]}`;
    const known = memo.get(key);
    if (known) return known;
    const { draft, trace } = prescribeNext({
      exerciseId: p.exercise.id,
      unit: unitFor(p.exercise),
      model: p.res.model,
      start: p.res.start,
      range: rangeOf(p),
      targetRir: { min: p.slot.rir[0], max: p.slot.rir[1] },
      repCap: repCapOf(p.exercise, eligibility.profile),
      history: p.history,
      asOf,
      layoff,
      phase,
      eligible: true,
      sets,
      variants: {
        harder:
          nextVariant(p.exercise.id, 'harder', graph, catalog, eligibility, likes)?.id ?? null,
        easier:
          nextVariant(p.exercise.id, 'easier', graph, catalog, eligibility, likes)?.id ?? null,
      },
      user: input.answers?.[p.res.comparisonKey],
    });
    const out = {
      draft,
      spec: prescriptionSpec(
        p,
        draft,
        trace,
        lowReadiness,
        eligibility.profile,
        input.session.versions,
      ),
    };
    memo.set(key, out);
    return out;
  };

  // ---- the choice: greedy, the gain of every addition worked out again after the last
  const targetSets = training.weeklyWorkingSetsPerMuscle.target;
  // A muscle only one slot can train weighs more than one four slots can: otherwise the many slots of
  // the common muscle use up the weekly maximum first and the rare one never reaches its target.
  const providers = new Map<MuscleGroup, number>();
  for (const p of prepared) {
    for (const m of p.exercise.primaryMuscles) providers.set(m, (providers.get(m) ?? 0) + 1);
  }
  const added = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  const weekDone = (m: MuscleGroup) => week[m].certain + week[m].uncertain;
  const daysAway = (slot: Slot) => {
    const last = idx.lastSlot[slot.id];
    return last === undefined ? Infinity : daysBetween(last, asOf);
  };
  const stale = (slot: Slot) =>
    Math.min(daysAway(slot), cfg.scoring.stalenessCapDays) / cfg.scoring.stalenessUnitDays;

  const base: Omit<CompileInput, 'exposures'> = {
    sessionId: input.session.sessionId,
    planRevision: input.session.planRevision,
    kind: input.session.kind,
    source: 'engine',
    trainingDate: asOf,
    versions: input.session.versions,
    inputFingerprint: input.session.inputFingerprint,
    bikeSec: 0,
    modelOf,
  };
  /** The exercises of a day as the compiler counts them. */
  const seconds = (specs: readonly ExposureSpec[]) =>
    compileSession({ ...base, exposures: specs.map((s, i) => ({ ...s, key: `e${i + 1}` })) }).time
      .exerciseTotal;

  const chosen: { p: Prepared; spec: ExposureSpec }[] = [];
  let used = 0;
  let remaining = [...prepared];
  const maxSec = cfg.sessionMinutes.max * 60;
  const room = (p: Prepared) => ({
    dayRoom: Object.fromEntries(
      p.exercise.primaryMuscles.map((m) => [m, dayMax - doneToday[m] - added[m]]),
    ),
    weekRoom: Object.fromEntries(
      p.exercise.primaryMuscles.map((m) => [m, weekMax(m) - weekDone(m) - added[m]]),
    ),
    fitsTime: (n: number) =>
      seconds([
        ...chosen.map((c) => c.spec),
        templateSpec(p, n, input.session.versions, eligibility.profile),
      ]) <= maxSec,
  });

  const limit = input.only === undefined ? cfg.maxExercisesPerSession : slots.length;
  const aim = input.only === undefined && keep === null ? cfg.sessionMinutes.target * 60 : Infinity;
  const proposals: DayOutput['proposals'] = [];
  while (chosen.length < limit && used < aim) {
    let best: {
      p: Prepared;
      spec: ExposureSpec;
      draft: Draft;
      score: number;
      scoreParts: { deficit: number; staleness: number; compound: number; preference: number };
      secs: number;
    } | null = null;
    for (const p of remaining) {
      const rec = recommendSets({
        kind: p.slot.kind,
        primaryMuscles: p.exercise.primaryMuscles,
        phase,
        lighterDay: lighter,
        room: room(p),
        preferences: input.preferences,
      });
      if (rec.allowed === null) continue;
      const asked =
        input.only?.find((o) => o.slotId === p.slot.id)?.sets ??
        keep?.find((k) => k.slotId === p.slot.id)?.sets;
      // A kept day follows the deload and the lighter day (the recommendation), an explicit number does not.
      const eased = keep !== null && (phase === 'deload' || lighter);
      const sets =
        asked === undefined
          ? rec
          : {
              ...rec,
              recommended: Math.min(asked, rec.allowed[1], eased ? rec.recommended : Infinity),
            };
      const { draft, spec } = recipe(p, sets);
      if (draft.resistance === null || draft.sets === 0) continue;
      const n = spec.sets.length;
      const needs = p.exercise.primaryMuscles.map((m) =>
        Math.max(0, targetSets - weekDone(m) - added[m]),
      );
      // Worth doing: a muscle below its target, or a slot that has waited too long.
      if (
        input.only === undefined &&
        keep === null &&
        !needs.some((x) => x > 0) &&
        daysAway(p.slot) < cfg.forceStaleDays
      ) {
        continue;
      }
      const total = seconds([...chosen.map((c) => c.spec), spec]);
      if (total > maxSec) continue;
      // The score, in parts: the need of the muscles it covers (in sets, capped by the need and shared
      // between the slots that can train the muscle), the wait of the slot (in weeks), the bonus of a
      // compound lift, and the person's preference.
      const coverage = p.exercise.primaryMuscles.reduce(
        (sum, m, i) => sum + Math.min(n, needs[i]!) / providers.get(m)!,
        0,
      );
      const scoreParts = {
        deficit: cfg.scoring.deficitWeight * coverage,
        staleness: stale(p.slot),
        compound: p.slot.kind === 'compound' ? cfg.scoring.compoundBonus : 0,
        preference: DAY_CONFIG.preferenceWeight * likes(p.exercise),
      };
      const score = Object.values(scoreParts).reduce((sum, part) => sum + part, 0);
      if (best === null || score > best.score || (score === best.score && p.order < best.p.order)) {
        best = { p, spec, draft, score, scoreParts, secs: total - used };
      }
    }
    if (best === null) break;
    const pick = best;
    chosen.push({
      p: pick.p,
      spec: {
        ...pick.spec,
        trace: {
          ...pick.spec.trace,
          evidence: {
            ...pick.spec.trace.evidence,
            selection: { ...pick.scoreParts, total: pick.score, addedSec: pick.secs },
          },
        },
      },
    });
    remaining = remaining.filter((r) => r !== pick.p);
    used += pick.secs;
    for (const m of pick.p.exercise.primaryMuscles) added[m] += pick.spec.sets.length;
    for (const proposal of pick.draft.proposals) {
      proposals.push({
        exerciseId: pick.p.exercise.id,
        kind: proposal.kind,
        to: typeof proposal.to === 'string' ? proposal.to : null,
      });
    }
  }
  for (const p of remaining) {
    const weekRoom = Math.min(
      ...p.exercise.primaryMuscles.map((m) => weekMax(m) - weekDone(m) - added[m]),
    );
    const dayRoom = Math.min(
      ...p.exercise.primaryMuscles.map((m) => dayMax - doneToday[m] - added[m]),
    );
    const needed = p.exercise.primaryMuscles.some((m) => targetSets - weekDone(m) - added[m] > 0);
    skipped.push({
      slotId: p.slot.id,
      exerciseId: p.exercise.id,
      reason:
        weekRoom < 1
          ? 'VOLUME_AT_MAX'
          : dayRoom < 1
            ? 'ALREADY_TODAY'
            : !needed && input.only === undefined
              ? 'VOLUME_ON_TARGET'
              : 'NOT_PICKED',
    });
  }
  const hardSeconds = used;

  // ---- a short day is topped up: light practice of the slots that waited, then mobility
  const specs: ExposureSpec[] = chosen.map((c) => c.spec);
  const minSec = cfg.sessionMinutes.min * 60;
  if (input.only === undefined) {
    let total = used;
    const inPlan = new Set(chosen.map((c) => c.p.slot.id));
    const light = slots
      .filter((s) => s.lightFill && !inPlan.has(s.id))
      .sort((x, y) => stale(y) - stale(x));
    for (const slot of light) {
      const id = block.selections[slot.id];
      const exercise = id === undefined ? undefined : catalog[id];
      if (
        total >= minSec ||
        exercise === undefined ||
        sore(exercise) ||
        isAvoided(exercise, avoided)
      ) {
        continue;
      }
      const res = resistanceOf(exercise, slot, models);
      if (res === null) continue;
      specs.push(
        fillerSpec(
          exercise,
          slot,
          res,
          'practice',
          cfg.lightFillRir,
          input.session.versions,
          eligibility.profile,
        ),
      );
      total = seconds(specs);
    }
    for (const slot of slots.filter((s) => s.kind === 'filler')) {
      for (const exercise of allowedCandidates(slot, catalog, eligibility)) {
        if (total >= minSec) break;
        if (isAvoided(exercise, avoided)) continue;
        const res = resistanceOf(exercise, slot, models);
        if (res === null) continue;
        specs.push(
          fillerSpec(
            exercise,
            slot,
            res,
            'mobility',
            null,
            input.session.versions,
            eligibility.profile,
          ),
        );
        total = seconds(specs);
      }
    }
  }

  // ---- order and group, then compile, audit and mend
  const ordered = labelled(specs, slots);
  const bike = bikePrescription(input.rides, layoff);
  const auditDay: AuditDay = {
    date: asOf,
    restDay:
      input.session.kind === 'main' && !isTrainingDay(asOf, input.week ?? TRAIN_DAILY, constraints),
    avoided,
    painMuscles: hurting,
    isSore: sore,
    isRecovering: recovering,
    doneToday,
    week,
    dayMax,
    weekMax,
    sessionSecMax: maxSec,
    lastResistance: lastResistances(prepared),
    deload: phase === 'deload',
  };
  const ctx: AuditContext = { mode: 'new_plan', catalog, eligibility, modelOf, day: auditDay };
  const result = planWithRepair(ordered, { ...base, bikeSec: bike.minutes * 60 }, ctx, {
    acknowledged: input.acknowledged,
    snapshotFingerprint: input.session.snapshotFingerprint,
  });

  const dayReasons: DayReason[] = [];
  if (done.length === 0) dayReasons.push('FIRST_DAY');
  if (phase === 'deload') dayReasons.push('DELOAD_WEEK');
  if (layoff.tier === 'short') dayReasons.push('LAYOFF_SHORT');
  else if (layoff.tier === 'medium') dayReasons.push('LAYOFF_MEDIUM');
  else if (layoff.tier === 'long') dayReasons.push('LAYOFF_LONG');
  else if (layoff.recalibrating) dayReasons.push('LAYOFF_RECALIBRATION');
  if (lowReadiness) dayReasons.push('LOW_READINESS');
  if (input.only === undefined && hardSeconds < minSec / 2) dayReasons.push('LIGHT_DAY');
  if (lighter) dayReasons.push('LIGHTER_DAY_REQUESTED');

  const exposures =
    result.kind === 'ready' || result.kind === 'adjusted' ? result.plan.exposures : [];
  const plannedIds = new Set(exposures.map((e) => e.exercise.id));

  return {
    result,
    skipped,
    dayReasons,
    signals,
    phase,
    bike,
    regions: regionsOf(exposures, new Map(slots.map((s) => [s.id, s]))),
    proposals: proposals.filter((p) => plannedIds.has(p.exerciseId)),
    selection:
      result.kind === 'ready' || result.kind === 'adjusted' ? selectionOf(result.plan) : [],
  };
}

/** The work of each muscle in the seven days ending on `asOf`: what is known to be hard, and what nobody said. */
export function weekWork(idx: HistoryIndex, asOf: string) {
  const out = Object.fromEntries(
    MUSCLE_GROUPS.map((m) => [m, { certain: 0, uncertain: 0 }]),
  ) as Record<MuscleGroup, { certain: number; uncertain: number }>;
  for (const [date, work] of idx.muscleDay) {
    const age = daysBetween(date, asOf);
    if (age < 0 || age >= 7) continue;
    for (const m of MUSCLE_GROUPS) {
      out[m].certain += work[m].certain;
      out[m].uncertain += work[m].uncertain;
    }
  }
  return out;
}

/** The muscles a set done today was cut short by pain in. */
export function painToday(
  records: readonly ExposureRecord[],
  asOf: string,
  catalog: Readonly<Record<string, Exercise>>,
): ReadonlySet<MuscleGroup> {
  const out = new Set<MuscleGroup>();
  for (const r of records) {
    if (r.trainingDate !== asOf) continue;
    const hurt =
      r.sets.some((s) => s.observation?.shortfall === 'pain') ||
      r.extra.some((o) => o.shortfall === 'pain');
    const exercise = catalog[r.exerciseId];
    if (hurt && exercise !== undefined)
      for (const m of [...exercise.primaryMuscles, ...exercise.secondaryMuscles]) out.add(m);
  }
  return out;
}

/** Where each comparison key was last done, for the audit of a jump in the resistance. */
function lastResistances(prepared: readonly Prepared[]): ReadonlyMap<string, ResistanceSpec> {
  const out = new Map<string, ResistanceSpec>();
  for (const p of prepared) {
    const last = p.history[p.history.length - 1];
    const at = last === undefined ? null : referenceResistance(last, p.res.model);
    if (at !== null) out.set(p.res.comparisonKey, at);
  }
  return out;
}

function baseSpec(
  p: Pick<Prepared, 'exercise' | 'slot' | 'res' | 'scope'>,
  versions: PlanVersions,
  profile: EligibilityContext['profile'],
): Omit<ExposureSpec, 'sets' | 'trace'> {
  const mode = sideModeOf(p.exercise);
  const first = mode === 'per_set' ? sideOrder(p.exercise, profile)?.[0] : undefined;
  return {
    key: p.slot.id.replace(/[^A-Za-z0-9_-]/g, '-'),
    slotId: p.slot.id,
    exercise: {
      id: p.exercise.id,
      definitionRevision: versions.catalog,
      displayName: p.exercise.name,
    },
    comparisonKey: p.res.comparisonKey,
    scope: p.scope,
    policy: { id: 'reps_then_resistance', version: '2' },
    unit: unitFor(p.exercise),
    sideMode: mode,
    ...(first === 'right' ? { firstSide: 'right' as const } : {}),
    group: null,
    bandWarmup: p.exercise.equipment.includes('band'),
  };
}

/** A recipe of `n` plain sets, only to say how long an exposure of that many sets would take. */
function templateSpec(
  p: Prepared,
  n: number,
  versions: PlanVersions,
  profile: EligibilityContext['profile'],
): ExposureSpec {
  const range = rangeOf(p);
  return {
    ...baseSpec(p, versions, profile),
    sets: Array.from({ length: n }, () => ({
      role: 'work' as const,
      resistance: p.res.start,
      lo: range.lo,
      target: range.hi,
      hi: range.hi,
      targetRir: null,
      restAfterSec: p.slot.restSec,
      required: true,
    })),
    trace: {
      schemaVersion: 1,
      decision: 'estimate',
      code: 'FILLER',
      policy: { id: 'reps_then_resistance', version: '2' },
      evidence: {},
      estimate: null,
    },
  };
}

/** The recipe of the draft as the compiler takes it: a probe first, then the working sets. */
export function prescriptionSpec(
  p: Pick<Prepared, 'exercise' | 'slot' | 'res' | 'scope'>,
  draft: Draft,
  trace: DecisionTrace,
  lowReadiness: boolean,
  profile: EligibilityContext['profile'],
  versions: PlanVersions,
): ExposureSpec {
  const rir =
    draft.targetRir === null || !lowReadiness
      ? draft.targetRir
      : { min: Math.min(5, draft.targetRir.min + 1), max: Math.min(5, draft.targetRir.max + 1) };
  const { lo, hi } = draft.range;
  const sets: SetSpec[] = [];
  if (draft.probe !== null) {
    sets.push({
      role: 'probe',
      resistance: draft.probe.resistance,
      lo,
      target: draft.probe.target,
      hi,
      targetRir: rir,
      restAfterSec: p.slot.restSec,
      required: false,
    });
  }
  for (const target of draft.targets) {
    sets.push({
      role: 'work',
      resistance: draft.resistance!,
      lo,
      target,
      hi,
      targetRir: rir,
      restAfterSec: p.slot.restSec,
      required: true,
    });
  }
  return { ...baseSpec(p, versions, profile), sets, trace };
}

/** Light practice or mobility that fills a short day: not a working set, never judged by the progression. */
export function fillerSpec(
  exercise: Exercise,
  slot: Slot,
  res: ExerciseResistance,
  role: 'practice' | 'mobility',
  rir: number | null,
  versions: PlanVersions,
  profile: EligibilityContext['profile'],
): ExposureSpec {
  const { lo, hi } = rangeOf({ exercise, slot });
  return {
    ...baseSpec({ exercise, slot, res, scope: 'primary' }, versions, profile),
    scope: 'none',
    filler: true,
    sets: Array.from({ length: SETS_CONFIG.byKind.filler }, () => ({
      role,
      resistance: res.start,
      lo,
      target: lo,
      hi,
      targetRir: rir === null ? { min: slot.rir[0], max: slot.rir[1] } : { min: rir, max: rir },
      restAfterSec: slot.restSec,
      required: false,
    })),
    trace: {
      schemaVersion: 1,
      decision: 'filler',
      code: 'FILLER',
      policy: { id: 'reps_then_resistance', version: '2' },
      evidence: { role },
      estimate: null,
    },
  };
}

/**
 * Compounds first, lower body paired with upper body as supersets, then
 * accessories and core in pairs, then the light work and the mobility as one
 * circuit each; no exercise is left alone while another has none
 * (Documents/PLAN-TYGODNIA-I-POPRAWKI.md, Q-5). The groups drive the compiler,
 * which does a group round by round. Keys follow the final order.
 */
function labelled(specs: readonly ExposureSpec[], slots: readonly Slot[]): ExposureSpec[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const work = specs.filter((s) => s.filler !== true);
  const fillers = specs.filter((s) => s.filler === true);
  const slotOfSpec = (s: ExposureSpec) => slotById.get(s.slotId!)!;
  const byKind = (kind: Slot['kind']) => work.filter((s) => slotOfSpec(s).kind === kind);
  const lower = byKind('compound').filter((s) => slotOfSpec(s).region === 'lower');
  const upper = byKind('compound').filter((s) => slotOfSpec(s).region !== 'lower');
  const compounds: ExposureSpec[] = [];
  for (let i = 0; i < Math.max(lower.length, upper.length); i += 1) {
    if (lower[i]) compounds.push(lower[i]!);
    if (upper[i]) compounds.push(upper[i]!);
  }
  const groups: ExposureSpec[][] = [];
  const take = (
    items: readonly ExposureSpec[],
    pairable: (a: ExposureSpec, b: ExposureSpec) => boolean,
  ) => {
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
  take(
    compounds,
    (a, b) => (slotOfSpec(a).region === 'lower') !== (slotOfSpec(b).region === 'lower'),
  );
  take(byKind('accessory'), () => true);
  take(byKind('core'), () => true);
  const practice = fillers.filter((s) => s.sets[0]?.role === 'practice');
  const mobility = fillers.filter((s) => s.sets[0]?.role === 'mobility');
  if (practice.length > 0) groups.push([...practice]);
  if (mobility.length > 0) groups.push([...mobility]);

  return withoutLoners(groups)
    .flatMap((group, g) =>
      group.map((spec) => ({
        ...spec,
        group: group.length > 1 ? String.fromCharCode(65 + g) : null,
      })),
    )
    .map((spec, i) => ({ ...spec, key: `e${i + 1}` }));
}

/** A lone exercise would run its sets back to back; neighbouring loners pair up, an odd one out joins the group before it. */
function withoutLoners<T>(groups: readonly T[][]): T[][] {
  const out: T[][] = [];
  let loner: T | null = null;
  for (const group of groups) {
    if (group.length === 1) {
      if (loner !== null) {
        out.push([loner, group[0]!]);
        loner = null;
      } else {
        loner = group[0]!;
      }
      continue;
    }
    const next = [...group];
    if (loner !== null) {
      if (out.length > 0) out[out.length - 1]!.push(loner);
      else next.unshift(loner);
      loner = null;
    }
    out.push(next);
  }
  if (loner !== null) {
    if (out.length > 0) out[out.length - 1]!.push(loner);
    else out.push([loner]);
  }
  return out;
}

export function regionsOf(
  exposures: readonly PlannedExposure[],
  slotById: ReadonlyMap<string, Slot>,
): SlotRegion[] {
  const sets = new Map<SlotRegion, number>();
  for (const e of exposures) {
    const hard = e.sets.filter(
      (s) => s.role === 'work' || s.role === 'probe' || s.role === 'backoff',
    );
    if (hard.length === 0) continue;
    const region = slotById.get(e.slotId!)!.region;
    const logical = new Set(hard.map((s) => s.logicalSetId)).size;
    sets.set(region, (sets.get(region) ?? 0) + logical);
  }
  return [...sets.entries()].sort((a, b) => b[1] - a[1]).map(([region]) => region);
}
