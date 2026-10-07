/**
 * SPEC §10.6: twelve weeks of daily training on the shipped catalogue and
 * slots, the documented knee with hard exclusions only (the 2026-10-02
 * choice) and one exercise on the person's own "do not suggest" list.
 * The properties below must hold on every day.
 */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';

import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { PLANNER_CONFIG, TRAINING_CONFIG } from '../config/training';
import { allowedCandidates, type EligibilityContext, isEligible } from '../plan/eligibility';
import { FOLLOWS_THE_PLAN, simulate } from '../plan/simulate';
import type { PlannedExercise } from '../plan/types';
import { sideOrder } from '../session/sides';
import { buildSessionSteps } from '../session/steps';
import { addDays } from '../time/trainingDate';
import type { Exercise, MuscleGroup } from '../types';
import { countsAsVolume, maxDirectSets } from '../volume/weekly';
import { HARD_ONLY } from './fixtures';

const exercises = (exercisesJson as { exercises: Exercise[] }).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotsJson);
const eligibility: EligibilityContext = { profile: HARD_ONLY, excludedIds: new Set(['band-row']) };
const START = '2026-10-05';

const days = simulate({ start: START, days: 84, catalog, slots, eligibility });

/** Hard work: a working set (RIR ≤ 4) of an exercise that counts as volume. */
const isHard = (e: PlannedExercise) =>
  e.targetRirMin <= TRAINING_CONFIG.workingSetMaxRir && countsAsVolume(catalog[e.exerciseId]!);
const hardMuscles = (plan: { exercises: PlannedExercise[] } | null) =>
  new Set<MuscleGroup>(
    (plan?.exercises ?? []).filter(isHard).flatMap((e) => catalog[e.exerciseId]!.primaryMuscles),
  );

