/** Engine v2, P4: legal edge cases, public trace, and the final audited day. */
import { planDayV2, type DayOutputV2 } from '../plan/dayV2';
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { did, SLOTS_W, world } from './dayWorld';

function planOf(out: DayOutputV2) {
  if (out.result.kind !== 'ready' && out.result.kind !== 'adjusted') {
    throw new Error(`Expected a plan, got ${out.result.kind}`);
  }
  return out.result.plan;
}

describe('T56, T58 marginal choice and its explanation', () => {
  it('records the weighted parts of the score and the compiler cost of every choice', () => {
    const plan = planOf(planDayV2(world()));
    for (const e of plan.exposures.filter((e) => e.progressionScope !== 'none')) {
      const score = e.trace.evidence.selection as {
        deficit: number;
        staleness: number;
        compound: number;
        preference: number;
        total: number;
        addedSec: number;
      };
      expect(score.total).toBe(score.deficit + score.staleness + score.compound + score.preference);
      expect(Number.isFinite(score.total)).toBe(true);
      expect(score.addedSec).toBeGreaterThan(0);
    }
  });

  it('gives a stale slot a chance even when another slot filled the muscle target', () => {
    const old = did('2026-10-02', 'curl', [10, 10]);
    const other = did('2026-10-10', 'curl', [10, 10, 10, 10], { slotId: 'other' });
    const out = planDayV2(
      world({ records: [old, other], slots: SLOTS_W.filter((s) => s.id === 'curl') }),
    );
    const e = planOf(out).exposures[0]!;
    expect(e.exercise.id).toBe('cu');
    expect(e.sets).toHaveLength(2);
    expect(e.trace.evidence.selection).toMatchObject({ deficit: 0 });
  });
});

describe('T36, T51 no usable prescription', () => {
  it('rejects an extended prescription when the plain recipe fits but the real one exceeds the time budget', () => {
    const slots = SLOTS_W.filter((s) => s.id === 'abs').map((s) => ({ ...s, restSec: 1670 }));
    const out = planDayV2(
      world({ slots, only: [{ slotId: 'abs' }], records: [did('2026-10-11', 'abs', [12, 12])] }),
    );
    expect(out.result.kind).toBe('no_feasible_plan');
    expect(out.skipped).toContainEqual({ slotId: 'abs', exerciseId: 'cr', reason: 'NOT_PICKED' });
  });

  it('leaves an unselected light slot out of the fillers too', () => {
    const out = planDayV2(
      world({
        slots: SLOTS_W.filter((s) => ['curl', 'core'].includes(s.id)),
        block: { ...world().block, selections: { curl: 'cu' } },
      }),
    );
    expect(planOf(out).exposures.map((e) => e.exercise.id)).toEqual(['cu']);
    expect(out.skipped).toContainEqual({
      slotId: 'core',
      exerciseId: null,
      reason: 'NO_CANDIDATE',
    });
  });

  it('does not prescribe an invalid starting mass', () => {
    const slots = SLOTS_W.filter((s) => s.id === 'curl').map((s) => ({
      ...s,
      start: { paired: -1 },
    }));
    const out = planDayV2(
      world({ slots, only: [{ slotId: 'curl' }], models: DEFAULT_MODEL_CONTEXT }),
    );
    expect(out.result.kind).toBe('no_feasible_plan');
    expect(out.skipped).toContainEqual({ slotId: 'curl', exerciseId: 'cu', reason: 'NOT_PICKED' });
    expect(out.regions).toEqual([]);
  });

  it('does not invent a model for an unsupported light or mobility exercise', () => {
    const out = planDayV2(
      world({
        slots: [
          { ...SLOTS_W[5]!, id: 'oddlight', exerciseIds: ['xx'] },
          { ...SLOTS_W[10]!, id: 'oddmob', exerciseIds: ['xx'] },
        ],
        block: { ...world().block, selections: { oddlight: 'xx' } },
      }),
    );
    expect(out.result.kind).toBe('no_feasible_plan');
    expect(out.skipped[0]!.reason).toBe('NO_CANDIDATE');
  });

  it('does not fill a day with mobility of a muscle left out on request', () => {
    const out = planDayV2(
      world({
        slots: SLOTS_W.filter((s) => ['curl', 'mob'].includes(s.id)),
        constraints: [
          {
            id: 'avoid',
            kind: 'avoid_muscle',
            muscles: ['back'],
            from: '2026-10-14',
            until: '2026-10-14',
            reason: 'pain',
            source: 'user',
            note: null,
          },
        ],
      }),
    );
    expect(planOf(out).exposures.map((e) => e.exercise.id)).toEqual(['cu']);
  });

  it('handles a previous exposure with no comparable recorded resistance', () => {
    const out = planDayV2(
      world({ records: [did('2026-10-11', 'curl', [null, null])], only: [{ slotId: 'curl' }] }),
    );
    expect(planOf(out).exposures[0]!.trace.code).toBe('FIRST_COMPARABLE_EXPOSURE');
  });
});

