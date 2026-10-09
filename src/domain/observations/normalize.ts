/**
 * From plans, results, skips and the person's remarks to the exposures the
 * progression reads (engine, 13 §3).
 *
 * The plan is what decides what a result is *for*. Every planned set gets
 * exactly what belongs to it — a current result, a skip, or nothing — and
 * nothing is invented to fill a gap: a set with no result and no skip stays
 * without one, and a closed session reads it as skipped only for the count.
 * Results that do not belong to any planned set are not dropped: if they are
 * technically sound they are work (`extra`), and what is wrong with them is
 * reported as a problem with the id of the record.
 */

import { compareCodePoints } from '../fingerprint';
import type { SessionPlan } from '../plan/plan';
import type { ExposureRecord, ExposureSetRecord } from './exposure';
import type { SetDisposition, SetObservation } from './types';

export interface SessionMeta {
  sessionId: string;
  trainingDate: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  /** The session was planned in a deload week. */
  deload: boolean;
  /** Exposures the person shortened on request during the session (D26). */
  reducedExposures: readonly string[];
}

/** A stored result: the observation, and whether it has been taken back. */
export interface ObservationRow extends SetObservation {
  deletedAt: string | null;
}

export interface FeelReport {
  sessionId: string;
  /** Null: the whole session. */
  exposureId: string | null;
  feel: 'too_hard' | 'too_easy';
  channel: 'touch' | 'voice' | 'ai_proposal';
  at: string;
}

export type NormalizationProblemCode =
  'UNKNOWN_SESSION' | 'UNKNOWN_PLANNED_SET' | 'DUPLICATE_OBSERVATION' | 'UNIT_MISMATCH';

export interface NormalizationProblem {
  code: NormalizationProblemCode;
  /** The id of the observation or disposition it is about. */
  recordId: string;
  detail: string;
  /** The session the record belongs to; null when that cannot be told. */
  sessionId: string | null;
}

export interface NormalizationInput {
  sessions: readonly SessionMeta[];
  plans: readonly SessionPlan[];
  observations: readonly ObservationRow[];
  dispositions: readonly (SetDisposition & { sessionId?: string })[];
  feel: readonly FeelReport[];
}

const newer = (a: ObservationRow, b: ObservationRow) =>
  a.revision !== b.revision
    ? a.revision - b.revision
    : compareCodePoints(a.recordedAt, b.recordedAt);

