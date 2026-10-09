/** P4b.2: read-only, offline assessment of an explicit change, using the shared resume audit. */
import { repCapOf } from '../catalog/attributes';
import { resolveExerciseRef } from '../catalog/resolve';
import { buildVariantGraph } from '../catalog/variants';
import { fingerprint } from '../fingerprint';
import { isPerformed, referenceResistance } from '../observations/qualify';
import { auditPlan } from '../plan/audit';
import { phaseOfV2 } from '../plan/blockV2';
import { compileSession, compilePlannedSets } from '../plan/compile';
import { isLighterDay } from '../plan/constraints';
import { fillerSpec, hasLowReadiness, prescriptionSpec } from '../plan/dayV2';
import { slotByExercise } from '../plan/eligibility';
import { logicalSetId, parseExposureId, plannedSetId } from '../plan/ids';
import type { PlannedExposure, PlannedSet } from '../plan/planV2';
import { modelFor, resistanceOf } from '../plan/resistanceOf';
import { recommendSets } from '../plan/sets';
import { BASE_POLICY, resolveDayPolicy } from '../policy/dayPolicy';
import { finding, sortChecks, verdictOf, type AssessmentCheck } from '../policy/hardAdvice';
import { layoffState } from '../progression/layoff';
import { prescribeNext } from '../progression/next';
import { unitOf } from '../progression/prescribe';
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { assessmentDay, changeEffects, remainingVolume } from './effects';
import { revisePending, revisionBase, setOrder, settledSets, startedExposures } from './revision';
import type {
  ActiveSessionState,
  SessionChangeEvaluation,
  PatchOp,
  SessionChange,
  SessionChangeSnapshot,
} from './types';

