import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { directVolume } from '../plan/dayPlanner';
import { planToday, type TodayInput } from '../plan/today';
import type { Exercise } from '../types';
import { HARD_ONLY } from './fixtures';

const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotsJson);

const input = (patch: Partial<TodayInput> = {}): TodayInput => ({
  asOf: '2026-10-05',
  catalog,
  slots,
  eligibility: { profile: HARD_ONLY, excludedIds: new Set() },
  block: null,
  sessions: [],
  lastSessionDate: null,
  rides: [],
  daily: [],
  ...patch,
});

describe('planToday', () => {
  it('opens block 1 and plans the first day from it', () => {
    const today = planToday(input());
    expect(today.advance.events).toEqual(['BLOCK_STARTED']);
    expect(today.plan.blockIndex).toBe(1);
    expect(today.plan.dayReasons).toContain('FIRST_DAY');
    expect(today.plan.exercises.length).toBeGreaterThan(0);
    expect(Object.values(today.volume).every((v) => v === 0)).toBe(true);
  });

  it('plans from the stored block and reports direct volume', () => {
    const first = planToday(input());
    const sessions = [
      {
        date: '2026-10-05',
        sets: first.plan.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          isWarmup: false,
          reps: e.unit === 'reps' ? e.target : null,
          timeSec: e.unit === 'sec' ? e.target : null,
          rir: e.targetRirMin,
          load: e.load,
        })),
      },
    ];
    const next = planToday(
      input({
        asOf: '2026-10-06',
        block: first.advance.block,
        sessions,
        lastSessionDate: '2026-10-05',
      }),
    );
    expect(next.advance.events).toEqual([]);
    expect(next.plan.date).toBe('2026-10-06');
    expect(next.volume).toEqual(directVolume(sessions, catalog, '2026-10-06'));
    expect(Object.values(next.volume).some((v) => v > 0)).toBe(true);
  });
});
