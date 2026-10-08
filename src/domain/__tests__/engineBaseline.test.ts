/**
 * Engine v2, P0.1: the golden baseline.
 *
 * What the engine plans, day by day, for three synthetic people on the shipped
 * catalogue — written out in full as a snapshot, so a change to any choice,
 * load, target or reason shows up as a readable diff and not as a hash. While
 * the engine is rebuilt this is the answer to "did this stage change plans
 * it should not have?" (07 §3: outside the cases a stage names, plans stay
 * identical). A stage that changes plans on purpose regenerates the snapshot
 * (`npx jest engineBaseline -u`) in the same commit and says why in
 * Documents/silnik-v2/UWAGI.md.
 *
 * The data is replaced from scratch in P2 (D21), so this guards the logic,
 * not anybody's history.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { type Athlete, FOLLOWS_THE_PLAN, simulate, type SimulatedDay } from '../plan/simulate';
import type { EligibilityContext } from '../plan/eligibility';
import { addDays } from '../time/trainingDate';
import type { Exercise, PlannedLoad } from '../types';
import { CONSERVATIVE, HARD_ONLY } from './fixtures';

const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotsJson);
const START = '2026-10-05';

const loadText = (l: PlannedLoad) =>
  l.kind === 'dumbbell'
    ? `${l.mode} ${l.kg}kg`
    : l.kind === 'band'
      ? `${l.bandId} P${l.position}`
      : 'bw';

/** Every decision of the engine in a day, one line each — everything a plan stage could change. */
function digest(days: readonly SimulatedDay[]): string[] {
  return days.flatMap((day) => {
    const plan = day.plan;
    const head = `${day.date} b${day.block.index}${plan?.phase === 'deload' ? ' DELOAD' : ''}${
      day.events.length > 0 ? ` [${day.events.join(',')}]` : ''
    }`;
    if (!plan) return [`${head} rest`];
    return [
      `${head} ${plan.regions.join('+') || '-'} ${plan.estimatedMinutes}min bike ${plan.bike.minutes}/${
        plan.bike.resistance ?? '-'
      }${plan.dayReasons.length > 0 ? ` ${plan.dayReasons.join(',')}` : ''}`,
      ...plan.exercises.map(
        (e) =>
          `  ${e.exerciseId} ${e.sets}x${e.target}${e.unit === 'sec' ? 's' : ''} ` +
          `${e.unit === 'sec' ? '' : `(${e.repMin}-${e.repMax}) `}${loadText(e.load)} rir ${e.targetRirMin}-${e.targetRirMax} ` +
          `${e.reasons.join(',')}`,
      ),
      ...(plan.skipped.length > 0
        ? [`  skipped ${plan.skipped.map((s) => `${s.slotId}:${s.reason}`).join(' ')}`]
        : []),
      ...(plan.adjustments.length > 0
        ? [`  adjusted ${plan.adjustments.map((a) => a.code).join(' ')}`]
        : []),
    ];
  });
}

/**
 * A person who falls one rep short on every fifth set and goes to the limit
 * on every seventh — enough misses to reach the regression, hold and
 * rep-progression paths, deterministic so the snapshot never moves on its own.
 */
const imperfect = (): Athlete => {
  let n = 0;
  return {
    amount: (planned) => {
      n += 1;
      return n % 5 === 0 ? Math.max(1, planned.target - 1) : planned.target;
    },
    rir: (planned) => (n % 7 === 0 ? 0 : planned.targetRirMin),
  };
};

const eligibility = (profile: EligibilityContext['profile']): EligibilityContext => ({
  profile,
  excludedIds: new Set(['band-row']),
});

describe('engine baseline', () => {
  it('12 weeks of daily training, the documented knee with hard exclusions only', () => {
    const days = simulate({
      start: START,
      days: 84,
      catalog,
      slots,
      eligibility: eligibility(HARD_ONLY),
      athlete: FOLLOWS_THE_PLAN,
    });
    expect(digest(days)).toMatchSnapshot();
  });

  it('8 weeks with the conservative knee profile', () => {
    const days = simulate({
      start: START,
      days: 56,
      catalog,
      slots,
      eligibility: eligibility(CONSERVATIVE),
    });
    expect(digest(days)).toMatchSnapshot();
  });

  it('10 weeks with Sundays off and a person who misses reps now and then', () => {
    const rest = new Set(Array.from({ length: 10 }, (_, w) => addDays(START, 6 + 7 * w)));
    const days = simulate({
      start: START,
      days: 70,
      catalog,
      slots,
      eligibility: eligibility(HARD_ONLY),
      restDays: rest,
      athlete: imperfect(),
    });
    expect(digest(days)).toMatchSnapshot();
  });

  it('a month away: short, medium and long layoffs, then the return', () => {
    // Trains for three weeks, then nothing for five (days 21-55), then trains again.
    const away = new Set(Array.from({ length: 35 }, (_, i) => addDays(START, 21 + i)));
    const days = simulate({
      start: START,
      days: 84,
      catalog,
      slots,
      eligibility: eligibility(HARD_ONLY),
      restDays: away,
    });
    expect(digest(days)).toMatchSnapshot();
  });

  it('is deterministic: the same run twice gives the same text', () => {
    const run = () =>
      digest(
        simulate({ start: START, days: 14, catalog, slots, eligibility: eligibility(HARD_ONLY) }),
      );
    expect(run()).toEqual(run());
  });
});
