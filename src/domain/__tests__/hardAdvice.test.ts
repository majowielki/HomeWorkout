/**
 * Engine v2, P1 (D18, D19, 12 §2, 11 §3): which rules block and which advise,
 * and the verdict that follows from the findings.
 */
import {
  adviceToAcknowledge,
  classOf,
  finding,
  RULE_CLASS,
  RULE_CODES,
  sortChecks,
  unacknowledged,
  verdictOf,
} from '../policy/hardAdvice';

describe('the registry of rules', () => {
  it('puts safety, pain, equipment and "do not suggest" among the hard ones (12 §2)', () => {
    for (const code of [
      'MEDICAL_EXCLUSION',
      'MISSING_CLASSIFICATION',
      'PAIN_TODAY',
      'AVOIDED_BY_REQUEST',
      'USER_EXCLUDED',
      'EQUIPMENT_UNAVAILABLE',
      'UNSUPPORTED_CAPABILITY',
      'NOT_IN_CATALOG',
      'DRAFT_ONLY',
      'RESISTANCE_UNREACHABLE',
      'TECHNICAL_LIMIT',
    ] as const) {
      expect(classOf(code)).toBe('hard');
    }
  });

  it('leaves volume, recovery, time and the planner’s own limits as advice (D18)', () => {
    for (const code of [
      'DAY_MAX_EXCEEDED',
      'WEEK_MAX_EXCEEDED',
      'RECOVERING',
      'DOMS_HIGH',
      'OVERLAP_TODAY',
      'TIME_OVER_BUDGET',
      'RESOURCE_CONFLICT',
      'LOAD_JUMP_OVER_POLICY',
      'DELOAD_WORK_OVER_POLICY',
      'PLANNER_LIMIT',
    ] as const) {
      expect(classOf(code)).toBe('advice');
    }
  });

  it('keeps what only informs out of the way', () => {
    for (const code of [
      'HURTS_TOMORROW',
      'SUPPLEMENTAL_ONLY',
      'WEEK_MIN_HELPED',
      'CALIBRATION_FIRST',
    ] as const) {
      expect(classOf(code)).toBe('info');
    }
  });

  it('knows every code once, in exactly one class', () => {
    expect(new Set(RULE_CODES).size).toBe(RULE_CODES.length);
    expect(RULE_CODES).toHaveLength(Object.keys(RULE_CLASS).length);
    for (const code of RULE_CODES) expect(['hard', 'advice', 'info']).toContain(classOf(code));
  });

  it('gives a finding the class of its rule — a call site cannot pick another', () => {
    expect(
      finding('DAY_MAX_EXCEEDED', 'fail', { muscle: 'shoulders', done: 3, after: 5, dayMax: 3 }),
    ).toEqual({
      code: 'DAY_MAX_EXCEEDED',
      class: 'advice',
      status: 'fail',
      data: { muscle: 'shoulders', done: 3, after: 5, dayMax: 3 },
    });
    expect(finding('PAIN_TODAY', 'pass').class).toBe('hard');
    expect(finding('PAIN_TODAY', 'pass').data).toEqual({});
  });
});

