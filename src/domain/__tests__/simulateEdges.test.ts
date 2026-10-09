/** Engine v2, P4: the simulator preserves observation semantics and explicit failures. */
import { compileSession } from '../plan/compile';
import { FOLLOWS_THE_PLAN, observationOf, recordsOf, simulate } from '../plan/simulate';
import { defaultPreferences } from '../preferences/preferences';
import { DEFAULT_MODEL_CONTEXT } from '../resistance/registry';
import { compileInput, exposure, set, stamp } from './compileFixtures';
import { CAT, ELIGIBLE, SLOTS_W } from './dayWorld';

const plan = stamp(
  compileSession(compileInput([exposure('e1', { sets: [set({ targetRir: null })] })])),
);
const e = plan.exposures[0]!;
const s = e.sets[0]!;

describe('T12, T16 observations of a synthetic athlete', () => {
  it('keeps entered amounts and effort separate from the confirmed resistance', () => {
    const records = recordsOf(plan, FOLLOWS_THE_PLAN);
    const obs = records[0]!.sets[0]!.observation!;
    expect(obs.amount).toMatchObject({
      value: { kind: 'reps', reps: 10 },
      origin: 'user_reported',
      confirmation: 'edited',
    });
    expect(obs.rir).toMatchObject({ value: 2, origin: 'user_reported', confirmation: 'edited' });
    expect(obs.resistance).toMatchObject({
      value: s.resistance,
      origin: 'user_confirmed',
      confirmation: 'visible',
    });
    expect(records[0]!.context.deload).toBe(false);
  });

  it('refuses a distance target instead of making up reps', () => {
    const distance = {
      ...s,
      target: { kind: 'distance' as const, targetMeters: 200 },
    };
    expect(() => FOLLOWS_THE_PLAN.amount(distance, e)).toThrow('does not support distance');
    expect(() => observationOf(distance, e, plan.sessionId, plan.trainingDate, 200, 2)).toThrow(
      'does not support distance',
    );
  });
});

const run = (patch: Partial<Parameters<typeof simulate>[0]> = {}) =>
  simulate({
    start: '2026-10-05',
    days: 2,
    catalog: CAT,
    slots: SLOTS_W,
    eligibility: ELIGIBLE,
    ...patch,
  });

describe('T36 no fabricated history', () => {
  it('keeps an empty catalogue empty instead of inventing sessions to sustain a block', () => {
    const days = run({
      days: 36,
      catalog: {},
      preferences: defaultPreferences(),
      models: DEFAULT_MODEL_CONTEXT,
    });
    expect(days.every((d) => d.plan === null && d.records.length === 0)).toBe(true);
    expect(days.every((d) => d.output!.result.kind === 'no_feasible_plan')).toBe(true);
    expect(days.some((d) => d.events.includes('BLOCK_CLOCK_RESET'))).toBe(true);
    expect(days[35]!.block.index).toBe(1);
  });

  it('does not invent evidence for a selected exercise whose model cannot be created', () => {
    const days = run({ days: 36, slots: [{ ...SLOTS_W[0]!, exerciseIds: ['xx'] }, SLOTS_W[4]!] });
    expect(days.flatMap((d) => d.records).every((r) => r.exerciseId === 'cu')).toBe(true);
    expect(days[35]!.events).toContain('BLOCK_ROTATED');
    expect(days[35]!.block.selections.squat).toBe('xx');
  });

  it('performs only the sets that remain after the time repair', () => {
    const slots = SLOTS_W.filter((s) => ['curl', 'core'].includes(s.id)).map((s) =>
      s.id === 'curl'
        ? { ...s, restSec: 500 }
        : { ...s, timeRange: [300, 300] as [number, number], restSec: 1200 },
    );
    const day = run({ days: 1, slots })[0]!;
    expect(day.output!.result.kind).toBe('adjusted');
    expect(day.plan!.exposures.map((e) => e.exercise.id)).toEqual(['cu', 'pl']);
    expect(day.records.map((r) => r.sets.length)).toEqual([1, 1]);
    expect(day.records.flatMap((r) => r.sets.map((s) => s.planned.id))).toEqual(
      day.plan!.exposures.flatMap((e) => e.sets.map((s) => s.id)),
    );
    expect(day.plan!.time.exerciseTotal).toBeLessThanOrEqual(1800);
  });
});

describe('T93, T94 the phase travels with the observed exposure', () => {
  it('marks the deload history so it cannot become ordinary progression evidence', () => {
    const days = run({ days: 10, deloadRequests: new Set(['2026-10-07']) });
    const during = days.filter((d) => d.output!.phase === 'deload');
    expect(during).toHaveLength(7);
    for (const d of days) {
      expect(d.records.length).toBeGreaterThan(0);
      expect(d.records.every((r) => r.context.deload === (d.output!.phase === 'deload'))).toBe(
        true,
      );
    }
  });
});
