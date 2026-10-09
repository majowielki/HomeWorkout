/** Revise only pending sets. Existing ids and recipes, including a completed side, survive. */
import { compilePlannedSets, DEFAULT_TIMING, stampPlan } from '../plan/compile';
import type { CompileInput } from '../plan/compile';
import type { PlannedExposure, SessionPlan, TimeBreakdown } from '../plan/plan';
import type { ActiveSessionState, PatchOp } from './types';

export function settledSets(session: ActiveSessionState): ReadonlySet<string> {
  return new Set(
    session.records.flatMap((r) =>
      r.sets.filter((s) => s.disposition !== 'pending').map((s) => s.planned.id),
    ),
  );
}

export function startedExposures(session: ActiveSessionState): ReadonlySet<string> {
  return new Set(
    session.records
      .filter((r) =>
        r.sets.some((s) => s.disposition === 'performed' || s.disposition === 'interrupted'),
      )
      .map((r) => r.exposureId),
  );
}

export function setOrder(plan: SessionPlan): string[] {
  return plan.execution.steps.flatMap((s) => (s.kind === 'perform' ? [s.plannedSetId] : []));
}

export function revisionBase(
  plan: SessionPlan,
  modelOf: CompileInput['modelOf'],
): Omit<CompileInput, 'exposures'> & { snapshotFingerprint: string } {
  return {
    sessionId: plan.sessionId,
    planRevision: plan.planRevision + 1,
    kind: plan.kind,
    source: 'manual',
    trainingDate: plan.trainingDate,
    versions: plan.versions,
    inputFingerprint: plan.inputFingerprint,
    bikeSec: plan.time.bike,
    modelOf,
    snapshotFingerprint: plan.audit.snapshotFingerprint,
  };
}

export function revisePending(
  session: ActiveSessionState,
  ops: readonly PatchOp[],
  base: Omit<CompileInput, 'exposures'> & { snapshotFingerprint: string },
): { plan: SessionPlan; remainingSec: number } {
  const settled = settledSets(session);
  let exposures = session.plan.exposures.map((e) => ({ ...e, sets: [...e.sets] }));
  let order = setOrder(session.plan).filter((id) => !settled.has(id));
  for (const op of ops) {
    if (op.kind === 'insertExposure') {
      exposures.push(op.exposure);
      const added = op.exposure.sets.map((s) => s.id);
      order = op.position === 'next' ? [...added, ...order] : [...order, ...added];
    } else if (op.kind === 'appendSets') {
      const e = exposures.find((e) => e.id === op.exposureId)!;
      e.sets.push(...op.sets);
      const last = order.findLastIndex((id) => e.sets.some((s) => s.id === id));
      order.splice(last < 0 ? order.length : last + 1, 0, ...op.sets.map((s) => s.id));
    } else {
      if (op.setIds.some((id) => settled.has(id))) throw new Error('Cannot revise settled sets');
      const removed = new Set(op.setIds);
      const at = order.findIndex((id) => removed.has(id));
      order = order.filter((id) => !removed.has(id));
      exposures = exposures
        .map((e) => ({ ...e, sets: e.sets.filter((s) => !removed.has(s.id)) }))
        .filter((e) => e.sets.length > 0);
      if (op.kind === 'replaceRemaining') {
        exposures.push(op.exposure);
        order.splice(Math.max(0, at), 0, ...op.exposure.sets.map((s) => s.id));
      }
    }
  }
  const pending = compilePlannedSets(
    { ...base, bikeSec: 0, warmedExposureIds: startedExposures(session) },
    exposures,
    order,
  );
  const historicalOrder = setOrder(session.plan).filter((id) => settled.has(id));
  const historical = compilePlannedSets(base, exposures, historicalOrder);
  // Non-perform steps belong to the next set, except rest which belongs to the previous one.
  let nextSet: string | null = null;
  const historicalSteps = [...session.plan.execution.steps]
    .reverse()
    .filter((s) => {
      if (s.kind === 'perform') nextSet = s.plannedSetId;
      if (s.kind === 'rest') return settled.has(s.afterSetId);
      return nextSet !== null && settled.has(nextSet);
    })
    .reverse();
  const timing = base.timing ?? DEFAULT_TIMING;
  historical.time.rest = historicalSteps.reduce(
    (sum, s) => sum + (s.kind === 'rest' ? s.durationSec : 0),
    0,
  );
  historical.time.setup = historicalSteps.reduce(
    (sum, s) => sum + (s.kind === 'setup' ? s.estimatedSec : 0),
    0,
  );
  historical.time.transition = historicalSteps.reduce(
    (sum, s) => sum + (s.kind === 'transition' ? s.estimatedSec : 0),
    0,
  );
  historical.time.warmup +=
    (historicalSteps.filter((s) => s.kind === 'cue').length -
      historical.execution.steps.filter((s) => s.kind === 'cue').length) *
    timing.bandWarmupSec;
  historical.time.exerciseTotal =
    historical.time.hardWork +
    historical.time.practice +
    historical.time.mobility +
    historical.time.warmup +
    historical.time.rest +
    historical.time.setup +
    historical.time.transition;
  historical.time.overall = historical.time.exerciseTotal + historical.time.bike;
  const time = Object.fromEntries(
    Object.keys(historical.time).map((key) => {
      const k = key as keyof TimeBreakdown;
      return [k, historical.time[k] + pending.time[k]];
    }),
  ) as TimeBreakdown;
  // Retain completed steps and ids; new execution ids are namespaced by revision.
  const steps = [
    ...historicalSteps,
    ...pending.execution.steps.map((s) => ({ ...s, id: `r${base.planRevision}-${s.id}` })),
  ];
  const plan = stampPlan(
    { ...pending, exposures: exposures as PlannedExposure[], execution: { steps }, time },
    {
      mode: 'resume_session',
      snapshotFingerprint: base.snapshotFingerprint,
      overrides: [],
    },
  );
  return { plan, remainingSec: pending.time.exerciseTotal };
}
