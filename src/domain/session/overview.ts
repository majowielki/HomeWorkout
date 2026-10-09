/** What the session under way has used and has left: its time, and the sets each muscle has had today. */
import { isPerformed, referenceResistance } from '../observations/qualify';
import { compilePlannedSets } from '../plan/compile';
import type { PlannedSet } from '../plan/plan';
import { modelFor } from '../plan/resistanceOf';
import { BASE_POLICY, resolveDayPolicy } from '../policy/dayPolicy';
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { assessmentDay } from './effects';
import { revisionBase, setOrder, settledSets, startedExposures } from './revision';
import type { ActiveSessionState, SessionChangeSnapshot } from './types';

type Base = ReturnType<typeof revisionBase>;

/**
 * The time of the sets still to do, the seconds left of the session's budget, the records of the
 * day (this session replacing any older copy of itself in the snapshot) and the day as the audit reads it.
 */
export function sessionBudget(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  base: Base & Record<string, unknown>,
  modelOf: (spec: PlannedSet['resistance']) => ReturnType<typeof modelFor>,
) {
  const plan = session.plan;
  const settled = settledSets(session);
  const order = setOrder(plan).filter((id) => !settled.has(id));
  const beforeSec = compilePlannedSets(
    { ...base, bikeSec: 0, warmedExposureIds: startedExposures(session) } as Parameters<
      typeof compilePlannedSets
    >[0],
    plan.exposures,
    order,
  ).time.exerciseTotal;
  const policy = resolveDayPolicy(BASE_POLICY, snap.week, 'session_change');
  const spent = new Set(
    session.records.flatMap((r) =>
      r.sets
        .filter((s) => s.disposition === 'performed' || s.disposition === 'interrupted')
        .map((s) => s.planned.id),
    ),
  );
  const elapsedSec = compilePlannedSets(
    { ...base, bikeSec: 0 } as Parameters<typeof compilePlannedSets>[0],
    plan.exposures,
    setOrder(plan).filter((id) => spent.has(id)),
  ).time.exerciseTotal;
  const maxSec = Math.max(0, policy.planner.sessionMinutes.max * 60 - elapsedSec);
  const records = [
    ...snap.records.filter((r) => r.sessionId !== plan.sessionId && r.trainingDate <= snap.asOf),
    ...session.records,
  ];
  const { day, idx, previous } = assessmentDay(snap, records, maxSec);
  for (const [key, history] of previous.byKey) {
    const last = history.at(-1)!;
    const set = last.sets.find(isPerformed);
    if (set === undefined) continue;
    const model = modelOf(set.planned.resistance);
    if (model === null) continue;
    const at = referenceResistance(last, model);
    if (at !== null) (day.lastResistance as Map<string, PlannedSet['resistance']>).set(key, at);
  }
  return { settled, beforeSec, maxSec, records, day, idx, previous, policy };
}

/** The session as the model is told about it: seconds left and the sets done today per muscle. */
export function sessionOverview(snap: SessionChangeSnapshot, session: ActiveSessionState) {
  const models = snap.models ?? DEFAULT_MODEL_CONTEXT;
  const modelOf = (spec: PlannedSet['resistance']) => modelFor(spec, models);
  const base = {
    ...revisionBase(session.plan, modelOf),
    versions: snap.session.versions,
    inputFingerprint: snap.session.inputFingerprint,
    snapshotFingerprint: snap.session.snapshotFingerprint,
  };
  const budget = sessionBudget(snap, session, base, modelOf);
  return {
    remainingSec: budget.beforeSec,
    maxSec: budget.maxSec,
    doneToday: budget.day.doneToday,
  };
}