describe('the verdict', () => {
  const hardFail = finding('PAIN_TODAY', 'fail');
  const adviceFail = finding('DAY_MAX_EXCEEDED', 'fail');
  const adviceWarn = finding('RESOURCE_CONFLICT', 'warn');
  const infoWarn = finding('HURTS_TOMORROW', 'warn');
  const passes = [finding('MEDICAL_EXCLUSION', 'pass'), finding('DAY_MAX_EXCEEDED', 'pass')];

  it('T61 is ok when nothing is wrong', () => {
    expect(verdictOf(passes)).toBe('ok');
    expect(verdictOf([])).toBe('ok');
    expect(verdictOf([finding('SUPPLEMENTAL_ONLY', 'pass')])).toBe('ok');
  });

  it('T62 advises against what goes past an advice rule, with the request still possible', () => {
    expect(verdictOf([...passes, adviceFail])).toBe('not_recommended');
  });

  it('T64 blocks only on a hard failure, whatever else is true', () => {
    expect(verdictOf([adviceFail, hardFail])).toBe('blocked');
    expect(verdictOf([hardFail])).toBe('blocked');
  });

  it('carries a request out with changes on a warning or when the engine changed it', () => {
    expect(verdictOf([adviceWarn])).toBe('ok_with_changes');
    expect(verdictOf([infoWarn])).toBe('ok_with_changes');
    expect(verdictOf(passes, { changedRequest: true })).toBe('ok_with_changes');
  });

  it('asks which exercise was meant before it judges anything', () => {
    expect(verdictOf([hardFail], { ambiguous: true })).toBe('needs_clarification');
    expect(verdictOf([], { ambiguous: true })).toBe('needs_clarification');
  });

  it('does not let a failing info rule block or advise: it is only said', () => {
    expect(verdictOf([finding('WEEK_MIN_HELPED', 'fail')])).toBe('ok');
  });
});

describe('the order of findings and what must be confirmed', () => {
  const checks = [
    finding('SUPPLEMENTAL_ONLY', 'pass'),
    finding('HURTS_TOMORROW', 'warn'),
    finding('WEEK_MAX_EXCEEDED', 'fail'),
    finding('PAIN_TODAY', 'fail'),
    finding('DAY_MAX_EXCEEDED', 'fail'),
    finding('DOMS_HIGH', 'pass'),
  ];

  it('puts hard failures first, then advice failures, then warnings, then the rest — by code inside each', () => {
    expect(sortChecks(checks).map((c) => c.code)).toEqual([
      'PAIN_TODAY',
      'DAY_MAX_EXCEEDED',
      'WEEK_MAX_EXCEEDED',
      'HURTS_TOMORROW',
      'DOMS_HIGH',
      'SUPPLEMENTAL_ONLY',
    ]);
  });

  it('keeps two findings of the same rule in the order they came', () => {
    const first = finding('DAY_MAX_EXCEEDED', 'fail', { muscle: 'chest' });
    const second = finding('DAY_MAX_EXCEEDED', 'fail', { muscle: 'back' });
    expect(sortChecks([first, second])).toEqual([first, second]);
    expect(sortChecks([second, first])).toEqual([second, first]);
  });

  it('orders two failures of the same class by code whichever way round they come', () => {
    const day = finding('DAY_MAX_EXCEEDED', 'fail');
    const week = finding('WEEK_MAX_EXCEEDED', 'fail');
    expect(sortChecks([day, week])).toEqual([day, week]);
    expect(sortChecks([week, day])).toEqual([day, week]);
  });

  it('does not put a failing info finding among the failures', () => {
    const info = finding('WEEK_MIN_HELPED', 'fail');
    const advice = finding('RECOVERING', 'fail');
    expect(sortChecks([info, advice])).toEqual([advice, info]);
  });

  it('does not change the list it is given', () => {
    const before = checks.map((c) => c.code);
    sortChecks(checks);
    expect(checks.map((c) => c.code)).toEqual(before);
  });

  it('T69 lists the advice a request goes against, and what is still unconfirmed', () => {
    expect(adviceToAcknowledge(checks)).toEqual(['DAY_MAX_EXCEEDED', 'WEEK_MAX_EXCEEDED']);
    expect(unacknowledged(checks, [])).toEqual(['DAY_MAX_EXCEEDED', 'WEEK_MAX_EXCEEDED']);
    expect(unacknowledged(checks, ['DAY_MAX_EXCEEDED'])).toEqual(['WEEK_MAX_EXCEEDED']);
    expect(unacknowledged(checks, ['DAY_MAX_EXCEEDED', 'WEEK_MAX_EXCEEDED', 'PAIN_TODAY'])).toEqual(
      [],
    );
    expect(adviceToAcknowledge([finding('DAY_MAX_EXCEEDED', 'pass')])).toEqual([]);
  });
});
