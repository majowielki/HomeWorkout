/**
 * Engine v2, P4 (04 §1-§4, T05-T07, T36, T56-T58, T76-T77): the day of the
 * engine, on the catalogue the app ships.
 */
import { planDay } from '../plan/day';
import { resistanceOf } from '../plan/resistanceOf';
import { dayInput, SLOTS } from './dayFixtures';
import { exposureOf, kg } from './progressionFixtures';

describe('the first day of a person who has never trained', () => {
  const out = planDay(dayInput());

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
    expect(planDay(dayInput())).toEqual(out);
  });
});

describe('what the day is made of', () => {
  it('says why a slot is not there', () => {
    const out = planDay(dayInput());
    expect(
      out.skipped.length + (out.result.kind === 'ready' ? out.result.plan.exposures.length : 0),
    ).toBeGreaterThan(0);
    for (const s of out.skipped) expect(SLOTS.some((slot) => slot.id === s.slotId)).toBe(true);
  });
});

describe('a kept day', () => {
  it('follows a deload with fewer sets of the same exercises and still holds', () => {
    const base = dayInput();
    const work = planDay(base);
    const deload = {
      ...base.block,
      deloadFrom: base.asOf,
      deloadReason: 'DELOAD_REACTIVE' as const,
    };
    const kept = planDay({ ...base, block: deload, kept: work.selection });
    expect(kept.phase).toBe('deload');
    expect(kept.kept).toBe('held');
    expect(kept.selection.map((k) => [k.slotId, k.exerciseId])).toEqual(
      work.selection.map((k) => [k.slotId, k.exerciseId]),
    );
    const total = (s: { sets: number }[]) => s.reduce((sum, k) => sum + k.sets, 0);
    expect(total(kept.selection)).toBeLessThan(total(work.selection));
    for (const k of kept.selection) {
      const was = work.selection.find((w) => w.slotId === k.slotId)!;
      expect(k.sets).toBeLessThanOrEqual(Math.max(1, Math.round(was.sets * 0.5)));
    }
  });

  it('holds a day whose first set is a probe: the probe is one of the sets asked for', () => {
    const base = dayInput();
    const slot = base.slots.find((s) => s.exerciseIds.includes('lateral-raise'))!;
    const exercise = base.catalog['lateral-raise']!;
    const res = resistanceOf(exercise, slot)!;
    const records = ['2026-09-29', '2026-10-01'].map((date) =>
      exposureOf({
        date,
        spec: kg(4),
        sets: [12, 12],
        key: res.comparisonKey,
        exerciseId: exercise.id,
        slotId: slot.id,
      }),
    );
    const probeInput = {
      ...base,
      asOf: '2026-10-08',
      slots: [slot],
      records,
      block: { ...base.block, selections: { ...base.block.selections, [slot.id]: exercise.id } },
      preferences: {
        ...base.preferences,
        setsPerExposure: { mode: 'fixed' as const, byKind: { accessory: 3 } },
      },
    };
    const first = planDay(probeInput);
    if (first.result.kind !== 'ready' && first.result.kind !== 'adjusted') throw new Error('plan');
    expect(first.result.plan.exposures[0]!.sets.map((s) => s.role)).toContain('probe');
    const again = planDay({ ...probeInput, kept: first.selection });
    expect(again.kept).toBe('held');
    expect(again.selection).toEqual(first.selection);
  });
});
