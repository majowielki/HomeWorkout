import {
  assessReport,
  defaultReportDays,
  emptyReport,
  REPORT_DAY_CHOICES,
  REPORT_KINDS,
  type SorenessReport,
} from '../plan/sorenessReport';
import { avoidedOn, isAvoided } from '../plan/constraints';
import { exercise } from './fixtures';

const DATE = '2026-10-31';
function report(patch: Partial<SorenessReport> = {}): SorenessReport {
  return { ...emptyReport(), kind: 'strong_doms', muscles: ['quads'], redFlags: false, ...patch };
}
const answered: SorenessReport['pain'] = {
  onset: 'delayed',
  location: 'diffuse',
  movement: 'not_tried',
};

describe('soreness reports', () => {
  it('offers one to three days, two by default and three for a sore muscle', () => {
    expect(REPORT_DAY_CHOICES).toEqual([1, 2, 3]);
    expect(emptyReport().days).toBe(2);
    expect(defaultReportDays('strong_doms')).toBe(2);
    expect(defaultReportDays('muscle_pain')).toBe(3);
  });
  it.each([...REPORT_KINDS, null])(
    'routes red flags to consultation, even with kind %s and an incomplete form',
    (kind) => {
      expect(assessReport({ ...emptyReport(), kind, redFlags: true }, DATE)).toEqual({
        kind: 'medical',
        reason: 'redFlags',
      });
    },
  );
  it('routes joint pain away from plan changes without needing muscle answers', () => {
    expect(assessReport({ ...emptyReport(), kind: 'joint_pain' }, DATE)).toEqual({
      kind: 'medical',
      reason: 'joint',
    });
  });
  it('requires a known kind, explicit absence of red flags and valid muscles', () => {
    expect(assessReport(emptyReport(), DATE)).toEqual({ kind: 'incomplete', field: 'kind' });
    expect(assessReport(report({ kind: 'other' as SorenessReport['kind'] }), DATE)).toEqual({
      kind: 'incomplete',
      field: 'kind',
    });
    expect(assessReport(report({ redFlags: null }), DATE)).toEqual({
      kind: 'incomplete',
      field: 'redFlags',
    });
    expect(assessReport(report({ muscles: [] }), DATE)).toEqual({
      kind: 'incomplete',
      field: 'muscles',
    });
    expect(
      assessReport(report({ muscles: ['unknown' as SorenessReport['muscles'][number]] }), DATE),
    ).toEqual({ kind: 'incomplete', field: 'muscles' });
  });
  it('records mild DOMS without a planner exclusion, deduplicating selected muscles', () => {
    expect(
      assessReport(report({ kind: 'mild_doms', muscles: ['quads', 'quads', 'back'] }), DATE),
    ).toEqual({ kind: 'mild', muscles: ['quads', 'back'] });
  });
  it.each([{}, { onset: 'delayed' }, { onset: 'delayed', location: 'diffuse' }])(
    'requires each pain answer (%j)',
    (pain) => {
      expect(
        assessReport(
          report({
            kind: 'muscle_pain',
            pain: { ...emptyReport().pain, ...pain } as SorenessReport['pain'],
          }),
          DATE,
        ),
      ).toEqual({ kind: 'incomplete', field: 'pain' });
    },
  );
  it.each([0, 4, 1.5, NaN, Infinity])('refuses an invalid duration %s', (days) => {
    expect(assessReport(report({ days }), DATE)).toEqual({ kind: 'incomplete', field: 'days' });
  });
  it.each([
    [1, '2026-10-31'],
    [2, '2026-11-01'],
    [3, '2026-11-02'],
  ])('counts %s days inclusive, across a month boundary', (days, until) => {
    expect(assessReport(report({ days: days as number }), DATE)).toMatchObject({
      kind: 'restriction',
      constraint: {
        from: DATE,
        until,
        muscles: ['quads'],
        reason: 'doms',
        source: 'user',
        kind: 'avoid_muscle',
      },
      strainSignals: false,
    });
  });
  it.each([
    [{ ...answered, onset: 'during' }, true],
    [{ ...answered, location: 'focal' }, true],
    [{ ...answered, movement: 'worse' }, true],
    [answered, false],
    [{ onset: 'unknown', location: 'unknown', movement: 'same' }, false],
    [{ ...answered, movement: 'better' }, false],
  ])('keeps full muscle-pain exclusions whatever the answers (%j)', (pain, strainSignals) => {
    expect(
      assessReport(
        report({ kind: 'muscle_pain', pain: pain as SorenessReport['pain'], days: 3 }),
        DATE,
      ),
    ).toMatchObject({
      kind: 'restriction',
      constraint: { reason: 'pain', until: '2026-11-02' },
      strainSignals,
    });
  });
  it('gives the existing planner primary-only DOMS restrictions and all-muscle pain restrictions', () => {
    const lift = exercise({ primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'] });
    for (const kind of ['strong_doms', 'muscle_pain'] as const) {
      const decision = assessReport(report({ kind, pain: answered, muscles: ['shoulders'] }), DATE);
      if (decision.kind !== 'restriction') throw new Error('expected an exclusion');
      const constraints = [{ ...decision.constraint, id: kind }];
      expect(isAvoided(lift, avoidedOn(constraints, DATE))).toBe(kind === 'muscle_pain');
      expect(isAvoided(lift, avoidedOn(constraints, '2026-11-02'))).toBe(false);
    }
  });
});