export function normalizeObservations(input: NormalizationInput): {
  records: ExposureRecord[];
  problems: NormalizationProblem[];
  /** Sound work that belongs to no exposure of any plan: still work for the volume, evidence for nothing. */
  unassigned: SetObservation[];
} {
  const problems: NormalizationProblem[] = [];
  const meta = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const planned = new Map<string, { plan: SessionPlan; exposureIndex: number; setIndex: number }>();
  for (const plan of input.plans) {
    plan.exposures.forEach((exposure, exposureIndex) =>
      exposure.sets.forEach((set, setIndex) =>
        planned.set(set.id, { plan, exposureIndex, setIndex }),
      ),
    );
  }

  // 1. The current result of every set: the highest revision, and none that was taken back.
  const current = new Map<string, ObservationRow>();
  const extraBySession = new Map<string, SetObservation[]>();
  const addExtra = (o: ObservationRow) => {
    extraBySession.set(o.sessionId, [...(extraBySession.get(o.sessionId) ?? []), stripRow(o)]);
  };
  // The highest revision of each observation: a correction replaces the earlier one, and if the
  // newest is a take-back the result is gone — the older revisions do not come back in its place.
  const latest = new Map<string, ObservationRow>();
  for (const o of input.observations) {
    const known = latest.get(o.id);
    if (!known || newer(known, o) < 0) latest.set(o.id, o);
  }
  for (const o of [...latest.values()].filter((r) => r.deletedAt === null).sort(newer)) {
    if (!meta.has(o.sessionId)) {
      problems.push({
        code: 'UNKNOWN_SESSION',
        recordId: o.id,
        detail: o.sessionId,
        sessionId: o.sessionId,
      });
      continue;
    }
    if (o.plannedSetId === null) {
      addExtra(o);
      continue;
    }
    const home = planned.get(o.plannedSetId);
    if (home === undefined || home.plan.sessionId !== o.sessionId) {
      problems.push({
        code: 'UNKNOWN_PLANNED_SET',
        recordId: o.id,
        detail: o.plannedSetId,
        sessionId: o.sessionId,
      });
      addExtra(o);
      continue;
    }
    const set = home.plan.exposures[home.exposureIndex]!.sets[home.setIndex]!;
    const quantity = o.amount.value;
    if (quantity !== null && quantity.kind !== set.target.kind) {
      problems.push({
        code: 'UNIT_MISMATCH',
        recordId: o.id,
        detail: `${quantity.kind} recorded for a ${set.target.kind} target`,
        sessionId: o.sessionId,
      });
      addExtra(o);
      continue;
    }
    const earlier = current.get(o.plannedSetId);
    if (earlier !== undefined) {
      problems.push({
        code: 'DUPLICATE_OBSERVATION',
        recordId: earlier.id,
        detail: `${o.plannedSetId} also has ${o.id}`,
        sessionId: o.sessionId,
      });
      addExtra(earlier);
    }
    current.set(o.plannedSetId, o);
  }

  // 2. A skip, one per set: the last one stated.
  const skips = new Map<string, SetDisposition>();
  for (const d of [...input.dispositions].sort((a, b) => compareCodePoints(a.at, b.at))) {
    if (!planned.has(d.plannedSetId)) {
      problems.push({
        code: 'UNKNOWN_PLANNED_SET',
        recordId: d.plannedSetId,
        detail: d.commandId,
        sessionId: d.sessionId ?? null,
      });
      continue;
    }
    skips.set(d.plannedSetId, d);
  }

  // 3. What the person said about how it felt: the last report of the exposure, else of the session.
  const feelOf = (sessionId: string, exposureId: string): 'too_hard' | 'too_easy' | null => {
    const mine = input.feel
      .filter(
        (f) => f.sessionId === sessionId && (f.exposureId === exposureId || f.exposureId === null),
      )
      .sort((a, b) => compareCodePoints(a.at, b.at));
    const specific = mine.filter((f) => f.exposureId === exposureId);
    return (specific.at(-1) ?? mine.at(-1))?.feel ?? null;
  };

  // 4. The records, in the order of the plans.
  const records: ExposureRecord[] = [];
  for (const plan of input.plans) {
    const session = meta.get(plan.sessionId);
    if (session === undefined) {
      problems.push({
        code: 'UNKNOWN_SESSION',
        recordId: plan.sessionId,
        detail: 'plan without a session',
        sessionId: plan.sessionId,
      });
      continue;
    }
    for (const exposure of plan.exposures) {
      const sets: ExposureSetRecord[] = exposure.sets.map((planned) => {
        const observation = current.get(planned.id) ?? null;
        const skip = skips.get(planned.id);
        const disposition = observation
          ? observation.status
          : skip
            ? 'skipped'
            : session.status === 'in_progress'
              ? 'pending'
              : 'skipped';
        return { planned, disposition, observation };
      });
      records.push({
        exposureId: exposure.id,
        sessionId: plan.sessionId,
        trainingDate: session.trainingDate,
        exerciseId: exposure.exercise.id,
        slotId: exposure.slotId,
        comparisonKey: exposure.comparisonKey,
        progressionScope: exposure.progressionScope,
        sets,
        extra: (extraBySession.get(plan.sessionId) ?? []).filter(
          (o) => o.exposureId === exposure.id,
        ),
        context: {
          abandoned: session.status === 'abandoned',
          userReduced: session.reducedExposures.includes(exposure.id),
          feel: feelOf(plan.sessionId, exposure.id),
          deload: session.deload,
        },
      });
    }
  }
  const exposures = new Set(records.map((r) => r.exposureId));
  const unassigned = [...extraBySession.values()]
    .flat()
    .filter((o) => o.exposureId === null || !exposures.has(o.exposureId));
  return { records, problems, unassigned };
}

function stripRow(o: ObservationRow): SetObservation {
  const { deletedAt: _deletedAt, ...observation } = o;
  return observation;
}
