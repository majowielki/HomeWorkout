/**
 * The running session and the engine's assessment of a change, cut down to what the model may
 * be told (contract 7, 11 §8). Pure: the phone reads the database and hands the domain objects
 * over, a test builds them. What goes out is codes, ids and figures the engine computed; the
 * only words in it are catalogue names. Words the person typed (the query of an exercise the
 * catalogue does not know) stay on the phone.
 */
import type { z } from 'zod';

import { MUSCLE_GROUPS } from '../../domain/coach/vocabulary';
import { DAY_V2_CONFIG } from '../../domain/plan/dayV2';
import type { PlannedSet } from '../../domain/plan/planV2';
import { remainingVolume } from '../../domain/session/effects';
import { sessionOverview } from '../../domain/session/overview';
import { settledSets } from '../../domain/session/revision';
import type {
  ActiveSessionState,
  ChangeAssessment,
  PrescriptionSummary,
  SessionChangeEvaluation,
  SessionChangeSnapshot,
} from '../../domain/session/types';
import type { Exercise, MuscleGroup } from '../../domain/types';
import {
  type ActiveSessionSummary,
  type AssessmentSummary,
  SESSION_LIMITS,
  type workSummarySchema,
} from '../contract/sessionTools';

type Catalog = Readonly<Record<string, Pick<Exercise, 'id' | 'name' | 'primaryMuscles'>>>;

const ref = (catalog: Catalog, id: string) => ({ id, name: catalog[id]?.name ?? id });

/** The muscles that have had work today or have some left to do, with the daily maximum beside them. */
export function musclesTodaySummary(
  doneToday: Readonly<Partial<Record<MuscleGroup, number>>>,
  remaining: Readonly<Partial<Record<MuscleGroup, number>>>,
): ActiveSessionSummary['musclesToday'] {
  return MUSCLE_GROUPS.map((muscle) => ({
    muscle,
    done: Math.round(doneToday[muscle] ?? 0),
    remainingPlanned: Math.round(remaining[muscle] ?? 0),
    dayMax: DAY_V2_CONFIG.maxDirectSetsPerMuscleDay,
  }))
    .filter((m) => m.done > 0 || m.remainingPlanned > 0)
    .slice(0, SESSION_LIMITS.musclesShown);
}

export function activeSessionSummary(
  session: ActiveSessionState,
  snap: SessionChangeSnapshot,
): ActiveSessionSummary {
  const { remainingSec, doneToday } = sessionOverview(snap, session);
  const records = new Map(session.records.map((r) => [r.exposureId, r]));
  const remaining = remainingVolume(session.plan, settledSets(session), snap);
  return {
    sessionId: session.plan.sessionId,
    planRevision: session.plan.planRevision,
    trainingDate: session.plan.trainingDate,
    exposures: session.plan.exposures.slice(0, SESSION_LIMITS.exposuresShown).map((e) => {
      const sets = records.get(e.id)?.sets ?? [];
      const count = (...states: string[]) =>
        sets.filter((s) => states.includes(s.disposition)).length;
      return {
        exposureId: e.id,
        exercise: ref(snap.catalog, e.exercise.id),
        sets: {
          done: count('performed', 'interrupted'),
          // A planned set that has no record yet is pending too.
          pending: Math.max(0, e.sets.length - sets.length) + count('pending'),
          skipped: count('skipped'),
        },
        muscles: snap.catalog[e.exercise.id]?.primaryMuscles ?? [],
      };
    }),
    musclesToday: musclesTodaySummary(doneToday, remaining),
    timeRemainingSec: Math.round(remainingSec),
  };
}

type Work = z.infer<typeof workSummarySchema>;

function workOf(set: Pick<PlannedSet, 'resistance' | 'target'>): Work {
  const grams = (set.resistance.value as { massGrams?: unknown }).massGrams;
  const massKg = typeof grams === 'number' && grams > 0 ? Math.round(grams) / 1000 : null;
  const t = set.target;
  return {
    sets: 1,
    massKg,
    target:
      t.kind === 'reps'
        ? { kind: 'reps', min: t.min, max: t.max, perSide: t.count === 'per_side' }
        : t.kind === 'duration'
          ? { kind: 'duration', minSec: t.minSec, maxSec: t.maxSec }
          : { kind: 'distance', meters: t.targetMeters },
  };
}

