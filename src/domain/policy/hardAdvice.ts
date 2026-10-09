/**
 * Which rules block and which only advise (engine v2, D18, 12 §2, 11 §3).
 *
 * The engine recommends and does not refuse what can be done. A rule is
 * either `hard` — safety, pain, equipment, the person's own "do not suggest":
 * nothing is planned against it, and a request against it is blocked — or
 * `advice` — volume, recovery, time: the planner never breaks it on its own,
 * but a request that does is *advised against* with the numbers, and carried
 * out if the person confirms (D19). `info` rules never get in the way.
 *
 * One table, read by the planner, the audit, the in-session assessment and
 * the AI, so a rule cannot be hard in one place and advice in another.
 * Changing a class is a change of policy version.
 */

export type RuleClass = 'hard' | 'advice' | 'info';

export const RULE_CLASS = {
  // ---- hard: nothing is planned against them, a request against them is blocked
  NOT_IN_CATALOG: 'hard',
  DRAFT_ONLY: 'hard',
  MEDICAL_EXCLUSION: 'hard',
  MISSING_CLASSIFICATION: 'hard',
  PAIN_TODAY: 'hard',
  AVOIDED_BY_REQUEST: 'hard',
  REST_DAY: 'hard',
  USER_EXCLUDED: 'hard',
  EQUIPMENT_UNAVAILABLE: 'hard',
  UNSUPPORTED_CAPABILITY: 'hard',
  RESISTANCE_UNREACHABLE: 'hard',
  /** Sets 1-10, repetitions 1-100, time 1-3600 s: how data is represented, not training. */
  TECHNICAL_LIMIT: 'hard',
  // ---- advice: the planner stays inside them, a request may go beyond them once confirmed
  DAY_MAX_EXCEEDED: 'advice',
  WEEK_MAX_EXCEEDED: 'advice',
  RECOVERING: 'advice',
  DOMS_HIGH: 'advice',
  OVERLAP_TODAY: 'advice',
  TIME_OVER_BUDGET: 'advice',
  RESOURCE_CONFLICT: 'advice',
  LOAD_JUMP_OVER_POLICY: 'advice',
  DELOAD_WORK_OVER_POLICY: 'advice',
  /** Sets 1-6, repetitions 1-30, time 5-300 s: what the planner itself keeps to. */
  PLANNER_LIMIT: 'advice',
  // ---- info: said, never a reason to stop or to ask
  HURTS_TOMORROW: 'info',
  SUPPLEMENTAL_ONLY: 'info',
  WEEK_MIN_HELPED: 'info',
  CALIBRATION_FIRST: 'info',
} as const satisfies Record<string, RuleClass>;

export type RuleCode = keyof typeof RULE_CLASS;

export function classOf(code: RuleCode): RuleClass {
  return RULE_CLASS[code];
}

export const RULE_CODES = Object.keys(RULE_CLASS) as RuleCode[];

export type CheckStatus = 'pass' | 'warn' | 'fail';

/** Numbers to explain a finding with, e.g. `{ muscle: 'shoulders', done: 3, after: 5, dayMax: 3 }`. */
export type CheckData = Record<string, number | string | boolean | null>;

export interface AssessmentCheck {
  code: RuleCode;
  class: RuleClass;
  status: CheckStatus;
  data: CheckData;
}

/** A finding with the class its rule has in the registry: a call site cannot choose a different one. */
export function finding(
  code: RuleCode,
  status: CheckStatus,
  data: CheckData = {},
): AssessmentCheck {
  return { code, class: classOf(code), status, data };
}

export type Verdict =
  'ok' | 'ok_with_changes' | 'not_recommended' | 'blocked' | 'needs_clarification';

export interface VerdictFacts {
  /** The exercise asked for matches several in the catalogue equally well. */
  ambiguous?: boolean;
  /** The engine did not do exactly what was asked (fewer sets than requested, another position). */
  changedRequest?: boolean;
}

/**
 * The verdict is a function of the findings and nothing else (11 §3): a hard
 * failure blocks, an advice failure advises against, a warning or a changed
 * request is carried out with changes, the rest is fine.
 */
export function verdictOf(checks: readonly AssessmentCheck[], facts: VerdictFacts = {}): Verdict {
  if (facts.ambiguous) return 'needs_clarification';
  if (checks.some((c) => c.class === 'hard' && c.status === 'fail')) return 'blocked';
  if (checks.some((c) => c.class === 'advice' && c.status === 'fail')) return 'not_recommended';
  if (facts.changedRequest || checks.some((c) => c.status === 'warn')) return 'ok_with_changes';
  return 'ok';
}

/** Hard failures first, then advice failures, then warnings, then the rest; by code inside each. */
export function sortChecks(checks: readonly AssessmentCheck[]): AssessmentCheck[] {
  const rank = (c: AssessmentCheck) =>
    c.status === 'fail' && c.class === 'hard'
      ? 0
      : c.status === 'fail' && c.class === 'advice'
        ? 1
        : c.status === 'warn'
          ? 2
          : 3;
  return [...checks].sort(
    (a, b) => rank(a) - rank(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
}

/** The advice a request goes against: what the person has to see and confirm to go ahead (D19). */
export function adviceToAcknowledge(checks: readonly AssessmentCheck[]): RuleCode[] {
  return sortChecks(checks)
    .filter((c) => c.class === 'advice' && c.status === 'fail')
    .map((c) => c.code);
}

/** What is still missing from a confirmation: the advice the person has not been shown and accepted. */
export function unacknowledged(
  checks: readonly AssessmentCheck[],
  acknowledged: readonly string[],
): RuleCode[] {
  return adviceToAcknowledge(checks).filter((code) => !acknowledged.includes(code));
}
