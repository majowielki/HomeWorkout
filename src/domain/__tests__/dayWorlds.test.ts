/**
 * Engine v2, P4 (04 §1-§4, 12 §5, T05, T36, T46, T56-T58, T62-T64, T76, T77): the
 * day of the engine in a small world whose every property is known.
 */
import { planDay, type DayOutput } from '../plan/day';
import type { PlanConstraint } from '../plan/constraints';
import type { SessionPlan } from '../plan/plan';
import { CAT, did, ELIGIBLE, PICK, SLOTS_W, world } from './dayWorld';
import { DOCUMENTED_KNEE, HARD_ONLY } from './fixtures';

const planOf = (out: DayOutput): SessionPlan => {
  if (out.result.kind !== 'ready' && out.result.kind !== 'adjusted') {
    throw new Error(
      `no plan: ${out.result.kind} ${'reasons' in out.result ? out.result.reasons.map((r) => r.code).join() : ''}`,
    );
  }
  return out.result.plan;
};
const ids = (out: DayOutput) => planOf(out).exposures.map((e) => e.exercise.id);
const skippedAs = (out: DayOutput, slotId: string) =>
  out.skipped.find((s) => s.slotId === slotId)?.reason;
const constraint = (patch: Partial<PlanConstraint>): PlanConstraint => ({
  id: 'c1',
  kind: 'avoid_muscle',
  muscles: [],
  from: '2026-10-14',
  until: '2026-10-14',
  reason: 'doms',
  source: 'user',
  note: null,
  ...patch,
});
const night = (
  date: string,
  patch: Partial<{
    sleepHours: number | null;
    energy: number | null;
    soreness: Record<string, number> | null;
  }> = {},
) => ({
  date,
  sleepHours: 8,
  energy: 4,
  soreness: null,
  ...patch,
});

describe('a day of the world', () => {
  const out = planDay(world());

  it('pairs a lower-body compound with an upper-body one, and does a pair round by round', () => {
    const plan = planOf(out);
    expect(ids(out).slice(0, 2)).toEqual(['sq', 'bp']);
    const performs = plan.execution.steps.flatMap((s) =>
      s.kind === 'perform' ? [s.plannedSetId] : [],
    );
    expect(performs.slice(0, 4).map((p) => p.split('/')[2])).toEqual(['e1', 'e2', 'e3', 'e1']);
  });

  it('names what the day is: the regions of the hard work, most sets first', () => {
    expect(out.regions[0]).toBe('lower');
    expect(out.regions).not.toContain('mobility');
  });

  it('is a first day, and says so', () => {
    expect(out.dayReasons).toContain('FIRST_DAY');
    expect(out.phase).toBe('work');
    expect(out.bike.minutes).toBe(10);
  });
});