export function evaluateSessionChange(
  snap: SessionChangeSnapshot,
  session: ActiveSessionState,
  change: SessionChange,
): SessionChangeEvaluation {
  const plan = session.plan;
  const basedOn = {
    sessionId: plan.sessionId,
    planRevision: plan.planRevision,
    historyRevision: snap.historyRevision,
    prefsRevision: snap.prefsRevision,
  };
  const assessmentId = fingerprint({
    basedOn,
    snapshot: snap.session.snapshotFingerprint,
    plan,
    actual: session.records,
    change: Object.fromEntries(
      Object.entries(change).map(([key, value]) => [
        key,
        typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
      ]),
    ),
  });
  const models = snap.models ?? DEFAULT_MODEL_CONTEXT;
  const modelOf = (spec: PlannedSet['resistance']) => modelFor(spec, models);
  const base = {
    ...revisionBase(plan, modelOf),
    versions: snap.session.versions,
    inputFingerprint: snap.session.inputFingerprint,
    snapshotFingerprint: snap.session.snapshotFingerprint,
  };
  const settled = settledSets(session);
  const original = auditPlan(plan, {
    mode: 'resume_session',
    catalog: snap.catalog,
    eligibility: snap.eligibility,
    modelOf,
    settled,
  });
  const integrity =
    original.kind === 'invalid'
      ? original.issues.filter((i) => i.code === 'PLAN_INVALID' || i.code === 'PLAN_INTEGRITY')
      : [];
  const unsupported = plan.exposures.some((e) => e.sets.some((s) => s.target.kind === 'distance'));
  if (integrity.length > 0 || unsupported) {
    return {
      assessmentId,
      basedOn,
      verdict: 'blocked',
      resolved: { kind: 'not_applicable' },
      checks: sortChecks([
        ...integrity,
        ...(unsupported
          ? [finding('UNSUPPORTED_CAPABILITY', 'fail', { capability: 'distance execution' })]
          : []),
      ]),
      effects: {
        musclesToday: {},
        musclesWeek: {},
        recovery: {},
        overlapToday: [],
        time: { remainingBeforeSec: 0, remainingAfterSec: 0, maxSec: 0 },
        progressionScope: 'none',
        tomorrow: null,
      },
      recommendation: null,
      prescription: null,
      patch: null,
    };
  }
  const order = setOrder(plan).filter((id) => !settled.has(id));
  const beforeSec = compilePlannedSets(
    { ...base, bikeSec: 0, warmedExposureIds: startedExposures(session) },
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
    { ...base, bikeSec: 0 },
    plan.exposures,
    setOrder(plan).filter((id) => spent.has(id)),
  ).time.exerciseTotal;
  const maxSec = Math.max(0, policy.planner.sessionMinutes.max * 60 - elapsedSec);
  // The active state replaces any older copy of this session in the snapshot.
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
  const checks: AssessmentCheck[] = [];
  const ops: PatchOp[] = [];
  let subject: PlannedExposure | null = null;
  let recommendation: SessionChangeEvaluation['recommendation'] = null;
  let resolved: SessionChangeEvaluation['resolved'] = { kind: 'not_applicable' };
  const position = change.kind === 'add_exercise' ? (change.position ?? 'next') : 'next';
  const target =
    'exposureId' in change ? plan.exposures.find((e) => e.id === change.exposureId) : undefined;
  if ('exposureId' in change && change.exposureId !== null && target === undefined)
    checks.push(
      finding('PLAN_INVALID', 'fail', {
        exposureId: change.exposureId,
        reason: 'unknown exposure',
      }),
    );
  if (snap.asOf !== plan.trainingDate)
    checks.push(finding('PLAN_INVALID', 'fail', { reason: 'training date mismatch' }));
  const invalidCount = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      checks.push(
        finding('TECHNICAL_LIMIT', 'fail', { what, value: Number.isFinite(n) ? n : null }),
      );
      return true;
    }
    return false;
  };
  const pending = (e: PlannedExposure) => e.sets.filter((s) => !settled.has(s.id));

  if ('exercise' in change) {
    resolved = resolveExerciseRef(change.exercise, snap.catalog, snap.lexicon);
    if (resolved.kind === 'not_found')
      checks.push(finding('NOT_IN_CATALOG', 'fail', { query: resolved.query }));
    if (resolved.kind === 'exercise') {
      const exercise = snap.catalog[resolved.exerciseId]!;
      const slot = slotByExercise(snap.slots).get(exercise.id);
      const res = slot === undefined ? null : resistanceOf(exercise, slot, models);
      if (slot === undefined)
        checks.push(
          finding('RECIPE_INCOMPLETE', 'fail', {
            exerciseId: exercise.id,
            reason: 'no slot recipe',
          }),
        );
      else if (res === null)
        checks.push(finding('UNSUPPORTED_CAPABILITY', 'fail', { exerciseId: exercise.id }));
      if (
        slot !== undefined &&
        res !== null &&
        !checks.some((c) => c.class === 'hard' && c.status === 'fail')
      ) {
        const swapping = change.kind === 'swap_remaining';
        const oldSets = swapping ? pending(target!) : [];
        const phase = phaseOfV2(snap.block, snap.asOf);
        const mobility = exercise.movementPattern === 'Mobility';
        const muscles = mobility ? [] : exercise.primaryMuscles;
        const hasPrimary =
          records.some(
            (r) =>
              r.trainingDate === snap.asOf &&
              r.comparisonKey === res.comparisonKey &&
              r.progressionScope === 'primary' &&
              (r.sets.some(isPerformed) || r.extra.some((o) => o.status === 'performed')),
          ) ||
          plan.exposures.some(
            (e) =>
              e.comparisonKey === res.comparisonKey &&
              e.progressionScope === 'primary' &&
              (!swapping || e.id !== target!.id),
          );
        const scope = hasPrimary ? 'supplemental' : 'primary';
        const range = (unitOf(exercise) === 'sec' ? slot.timeRange : slot.repRange) ?? [8, 15];
        const history = (idx.byKey.get(res.comparisonKey) ?? []).filter(
          (r) => r.trainingDate < snap.asOf,
        );
        const layoff = layoffState(
          records
            .filter(
              (r) => r.sets.some(isPerformed) || r.extra.some((o) => o.status === 'performed'),
            )
            .map((r) => r.trainingDate),
          snap.asOf,
        );
        const make = (n: number) => {
          const sets = {
            recommended: n,
            allowed: [1, n] as [number, number],
            advisable: [1, 10] as [number, number],
            reasons: [],
          };
          const { draft, trace } = prescribeNext({
            exerciseId: exercise.id,
            unit: unitOf(exercise) === 'sec' ? 'duration' : 'reps',
            model: res.model,
            start: res.start,
            range: { lo: range[0]!, hi: range[1]! },
            targetRir: { min: slot.rir[0], max: slot.rir[1] },
            repCap: repCapOf(exercise, snap.eligibility.profile),
            history,
            asOf: snap.asOf,
            layoff,
            phase,
            eligible: true,
            sets,
            user: snap.answers?.[res.comparisonKey],
          });
          // An explicit count is preserved even when the automatic deload recipe recommends fewer.
          let rx = prescriptionSpec(
            { exercise, slot, res, scope },
            {
              ...draft,
              sets: n,
              probe: n >= 2 ? draft.probe : null,
              targets: Array.from(
                { length: n - (n >= 2 && draft.probe !== null ? 1 : 0) },
                (_, i) => draft.targets[Math.min(i, draft.targets.length - 1)]!,
              ),
            },
            trace,
            hasLowReadiness(
              snap.daily.find((d) => d.date === snap.asOf),
              policy.planner,
            ),
            snap.eligibility.profile,
            snap.session.versions,
          );
          if (mobility) {
            const fill = fillerSpec(
              exercise,
              slot,
              res,
              'mobility',
              null,
              snap.session.versions,
              snap.eligibility.profile,
            );
            rx = { ...fill, sets: Array.from({ length: n }, () => ({ ...fill.sets[0]! })) };
          }
          return compileSession({
            ...base,
            exposures: [{ ...rx, key: `change${base.planRevision}` }],
            bikeSec: 0,
          }).exposures[0]!;
        };
        const keptPlan = swapping
          ? revisePending(
              session,
              [{ kind: 'dropSets', exposureId: target!.id, setIds: oldSets.map((s) => s.id) }],
              base,
            ).plan
          : plan;
        const volume = remainingVolume(keptPlan, settled, snap);
        const rec = recommendSets({
          kind: slot.kind,
          primaryMuscles: muscles,
          phase,
          lighterDay: isLighterDay(snap.constraints ?? [], snap.asOf),
          preferences: snap.preferences,
          room: {
            dayRoom: Object.fromEntries(
              muscles.map((m) => [m, day.dayMax - day.doneToday[m]! - (volume[m] ?? 0)]),
            ),
            weekRoom: Object.fromEntries(
              muscles.map((m) => [
                m,
                day.weekMax(m) - day.week[m]!.certain - day.week[m]!.uncertain - (volume[m] ?? 0),
              ]),
            ),
            fitsTime: (n) => {
              const e = make(n);
              const op: PatchOp = swapping
                ? {
                    kind: 'replaceRemaining',
                    exposureId: target!.id,
                    setIds: oldSets.map((s) => s.id),
                    exposure: e,
                  }
                : {
                    kind: 'insertExposure',
                    exposure: e,
                    position,
                  };
              return revisePending(session, [op], base).remainingSec <= maxSec;
            },
          },
        });
        recommendation = {
          sets: rec,
          position,
        };
        const n = swapping
          ? new Set(oldSets.map((s) => s.logicalSetId)).size
          : (change.sets ??
            (rec.recommended ||
              recommendSets({
                kind: slot.kind,
                primaryMuscles: exercise.primaryMuscles,
                phase,
                preferences: snap.preferences,
                room: { dayRoom: {}, weekRoom: {} },
              }).recommended));
        if (swapping && n === 0)
          checks.push(finding('PLAN_INVALID', 'fail', { reason: 'no pending sets' }));
        else if (!invalidCount(n, 'sets')) {
          subject = make(n);
          if (
            swapping &&
            buildVariantGraph(Object.values(snap.catalog))
              .easier.get(target!.exercise.id)
              ?.includes(exercise.id)
          ) {
            subject.trace = {
              ...subject.trace,
              evidence: { ...subject.trace.evidence, reducedFrom: target!.id },
            };
          }
          ops.push(
            swapping
              ? {
                  kind: 'replaceRemaining',
                  exposureId: target!.id,
                  setIds: oldSets.map((s) => s.id),
                  exposure: subject,
                }
              : { kind: 'insertExposure', exposure: subject, position: recommendation.position },
          );
          if (phase === 'deload' && n > rec.recommended)
            checks.push(
              finding('DELOAD_WORK_OVER_POLICY', 'fail', {
                requested: n,
                recommended: rec.recommended,
              }),
            );
        }
      }
    }
  } else if (target !== undefined) {
    const open = pending(target);
    if (change.kind === 'add_sets') {
      if (!invalidCount(change.sets, 'added sets')) {
        const lastOrdinal = Math.max(...target.sets.map((s) => s.ordinal));
        const logical = new Set(target.sets.map((s) => s.logicalSetId)).size;
        if (logical + change.sets > 10)
          checks.push(
            finding('TECHNICAL_LIMIT', 'fail', { what: 'sets', sets: logical + change.sets }),
          );
        else {
          const last = target.sets.filter((s) => s.ordinal === lastOrdinal);
          const key = parseExposureId(target.id)!.exposureKey;
          const sets = Array.from({ length: change.sets }, (_, i) =>
            last.map((s) => {
              const parts = {
                sessionId: plan.sessionId,
                planRevision: base.planRevision,
                exposureKey: key,
                ordinal: lastOrdinal + i + 1,
              };
              return {
                ...s,
                id: plannedSetId({
                  ...parts,
                  side: s.side === 'left' || s.side === 'right' ? s.side : null,
                }),
                logicalSetId: logicalSetId(parts),
                ordinal: parts.ordinal,
                requiredForProgression: false,
              };
            }),
          ).flat();
          ops.push({ kind: 'appendSets', exposureId: target.id, sets });
          subject = { ...target, sets, progressionScope: 'supplemental' };
          checks.push(finding('SUPPLEMENTAL_ONLY', 'pass', { exerciseId: target.exercise.id }));
        }
      }
    } else if (change.kind !== 'feel') {
      if (open.length === 0)
        checks.push(finding('PLAN_INVALID', 'fail', { reason: 'no pending sets' }));
      else if (change.kind === 'skip_remaining')
        ops.push({ kind: 'skipRemaining', exposureId: target.id, setIds: open.map((s) => s.id) });
      else {
        const drop = change.dropSets ?? (change.easier ? 0 : 1);
        if (drop === 0 && !change.easier) {
          checks.push(finding('PLAN_INVALID', 'fail', { reason: 'empty reduction' }));
        } else if (drop !== 0 && invalidCount(drop, 'drop sets')) {
          /* finding already recorded */
        } else {
          const incomplete = new Set(
            target.sets.filter((s) => settled.has(s.id)).map((s) => s.logicalSetId),
          );
          const droppable = [
            ...new Set(
              open.filter((s) => !incomplete.has(s.logicalSetId)).map((s) => s.logicalSetId),
            ),
          ];
          if (drop > droppable.length)
            checks.push(
              finding('PLAN_INVALID', 'fail', {
                reason: 'cannot drop completed side or more than pending',
                requested: drop,
                available: droppable.length,
              }),
            );
          else {
            const ids = new Set(droppable.slice(droppable.length - drop));
            const removed = open.filter((s) => ids.has(s.logicalSetId));
            if (removed.length > 0)
              ops.push({
                kind: 'dropSets',
                exposureId: target.id,
                setIds: removed.map((s) => s.id),
              });
            if (change.easier) {
              const kept = open.filter((s) => !ids.has(s.logicalSetId));
              const replacements: PlannedSet[] = [];
              const key = parseExposureId(target.id)!.exposureKey;
              const newKey = `easier${base.planRevision}`;
              for (const s of kept) {
                const model = modelOf(s.resistance);
                const lower = model?.nextEasier(s.resistance.value);
                if (lower === null || lower === undefined) {
                  checks.push(
                    finding('RESISTANCE_UNREACHABLE', 'fail', {
                      reason: 'no easier resistance',
                      plannedSetId: s.id,
                    }),
                  );
                  break;
                }
                const parts = {
                  sessionId: plan.sessionId,
                  planRevision: base.planRevision,
                  exposureKey: newKey,
                  ordinal: s.ordinal,
                };
                replacements.push({
                  ...s,
                  id: plannedSetId({
                    ...parts,
                    side: s.side === 'left' || s.side === 'right' ? s.side : null,
                  }),
                  logicalSetId: logicalSetId(parts),
                  comparisonGroupId: `${plan.sessionId}/r${base.planRevision}/${newKey}/${s.role}`,
                  resistance: { ...s.resistance, value: lower.value },
                });
              }
              if (replacements.length > 0) {
                subject = {
                  ...target,
                  id: `${plan.sessionId}/r${base.planRevision}/${newKey}`,
                  sets: replacements,
                  progressionScope: target.sets.some((s) => settled.has(s.id))
                    ? 'supplemental'
                    : target.progressionScope,
                  trace: {
                    ...target.trace,
                    evidence: { ...target.trace.evidence, reducedFrom: key },
                  },
                };
                ops.push({
                  kind: 'replaceRemaining',
                  exposureId: target.id,
                  setIds: kept.map((s) => s.id),
                  exposure: subject,
                });
              }
            }
          }
        }
      }
    }
  }

  const changed = revisePending(session, ops, base);
  const audit = auditPlan(changed.plan, {
    mode: 'resume_session',
    catalog: snap.catalog,
    eligibility: snap.eligibility,
    modelOf,
    day,
    settled,
    remainingSec: changed.remainingSec,
  });
  checks.push(
    ...(audit.kind === 'invalid' ? [...audit.issues, ...audit.notes] : audit.notes).map(
      ({ code, class: ruleClass, status, data }) => ({ code, class: ruleClass, status, data }),
    ),
  );
  const extra = changeEffects(
    snap,
    session,
    records,
    settled,
    changed.plan,
    day,
    previous,
    subject,
    beforeSec,
    changed.remainingSec,
    target !== undefined && change.kind !== 'swap_remaining',
  );
  checks.push(...extra.checks);
  const sorted = sortChecks(checks);
  const verdict = verdictOf(sorted, { ambiguous: resolved.kind === 'ambiguous' });
  const patch =
    change.kind === 'feel' || verdict === 'blocked' || verdict === 'needs_clarification'
      ? null
      : {
          patchId: fingerprint({ assessmentId, ops, plan: changed.plan }),
          basePlanRevision: plan.planRevision,
          ops,
          plan: changed.plan,
        };
  return {
    assessmentId,
    basedOn,
    verdict,
    resolved,
    checks: sorted,
    effects: extra.effects,
    recommendation,
    prescription:
      subject === null
        ? null
        : {
            exerciseId: subject.exercise.id,
            sets: new Set(subject.sets.map((s) => s.logicalSetId)).size,
            perSet: subject.sets.map(({ resistance, target, targetRir }) => ({
              resistance,
              target,
              targetRir,
            })),
            reasons: [subject.trace.code],
          },
    patch,
  };
}
