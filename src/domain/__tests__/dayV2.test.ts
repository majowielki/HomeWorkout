/**
 * Engine v2, P4 (04 §1-§4, T05-T07, T36, T56-T58, T76-T77): the day of the
 * second engine, on the catalogue the app ships.
 */
import { planDayV2 } from '../plan/dayV2';
import { dayInput, SLOTS } from './dayV2Fixtures';

describe('the first day of a person who has never trained', () => {
  const out = planDayV2(dayInput());

  it('is a plan', () => {
    expect(['ready', 'adjusted']).toContain(out.result.kind);
    if (out.result.kind !== 'ready' && out.result.kind !== 'adjusted') return;
    expect(out.result.plan.exposures.length).toBeGreaterThan(2);
    expect(out.dayReasons).toContain('FIRST_DAY');
  });

  it('starts every exercise where its slot says, at the bottom of the range, easy', () => {
    if (out.result.kind !== 'ready' && out.result.kind !== 'adjusted') throw new Error('plan');
    for (const e of out.result.plan.exposures.filter((x) => x.progressionScope === 'primary')) {
      expect(e.trace.code).toBe('FIRST_COMPARABLE_EXPOSURE');
      for (const s of e.sets) {
        expect(s.targetRir).toEqual({ min: 4, max: 4 });
      }
    }
  });

  it('is the same plan every time', () => {
    expect(planDayV2(dayInput())).toEqual(out);
  });
});

describe('what the day is made of', () => {
  it('says why a slot is not there', () => {
    const out = planDayV2(dayInput());
    expect(
      out.skipped.length + (out.result.kind === 'ready' ? out.result.plan.exposures.length : 0),
    ).toBeGreaterThan(0);
    for (const s of out.skipped) expect(SLOTS.some((slot) => slot.id === s.slotId)).toBe(true);
  });
});