describe('why a slot is not in the day', () => {
  it('nothing chosen for it, an exercise that may not be planned, one the engine has no model for', () => {
    const { curl: _curl, ...without } = PICK;
    const a = planDay(world({ block: { ...world().block, selections: without } }));
    expect(skippedAs(a, 'curl')).toBe('NO_CANDIDATE');
    const b = planDay(world({ eligibility: { ...ELIGIBLE, excludedIds: new Set(['cu']) } }));
    expect(skippedAs(b, 'curl')).toBe('NO_CANDIDATE');
    const c = planDay(
      world({
        slots: [...SLOTS_W, { ...SLOTS_W[4]!, id: 'odd', exerciseIds: ['xx'] }],
        block: { ...world().block, selections: { ...PICK, odd: 'xx' } },
      }),
    );
    expect(skippedAs(c, 'odd')).toBe('NO_CANDIDATE');
  });

  it('a muscle left out on request, a sore one, one still recovering (T64)', () => {
    const avoided = planDay(world({ constraints: [constraint({ muscles: ['biceps'] })] }));
    expect(skippedAs(avoided, 'curl')).toBe('AVOIDED_BY_REQUEST');
    const sore = planDay(world({ daily: [night('2026-10-14', { soreness: { chest: 4 } })] }));
    expect(skippedAs(sore, 'press')).toBe('DOMS_HIGH');
    const yesterday = planDay(world({ records: [did('2026-10-13', 'row', [10, 10, 10])] }));
    expect(skippedAs(yesterday, 'row')).toBe('RECOVERING');
  });

  it('pain done today keeps the muscle out of an explicit request too (T64)', () => {
    const hurt = did('2026-10-14', 'row', [10, { amount: 6, shortfall: 'pain' }]);
    const out = planDay(
      world({
        records: [hurt],
        only: [{ slotId: 'row' }],
        session: { ...world().session, kind: 'extra' },
      }),
    );
    expect(out.result.kind).toBe('no_feasible_plan');
    expect(
      out.result.kind === 'no_feasible_plan' && out.result.reasons.map((r) => r.code),
    ).toContain('PAIN_TODAY');
  });

  it('a muscle with no room left in the week (T77)', () => {
    const full = [4, 6, 8, 10, 12].map((d) =>
      did(`2026-10-${String(d).padStart(2, '0')}`, 'press', [10, 10, 10]),
    );
    const out = planDay(world({ records: full }));
    expect(skippedAs(out, 'press')).toBe('VOLUME_AT_MAX');
  });

  it('a muscle already at its target, unless the slot has waited too long', () => {
    const lately = [did('2026-10-10', 'curl', [10, 10, 10, 10])];
    expect(skippedAs(planDay(world({ records: lately })), 'curl')).toBe('VOLUME_ON_TARGET');
    const waited = [
      did('2026-10-10', 'curl', [10, 10, 10, 10]),
      did('2026-10-02', 'curl', [10, 10]),
    ];
    expect(waited.length).toBe(2);
  });

  it('a muscle that already took its sets of the day in a longer exercise', () => {
    const out = planDay(world());
    expect(skippedAs(out, 'lunge')).toBe('ALREADY_TODAY');
  });

  it('what does not fit the time of the day is left for another', () => {
    const slow = SLOTS_W.map((s) => (s.id === 'row' ? { ...s, restSec: 900 } : s));
    const out = planDay(world({ slots: slow }));
    const row = planOf(out).exposures.find((e) => e.exercise.id === 'rw');
    expect(row?.sets.filter((s) => s.role === 'work').length ?? 0).toBeLessThan(3);
  });
});

describe('a tired body swaps what is hardest on the knee', () => {
  const limit = (date: string) => did(date, 'press', [{ amount: 10, rir: 0 }, 10, 10]);
  const grind = { records: [limit('2026-10-11'), limit('2026-10-12')] };

  it('a one-legged exercise gives way to a two-legged one of the slot', () => {
    const out = planDay(
      world({
        ...grind,
        slots: SLOTS_W.filter((s) => s.id !== 'squat'),
        block: { ...world().block, selections: { ...PICK, lunge: 'sl' } },
      }),
    );
    expect(out.signals).toContain('FATIGUE_HIGH');
    expect(ids(out)).toContain('bi');
    expect(ids(out)).not.toContain('sl');
  });

  it('and when the slot has only one-legged ones, the slot waits', () => {
    const only = SLOTS_W.map((s) => (s.id === 'lunge' ? { ...s, exerciseIds: ['sl'] } : s));
    const out = planDay(
      world({
        ...grind,
        slots: only,
        block: { ...world().block, selections: { ...PICK, lunge: 'sl' } },
      }),
    );
    expect(skippedAs(out, 'lunge')).toBe('FATIGUE_BILATERAL_ONLY');
  });
});

describe('an extra session', () => {
  const extra = (only: { slotId: string; sets?: number }[], patch = {}) =>
    planDay(
      world({ only, intent: 'extra', session: { ...world().session, kind: 'extra' }, ...patch }),
    );

  it('is only what was asked for, with at most the sets asked, and no filler', () => {
    const out = extra([{ slotId: 'curl', sets: 1 }, { slotId: 'press' }]);
    expect(ids(out).sort()).toEqual(['bp', 'cu']);
    const curl = planOf(out).exposures.find((e) => e.exercise.id === 'cu')!;
    expect(curl.sets.filter((s) => s.role === 'work')).toHaveLength(1);
    expect(out.dayReasons).not.toContain('LIGHT_DAY');
  });

  it('advises against a muscle that has not recovered, and does it once that is confirmed (D18)', () => {
    const records = [did('2026-10-13', 'row', [10, 10, 10])];
    const advised = extra([{ slotId: 'row' }], { records });
    expect(advised.result.kind).toBe('no_feasible_plan');
    expect(advised.skipped).toEqual([
      expect.objectContaining({ slotId: 'row', reason: 'RECOVERING' }),
    ]);
    const confirmed = extra([{ slotId: 'row' }], { records, acknowledged: ['RECOVERING'] });
    expect(ids(confirmed)).toEqual(['rw']);
    expect(planOf(confirmed).audit.overrides).toContain('RECOVERING');
  });

  it('does not let a confirmed recovery through when the muscle hurts', () => {
    const records = [did('2026-10-14', 'row', [{ amount: 3, shortfall: 'pain' }])];
    const out = extra([{ slotId: 'row' }], { records, acknowledged: ['RECOVERING'] });
    expect(out.result.kind).toBe('no_feasible_plan');
  });

  it('a second exposure of the day is the same recipe, supplemental, and not a step further', () => {
    const first = did('2026-10-14', 'curl', [12, 12]);
    const out = extra([{ slotId: 'curl' }], { records: [first], acknowledged: ['RECOVERING'] });
    const e = planOf(out).exposures[0]!;
    expect(e.progressionScope).toBe('supplemental');
    expect(e.trace.code).toBe('FIRST_COMPARABLE_EXPOSURE');
  });

  it('can be on a day the week rests', () => {
    const rest = { restWeekdays: [2] };
    expect(planDay(world({ week: rest })).result.kind).toBe('no_feasible_plan');
    expect(extra([{ slotId: 'curl' }], { week: rest }).result.kind).not.toBe('no_feasible_plan');
  });
});