describe('simulation — 12 weeks of daily training', () => {
  it('plans every day', () => {
    expect(days).toHaveLength(84);
    expect(days.every((d) => d.plan !== null)).toBe(true);
  });

  it('never trains a muscle as a primary two days running', () => {
    for (let i = 1; i < days.length; i += 1) {
      const yesterday = hardMuscles(days[i - 1]!.plan);
      const clash = [...hardMuscles(days[i]!.plan)].filter((m) => yesterday.has(m));
      expect({ date: days[i]!.date, clash }).toEqual({ date: days[i]!.date, clash: [] });
    }
  });

  it('never puts two sets of one exercise back to back, one side per set included', () => {
    for (const day of days) {
      const steps = buildSessionSteps(day.plan!.exercises, {
        sidesOf: (b) => sideOrder(catalog[b.exerciseId]!, HARD_ONLY),
      });
      // A repeat is fine only when nothing else is left to put in between.
      const avoidable = steps
        .map((s, j) => ({ s, j }))
        .filter(({ s, j }) => j > 0 && s.blockIndex === steps[j - 1]!.blockIndex)
        .filter(({ s, j }) => steps.slice(j).some((t) => t.blockIndex !== s.blockIndex))
        .map(({ s }) => s.block.exerciseId);
      expect({ date: day.date, avoidable }).toEqual({ date: day.date, avoidable: [] });
    }
  });

  it("never lets a muscle's direct sets pass its weekly maximum", () => {
    for (const day of days) {
      for (const m of MUSCLE_GROUPS) {
        expect(day.primaryVolume[m]).toBeLessThanOrEqual(maxDirectSets(m));
      }
    }
  });

  it('never plans what the knee filter or the person ruled out', () => {
    const planned = days.flatMap((d) => d.plan!.exercises.map((e) => catalog[e.exerciseId]!));
    expect(planned.every((e) => isEligible(e, eligibility))).toBe(true);
    expect(planned.some((e) => e.id === 'band-row')).toBe(false);
  });

  it('fits every day into the time budget, and fills it', () => {
    const minutes = days.map((d) => d.plan!.estimatedMinutes);
    expect(Math.max(...minutes)).toBeLessThanOrEqual(PLANNER_CONFIG.sessionMinutes.max);
    expect(Math.min(...minutes)).toBeGreaterThanOrEqual(PLANNER_CONFIG.sessionMinutes.min - 2);
  });

  it('runs blocks of four weeks plus a deload week, rotating every slot', () => {
    const rotations = days.filter((d) => d.events.includes('BLOCK_ROTATED'));
    expect(rotations.map((d) => d.date)).toEqual([addDays(START, 35), addDays(START, 70)]);
    const first = days[0]!.block.selections;
    const second = rotations[0]!.block.selections;
    for (const slot of slots) {
      if (slot.kind === 'filler') continue;
      const allowed = allowedCandidates(slot, catalog, eligibility);
      if (allowed.length >= 2)
        expect([slot.id, second[slot.id]]).not.toEqual([slot.id, first[slot.id]]);
    }
  });

  it('trains every slot at least once in every full block', () => {
    for (const blockIndex of [1, 2]) {
      const inBlock = days.filter((d) => d.block.index === blockIndex);
      const seen = new Set(inBlock.flatMap((d) => d.plan!.exercises.map((e) => e.slotId)));
      for (const slot of slots) {
        if (allowedCandidates(slot, catalog, eligibility).length === 0) continue;
        expect([blockIndex, slot.id, seen.has(slot.id)]).toEqual([blockIndex, slot.id, true]);
      }
    }
  });

  it('keeps the load in a deload week and does one set', () => {
    const lastLoad = new Map<string, string>();
    for (const day of days) {
      for (const e of day.plan!.exercises) {
        if (day.plan!.phase === 'deload' && isHard(e) && e.reasons.includes('DELOAD')) {
          expect(e.sets).toBe(1);
          expect(JSON.stringify(e.load)).toBe(lastLoad.get(e.exerciseId));
        }
        lastLoad.set(e.exerciseId, JSON.stringify(e.load));
      }
    }
    expect(days.some((d) => d.plan!.phase === 'deload')).toBe(true);
  });

  it('progresses loads over the weeks for a person who does the work', () => {
    const progressed = days.flatMap((d) =>
      d.plan!.exercises.filter((e) =>
        e.reasons.some((r) => r === 'REP_TARGET_MET' || r === 'BAND_MICRO_PROGRESSION'),
      ),
    );
    expect(progressed.length).toBeGreaterThan(0);
  });
});

describe('simulation — a ten-day break', () => {
  const restDays = new Set(Array.from({ length: 10 }, (_, i) => addDays(START, 20 + i)));
  const withBreak = simulate({ start: START, days: 32, catalog, slots, eligibility, restDays });
  const back = withBreak.find((d) => d.date === addDays(START, 30))!;

  it('plans nothing on rest days and restarts the block clock', () => {
    expect(withBreak.filter((d) => d.plan === null)).toHaveLength(10);
    expect(withBreak.some((d) => d.events.includes('BLOCK_CLOCK_RESET'))).toBe(true);
  });

  it('comes back without progression', () => {
    expect(back.plan!.dayReasons).toContain('LAYOFF_SHORT');
    const progression = ['REP_TARGET_MET', 'BAND_MICRO_PROGRESSION', 'BAND_MACRO_PROGRESSION'];
    for (const e of back.plan!.exercises) {
      expect(e.reasons.filter((r) => progression.includes(r))).toEqual([]);
    }
  });
});

describe('simulation — options', () => {
  it('reads a morning log and lets a custom athlete grind', () => {
    const sore = simulate({
      start: START,
      days: 3,
      catalog,
      slots,
      eligibility,
      daily: (date) => ({ date, sleepHours: 5, energy: 3, soreness: { quads: 4 } }),
      athlete: { ...FOLLOWS_THE_PLAN, rir: () => 0 },
    });
    expect(sore[0]!.plan!.dayReasons).toContain('LOW_READINESS');
    expect(sore.every((d) => !hardMuscles(d.plan).has('quads'))).toBe(true);
  });
});
