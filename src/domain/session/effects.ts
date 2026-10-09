import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { TRAINING_CONFIG } from '../config/training';
import { buildHistoryIndex, type HistoryIndex } from '../history';
import type { ExposureRecord } from '../observations/exposure';
import { isPerformed } from '../observations/qualify';
import { avoidedOn, isTrainingDay, TRAIN_DAILY } from '../plan/constraints';
import { DAY_CONFIG, painToday, weekWork } from '../plan/day';
import type { AuditDay } from '../plan/audit';
import { checkSelection } from '../plan/selectionGuard';
import type { PlannedExposure, PlannedSet, SessionPlan } from '../plan/plan';
import { phaseOf } from '../plan/block';
import { BASE_POLICY, resolveDayPolicy } from '../policy/dayPolicy';
import { finding, type AssessmentCheck } from '../policy/hardAdvice';
import { addDays, daysBetween } from '../time/trainingDate';
import type { MuscleGroup } from '../types';
import { countsAsVolume } from '../volume/weekly';
import type { ActiveSessionState, ChangeEffects, SessionChangeSnapshot } from './types';

export function remainingVolume(
  plan: Pick<SessionPlan, 'exposures'>,
  settled: ReadonlySet<string>,
  snap: SessionChangeSnapshot,
): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const e of plan.exposures) {
    const exercise = snap.catalog[e.exercise.id];
    if (exercise === undefined || !countsAsVolume(exercise)) continue;
    const n = e.sets
      .filter(
        (s) =>
          !settled.has(s.id) &&
          ['work', 'probe', 'backoff'].includes(s.role) &&
          (s.targetRir === null || s.targetRir.min <= TRAINING_CONFIG.workingSetMaxRir),
      )
      .reduce((sum, s) => sum + (s.side === 'left' || s.side === 'right' ? 0.5 : 1), 0);
    for (const m of exercise.primaryMuscles) out[m] = (out[m] ?? 0) + n;
  }
  return out;
}

export function assessmentDay(
  snap: SessionChangeSnapshot,
  records: readonly ExposureRecord[],
  maxSec: number,
): { day: AuditDay; idx: HistoryIndex; previous: HistoryIndex } {
  const policy = resolveDayPolicy(BASE_POLICY, snap.week, 'session_change', snap.preferences);
  const idx = buildHistoryIndex(records, snap.catalog, {
    muscleWeights: snap.preferences.muscleWeights,
  });
  const previous = buildHistoryIndex(
    records.filter((r) => r.trainingDate < snap.asOf),
    snap.catalog,
  );
  const today = snap.daily.find((d) => d.date === snap.asOf);
  const day: AuditDay = {
    date: snap.asOf,
    restDay: !isTrainingDay(snap.asOf, snap.week ?? TRAIN_DAILY, snap.constraints ?? []),
    avoided: avoidedOn(snap.constraints ?? [], snap.asOf),
    painMuscles: painToday(records, snap.asOf, snap.catalog),
    isSore: (e) => e.primaryMuscles.some((m) => (today?.soreness?.[m] ?? 0) >= 4),
    isRecovering: (e) =>
      e.primaryMuscles.some((m) => {
        const last = previous.lastPrimary[m];
        return last !== undefined && daysBetween(last, snap.asOf) <= policy.planner.recoveryDays;
      }),
    doneToday: Object.fromEntries(
      MUSCLE_GROUPS.map((m) => {
        const w = idx.muscleDay.get(snap.asOf)?.[m];
        return [m, (w?.certain ?? 0) + (w?.uncertain ?? 0)];
      }),
    ),
    week: weekWork(idx, snap.asOf),
    dayMax: DAY_CONFIG.maxDirectSetsPerMuscleDay,
    weekMax: (m) =>
      policy.training.maxDirectSetsOverride[m] ?? policy.training.weeklyWorkingSetsPerMuscle.max,
    sessionSecMax: maxSec,
    lastResistance: new Map(),
    deload: phaseOf(snap.block, snap.asOf) === 'deload',
  };
  return { day, idx, previous };
}

/** Forecast data stays explicitly projected; no observation or actual record is synthesized. */
export interface ProjectedExposure {
  kind: 'projected';
  trainingDate: string;
  exposure: PlannedExposure;
  sets: readonly PlannedSet[];
}