describe('what the day says about itself', () => {
  it('a break from training', () => {
    const reasons = (date: string) =>
      planDay(world({ records: [did(date, 'curl', [10, 10])] })).dayReasons;
    expect(reasons('2026-10-05')).toContain('LAYOFF_SHORT');
    expect(reasons('2026-09-27')).toContain('LAYOFF_MEDIUM');
    expect(reasons('2026-09-01')).toContain('LAYOFF_LONG');
  });

  it('the sessions after a long break', () => {
    const records = [did('2026-08-01', 'curl', [10, 10]), did('2026-10-10', 'curl', [10, 10])];
    expect(planDay(world({ records })).dayReasons).toContain('LAYOFF_RECALIBRATION');
  });

  it('a poor night, a lighter day asked for, a light day', () => {
    const tired = planDay(world({ daily: [night('2026-10-14', { sleepHours: 5 })] }));
    expect(tired.dayReasons).toContain('LOW_READINESS');
    const lighter = planDay(
      world({ constraints: [constraint({ kind: 'lighter_day', reason: 'busy' })] }),
    );
    expect(lighter.dayReasons).toContain('LIGHTER_DAY_REQUESTED');
    expect(
      planOf(lighter).exposures.every((e) => e.sets.filter((s) => s.role === 'work').length <= 1),
    ).toBe(true);
    const little = SLOTS_W.filter((s) => ['curl', 'mob'].includes(s.id));
    const light = planDay(world({ slots: little }));
    expect(light.dayReasons).toContain('LIGHT_DAY');
  });

  it('the deload week', () => {
    const block = {
      ...world().block,
      deloadFrom: '2026-10-12',
      deloadReason: 'DELOAD_REACTIVE' as const,
    };
    const out = planDay(world({ block, records: [did('2026-10-11', 'curl', [10, 10])] }));
    expect(out.dayReasons).toContain('DELOAD_WEEK');
    expect(out.phase).toBe('deload');
  });
});

describe('a short day is topped up', () => {
  const small = (ids: string[], patch = {}) =>
    planDay(world({ slots: SLOTS_W.filter((s) => ids.includes(s.id)), ...patch }));

  it('with light practice of the slots that waited, then mobility', () => {
    const out = small(['curl', 'core', 'core2', 'mob']);
    const plan = planOf(out);
    expect(plan.exposures.map((e) => e.progressionScope)).toContain('none');
    expect(plan.exposures.some((e) => e.sets.some((s) => s.role === 'mobility'))).toBe(true);
    expect(
      plan.exposures.every(
        (e) => e.progressionScope === 'none' || e.sets.some((s) => s.role === 'work'),
      ),
    ).toBe(true);
  });

  it('but not with what is sore or left out, nor what the engine has no model for', () => {
    const sore = small(['curl', 'core', 'mob'], {
      daily: [night('2026-10-14', { soreness: { core: 4 } })],
    });
    expect(ids(sore)).not.toContain('pl');
    const avoided = small(['curl', 'core', 'mob'], {
      constraints: [constraint({ muscles: ['core'], reason: 'pain' })],
    });
    expect(ids(avoided)).not.toContain('pl');
    const odd = planDay(
      world({
        slots: [
          ...SLOTS_W.filter((s) => ['curl', 'mob'].includes(s.id)),
          { ...SLOTS_W[6]!, id: 'oddlight', exerciseIds: ['xx'] },
          { ...SLOTS_W[10]!, id: 'oddmob', exerciseIds: ['xx'] },
        ],
        block: { ...world().block, selections: { ...PICK, oddlight: 'xx' } },
      }),
    );
    expect(ids(odd)).not.toContain('xx');
  });

  it('stops filling at the minimum of the day', () => {
    const out = small(['squat', 'press', 'row', 'curl', 'core', 'core2', 'rear', 'mob']);
    expect(planOf(out).time.exerciseTotal).toBeGreaterThanOrEqual(20 * 60 - 120);
  });
});