function prescriptionOf(catalog: Catalog, p: PrescriptionSummary) {
  const work: Work[] = [];
  for (const set of p.perSet) {
    const one = workOf(set);
    const same = work.find(
      (w) => JSON.stringify({ ...w, sets: 0 }) === JSON.stringify({ ...one, sets: 0 }),
    );
    if (same) same.sets += 1;
    else work.push(one);
  }
  return {
    exercise: ref(catalog, p.exerciseId),
    sets: p.sets,
    work: work.slice(0, SESSION_LIMITS.workShown),
  };
}

/** Only the figures of a check: what the person typed is never among them. */
const WITHHELD = new Set(['query', 'message', 'path']);

function checkData(data: Record<string, number | string | boolean | null>) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !WITHHELD.has(key))
      .slice(0, SESSION_LIMITS.dataKeys)
      .map(([key, value]) => [
        key.slice(0, 32),
        typeof value === 'string' ? value.slice(0, SESSION_LIMITS.dataChars) : value,
      ]),
  );
}

const trimmedChecks = (checks: SessionChangeEvaluation['checks']) =>
  checks.slice(0, SESSION_LIMITS.checksShown).map((c) => ({
    code: c.code,
    class: c.class,
    status: c.status,
    data: checkData(c.data),
  }));

export function assessmentSummary(a: ChangeAssessment, catalog: Catalog): AssessmentSummary {
  const resolved: AssessmentSummary['resolved'] =
    a.resolved.kind === 'exercise'
      ? { kind: 'exercise', exercise: ref(catalog, a.resolved.exerciseId) }
      : a.resolved.kind === 'ambiguous'
        ? {
            kind: 'ambiguous',
            candidates: a.resolved.candidates
              .slice(0, SESSION_LIMITS.candidatesShown)
              .map((c) => ({ id: c.exerciseId, name: c.name })),
          }
        : a.resolved.kind === 'not_found'
          ? {
              kind: 'not_found',
              nearest: a.resolved.nearest
                .slice(0, SESSION_LIMITS.nearestShown)
                .map((c) => ({ id: c.exerciseId, name: c.name })),
            }
          : { kind: 'not_applicable' };
  const chosen = new Set(a.feel?.recommendedOptionIds ?? []);
  return {
    assessmentId: a.assessmentId,
    patchId: a.patch?.patchId ?? null,
    verdict: a.verdict,
    resolved,
    checks: trimmedChecks(a.checks),
    recommendation:
      a.recommendation === null
        ? null
        : {
            sets: {
              recommended: a.recommendation.sets.recommended,
              allowed: a.recommendation.sets.allowed,
              advisable: a.recommendation.sets.advisable,
              reasons: a.recommendation.sets.reasons,
            },
            placement: a.recommendation.position,
          },
    prescription: a.prescription === null ? null : prescriptionOf(catalog, a.prescription),
    alternatives: a.alternatives.slice(0, SESSION_LIMITS.alternativesShown).map((alt) => ({
      exercise: ref(catalog, alt.exerciseId),
      why: alt.why,
      verdict: alt.verdict,
      assessmentId: alt.assessment.assessmentId,
      patchId: alt.patchId,
      sets: alt.prescription.sets,
    })),
    feelOptions:
      a.feel === undefined
        ? null
        : a.feel.options.slice(0, 3).map((o) => ({
            why: o.why,
            verdict: o.assessment.verdict,
            assessmentId: o.change === null ? null : o.assessment.assessmentId,
            patchId: o.assessment.patch?.patchId ?? null,
            recommended: chosen.has(o.id),
          })),
    time: {
      remainingAfterSec: Math.max(0, Math.round(a.effects.time.remainingAfterSec)),
      maxSec: Math.max(0, Math.round(a.effects.time.maxSec)),
    },
  };
}