function tomorrowEffect(
  snap: SessionChangeSnapshot,
  records: readonly ExposureRecord[],
  before: SessionPlan,
  after: SessionPlan,
  settled: ReadonlySet<string>,
): ChangeEffects['tomorrow'] {
  const stored = snap.tomorrow;
  if (stored === null || stored.date !== addDays(snap.asOf, 1)) return null;
  const actual = buildHistoryIndex(records, snap.catalog);
  const actualWeek = weekWork(actual, stored.date);
  const facts = (plan: SessionPlan) => {
    const projected: ProjectedExposure[] = plan.exposures.map((e) => ({
      kind: 'projected',
      trainingDate: plan.trainingDate,
      exposure: e,
      sets: e.sets.filter((s) => !settled.has(s.id)),
    }));
    const pending = remainingVolume(
      { exposures: projected.map((p) => ({ ...p.exposure, sets: [...p.sets] })) },
      new Set(),
      snap,
    );
    const lastPrimary = { ...actual.lastPrimary };
    const volume = Object.fromEntries(
      MUSCLE_GROUPS.map((m) => {
        const planned = pending[m] ?? 0;
        if (planned > 0) lastPrimary[m] = plan.trainingDate;
        return [m, actualWeek[m].certain + actualWeek[m].uncertain + planned];
      }),
    ) as Record<MuscleGroup, number>;
    return { volume, lastPrimary };
  };
  const policy = resolveDayPolicy(BASE_POLICY, snap.week, 'auto_day');
  const check = (plan: SessionPlan) =>
    checkSelection(
      stored,
      { ...snap, asOf: stored.date },
      { ...policy.planner, maxDirectSetsPerMuscleDay: DAY_CONFIG.maxDirectSetsPerMuscleDay },
      policy.training,
      facts(plan),
    );
  const existing = new Set(check(before).map((v) => `${v.slotId}|${v.code}`));
  const changed = check(after).filter((v) => !existing.has(`${v.slotId}|${v.code}`));
  if (changed.length === 0) return null;
  return {
    date: stored.date,
    changedSlots: [
      ...new Set(
        changed.flatMap((v) =>
          v.slotId === null ? stored.items.map((i) => i.slotId) : [v.slotId],
        ),
      ),
    ],
    reasons: [...new Set(changed.map((v) => v.code))],
  };
}

export function changeEffects(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  records: readonly ExposureRecord[],
  settled: ReadonlySet<string>,
  plan: SessionPlan,
  day: AuditDay,
  previous: HistoryIndex,
  subject: PlannedExposure | null,
  beforeSec: number,
  afterSec: number,
  /** The change carries on an exposure already in the plan: it does not overlap with its own earlier sets. */
  continuing = false,
): { effects: ChangeEffects; checks: AssessmentCheck[] } {
  const volume = remainingVolume(plan, settled, snap);
  const checks: AssessmentCheck[] = [];
  const effects: ChangeEffects = {
    musclesToday: {},
    musclesWeek: {},
    recovery: {},
    overlapToday: [],
    time: {
      remainingBeforeSec: beforeSec,
      remainingAfterSec: afterSec,
      maxSec: day.sessionSecMax!,
    },
    progressionScope: subject?.progressionScope ?? 'none',
    tomorrow: tomorrowEffect(snap, records, session.plan, plan, settled),
  };
  const policy = resolveDayPolicy(BASE_POLICY, snap.week, 'session_change', snap.preferences);
  const today = snap.daily.find((d) => d.date === snap.asOf);
  const before = remainingVolume(session.plan, settled, snap);
  for (const m of MUSCLE_GROUPS) {
    const planned = volume[m] ?? 0;
    const done = day.doneToday[m] ?? 0;
    const week = day.week[m]!;
    const min = policy.training.weeklyWorkingSetsPerMuscle.min;
    effects.musclesToday[m] = {
      done,
      remainingPlanned: planned,
      after: done + planned,
      dayMax: day.dayMax,
    };
    effects.musclesWeek[m] = {
      ...week,
      after: week.certain + week.uncertain + planned,
      max: day.weekMax(m),
      min,
    };
    const last = previous.lastPrimary[m] ?? null;
    effects.recovery[m] = {
      lastPrimaryDate: last,
      daysAgo: last === null ? null : daysBetween(last, snap.asOf),
      soreness: today?.soreness?.[m] ?? null,
    };
    const from = week.certain + week.uncertain + (before[m] ?? 0);
    const to = week.certain + week.uncertain + planned;
    if (from < min && to > from)
      checks.push(finding('WEEK_MIN_HELPED', 'pass', { muscle: m, before: from, after: to, min }));
  }
  const exercise = subject === null ? undefined : snap.catalog[subject.exercise.id];
  if (exercise !== undefined && countsAsVolume(exercise)) {
    const seen = new Set<string>();
    for (const r of records) {
      if (
        r.trainingDate !== snap.asOf ||
        seen.has(r.exerciseId) ||
        (continuing && r.exerciseId === exercise.id) ||
        !(r.sets.some(isPerformed) || r.extra.some((o) => o.status === 'performed'))
      )
        continue;
      seen.add(r.exerciseId);
      const other = snap.catalog[r.exerciseId];
      if (other === undefined) continue;
      const shared = other.primaryMuscles.filter((m) => exercise.primaryMuscles.includes(m));
      const samePattern = other.movementPattern === exercise.movementPattern;
      if (!samePattern && shared.length < exercise.primaryMuscles.length / 2) continue;
      effects.overlapToday.push({ exerciseId: r.exerciseId, sharedPrimary: shared, samePattern });
      checks.push(
        finding('OVERLAP_TODAY', samePattern ? 'fail' : 'warn', {
          exerciseId: r.exerciseId,
          sharedPrimary: shared.join(','),
          samePattern,
        }),
      );
    }
  }
  if (effects.tomorrow !== null)
    checks.push(
      finding('HURTS_TOMORROW', 'warn', {
        date: effects.tomorrow.date,
        slots: effects.tomorrow.changedSlots.join(','),
        reasons: effects.tomorrow.reasons.join(','),
      }),
    );
  return { effects, checks };
}