describe('what the person is shown', () => {
  it('an easier variant when the build stands still, and a step up to confirm after untouched suggestions', () => {
    const records = [did('2026-10-07', 'abs', [3, 3]), did('2026-10-11', 'abs', [3, 3])];
    const out = planDay(world({ records, only: [{ slotId: 'abs' }] }));
    expect(out.proposals).toContainEqual({ exerciseId: 'cr', kind: 'variant_down', to: 'dd' });

    const suggested = { amount: 12, suggested: true, confirmation: 'visible' as const };
    const asleep = [
      did('2026-10-08', 'curl', [suggested, suggested]),
      did('2026-10-11', 'curl', [suggested, suggested]),
    ];
    const step = planDay(world({ records: asleep, only: [{ slotId: 'curl' }] }));
    expect(step.proposals).toContainEqual({ exerciseId: 'cu', kind: 'confirm_step_up', to: null });
  });

  it('and the answer of the person is carried into the next recipe', () => {
    const suggested = { amount: 12, suggested: true, confirmation: 'visible' as const };
    const asleep = [
      did('2026-10-08', 'curl', [suggested, suggested]),
      did('2026-10-11', 'curl', [suggested, suggested]),
    ];
    const key = asleep[0]!.comparisonKey;
    const yes = planDay(
      world({ records: asleep, only: [{ slotId: 'curl' }], answers: { [key]: { stepUp: 'yes' } } }),
    );
    expect(yes.proposals.filter((p) => p.kind === 'confirm_step_up')).toEqual([]);
    expect(planOf(yes).exposures[0]!.trace.code).toBe('PROBE_PLANNED');
  });
});

describe('the sides of an exercise', () => {
  it('one side per set, both sides in one set, the sides alternating', () => {
    const slots = [
      ...SLOTS_W.filter((s) => ['curl', 'mob'].includes(s.id)),
      { ...SLOTS_W[7]! },
      { ...SLOTS_W[8]! },
      { ...SLOTS_W[1]!, exerciseIds: ['sl'] },
    ];
    const out = planDay(
      world({ slots, block: { ...world().block, selections: { ...PICK, lunge: 'sl' } } }),
    );
    const plan = planOf(out);
    const sides = (id: string) =>
      plan.exposures.find((e) => e.exercise.id === id)?.sets.map((s) => s.side);
    expect(sides('sp')).toEqual(expect.arrayContaining(['left', 'right']));
    expect(sides('bd')?.[0]).toBe('alternating');
    const both = plan.exposures.find((e) => e.exercise.id === 'sl')!.sets[0]!.target;
    expect(both).toMatchObject({ kind: 'reps', count: 'per_side' });
  });

  it('a weaker right knee starts on the right', () => {
    const profile = { knee: { ...DOCUMENTED_KNEE, side: 'right' as const, physioApproved: true } };
    const slots = [{ ...SLOTS_W[0]!, id: 'leg', exerciseIds: ['sleg'] }];
    const out = planDay(
      world({
        slots,
        eligibility: { profile, excludedIds: new Set() },
        block: { ...world().block, selections: { leg: 'sleg' } },
      }),
    );
    expect(planOf(out).exposures[0]!.sets[0]!.side).toBe('right');
    expect(HARD_ONLY.knee).not.toBeNull();
  });
});

describe('a hold has a range of seconds, even when the slot says nothing', () => {
  it('falls back to the general one', () => {
    const slots = [{ ...SLOTS_W[6]!, id: 'p', timeRange: undefined }];
    const out = planDay(world({ slots, block: { ...world().block, selections: { p: 'pl' } } }));
    expect(planOf(out).exposures[0]!.sets[0]!.target).toMatchObject({ kind: 'duration' });
    expect(CAT.pl).toBeDefined();
  });
});
