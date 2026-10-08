import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { WEEK_CONFIG } from '../config/training';
import { addDays } from '../time/trainingDate';
import type { MuscleGroup } from '../types';
import type { PlanConstraint } from './constraints';

export const REPORT_KINDS = ['mild_doms', 'strong_doms', 'muscle_pain', 'joint_pain'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export interface PainAnswers {
  onset: 'during' | 'delayed' | 'unknown' | null;
  location: 'focal' | 'diffuse' | 'unknown' | null;
  movement: 'worse' | 'same' | 'better' | 'not_tried' | null;
}
export interface SorenessReport {
  kind: ReportKind | null;
  muscles: MuscleGroup[];
  /** Must be answered explicitly; unchecked is not the same as "none". */
  redFlags: boolean | null;
  pain: PainAnswers;
  days: number;
}
export function emptyReport(): SorenessReport {
  return {
    kind: null,
    muscles: [],
    redFlags: null,
    pain: { onset: null, location: null, movement: null },
    days: WEEK_CONFIG.requestDefaultDays.strongDoms,
  };
}

/** The lengths a restriction may be given, in days. */
export const REPORT_DAY_CHOICES: readonly number[] = Array.from(
  { length: WEEK_CONFIG.requestMaxDays },
  (_, i) => i + 1,
);

/** How long a restriction lasts unless the person picks another length. */
export function defaultReportDays(kind: ReportKind): number {
  return kind === 'muscle_pain'
    ? WEEK_CONFIG.requestDefaultDays.musclePain
    : WEEK_CONFIG.requestDefaultDays.strongDoms;
}

export type ReportDecision =
  | { kind: 'incomplete'; field: 'kind' | 'redFlags' | 'muscles' | 'pain' | 'days' }
  | { kind: 'medical'; reason: 'redFlags' | 'joint' }
  | { kind: 'mild'; muscles: MuscleGroup[] }
  | { kind: 'restriction'; constraint: Omit<PlanConstraint, 'id'>; strainSignals: boolean };

/**
 * E5, approved plan appendix D. Answers describe an episode, not a diagnosis.
 * All muscle pain uses the more conservative exclusion, even when it resembles
 * DOMS; no questionnaire can clear an injury. Durations are planner preferences,
 * not a claim about healing. Medical routes never yield a constraint to save.
 */
export function assessReport(report: SorenessReport, asOf: string): ReportDecision {
  if (report.redFlags === true) return { kind: 'medical', reason: 'redFlags' };
  if (report.kind === 'joint_pain') return { kind: 'medical', reason: 'joint' };
  if (report.kind === null || !REPORT_KINDS.includes(report.kind))
    return { kind: 'incomplete', field: 'kind' };
  if (report.redFlags !== false) return { kind: 'incomplete', field: 'redFlags' };
  if (report.muscles.length === 0 || report.muscles.some((m) => !MUSCLE_GROUPS.includes(m))) {
    return { kind: 'incomplete', field: 'muscles' };
  }
  const muscles = [...new Set(report.muscles)];
  if (report.kind === 'mild_doms') return { kind: 'mild', muscles };
  if (
    report.kind === 'muscle_pain' &&
    (report.pain.onset === null || report.pain.location === null || report.pain.movement === null)
  ) {
    return { kind: 'incomplete', field: 'pain' };
  }
  if (
    !Number.isInteger(report.days) ||
    report.days < 1 ||
    report.days > WEEK_CONFIG.requestMaxDays
  ) {
    return { kind: 'incomplete', field: 'days' };
  }
  return {
    kind: 'restriction',
    constraint: {
      kind: 'avoid_muscle',
      muscles,
      from: asOf,
      until: addDays(asOf, report.days - 1),
      reason: report.kind === 'muscle_pain' ? 'pain' : 'doms',
      source: 'user',
      note: null,
    },
    strainSignals:
      report.kind === 'muscle_pain' &&
      (report.pain.onset === 'during' ||
        report.pain.location === 'focal' ||
        report.pain.movement === 'worse'),
  };
}