describe('T64 pain from extra work', () => {
  it('keeps extra observations in the pain guard', () => {
    const source = did('2026-10-14', 'curl', [{ amount: 6, shortfall: 'pain' }]);
    const record = { ...source, sets: [], extra: [source.sets[0]!.observation!] };
    const out = planDayV2(world({ records: [record], only: [{ slotId: 'curl' }] }));
    expect(out.result.kind).toBe('no_feasible_plan');
    if (out.result.kind !== 'no_feasible_plan') throw new Error('Expected a pain rejection');
    expect(out.result.reasons.map((r) => r.code)).toContain('PAIN_TODAY');
  });

  it('cannot attach an unknown historical exercise to a muscle of the current catalogue', () => {
    const record = did('2026-10-14', 'curl', [{ amount: 6, shortfall: 'pain' }], {
      exerciseId: 'old-removed',
      key: 'old-key',
    });
    const out = planDayV2(world({ records: [record], only: [{ slotId: 'curl' }] }));
    expect(planOf(out).exposures[0]!.exercise.id).toBe('cu');
  });
});

describe('metadata describes the audited plan', () => {
  it('does not title a day by light practice', () => {
    const out = planDayV2(
      world({
        slots: SLOTS_W.filter((s) => ['curl', 'core', 'mob'].includes(s.id)),
        records: [did('2026-10-13', 'core', [30, 30])],
      }),
    );
    expect(planOf(out).exposures.some((e) => e.sets.some((s) => s.role === 'practice'))).toBe(true);
    expect(out.regions).toEqual(['arms']);
  });

  it('drops proposals and regions when the audit rejects a resting day', () => {
    const records = [did('2026-10-07', 'abs', [3, 3]), did('2026-10-11', 'abs', [3, 3])];
    const out = planDayV2(
      world({ records, only: [{ slotId: 'abs' }], week: { restWeekdays: [2] } }),
    );
    expect(out.result.kind).toBe('no_feasible_plan');
    expect(out.proposals).toEqual([]);
    expect(out.regions).toEqual([]);
  });

  it('retains proposals only for exposures that survive repair', () => {
    const records = [did('2026-10-07', 'abs', [3, 3]), did('2026-10-11', 'abs', [3, 3])];
    const out = planDayV2(
      world({
        records: [...records, did('2026-10-14', 'abs', [{ amount: 1, shortfall: 'pain' }])],
        only: [{ slotId: 'abs' }, { slotId: 'curl' }],
      }),
    );
    expect(out.result.kind).toBe('adjusted');
    expect(planOf(out).exposures.map((e) => e.exercise.id)).toEqual(['cu']);
    expect(out.proposals).toEqual([]);
    expect(out.regions).toEqual(['arms']);
  });
});
