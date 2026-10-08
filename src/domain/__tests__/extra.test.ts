import { TRAINING_CONFIG } from '../config/training';
import { checkSelection } from '../plan/dayPlanner';
import { extraSessionOptions, planCustom, selectCustom } from '../plan/extra';
import { addDays } from '../time/trainingDate';
import type { HistorySet } from '../progression/history';
import { extraInput } from './extraFixtures';
import { exercise, HARD_ONLY } from './fixtures';
const set = (exerciseId: string, patch: Partial<HistorySet> = {}): HistorySet => ({
  exerciseId,
  reps: 12,
  timeSec: null,
  rir: 2,
  isWarmup: false,
  load: { kind: 'bodyweight' },
  ...patch,
});
const request = {
  id: 'r',
  kind: 'avoid_muscle' as const,
  muscles: ['triceps' as const],
  from: '2026-10-08',
  until: '2026-10-09',
  reason: 'pain' as const,
  source: 'user' as const,
  note: null,
};

describe('extra sessions', () => {
  it('selects only requested working slots, once each, without light or mobility fill', () => {
    const input = extraInput();
    const selection = selectCustom(input, ['push', 'push', 'mobility', 'unknown']);
    expect(selection.items.map((i) => i.slotId)).toEqual(['push']);
    expect(selection.items.every((i) => i.role === 'work')).toBe(true);
    expect(checkSelection(selection, input)).toEqual([]);
    const plan = planCustom(input, ['push']);
    expect(plan.kind).toBe('extra');
    expect(plan.exercises.map((e) => e.exerciseId)).toEqual(['push']);
    expect(plan.adjustments).toEqual([]);
    expect(planCustom(input, []).exercises).toEqual([]);
  });
  it.each([0, 1])(
    'blocks muscles already worked %s days ago and never re-adds light fill',
    (ago) => {
      const input = extraInput({
        sessions: [{ date: addDays('2026-10-08', -ago), sets: [set('core')] }],
      });
      const option = extraSessionOptions(input).find((o) => o.slotId === 'core')!;
      expect(option).toMatchObject({ item: null, reason: 'RECOVERING' });
      expect(planCustom(input, ['core']).exercises).toEqual([]);
    },
  );
  it('does not count warmups or RIR 5 practice as working sets', () => {
    const input = extraInput({
      sessions: [
        { date: '2026-10-08', sets: [set('legs', { isWarmup: true }), set('push', { rir: 5 })] },
      ],
    });
    expect(extraSessionOptions(input).filter((o) => o.item)).toHaveLength(4);
  });
  it('blocks high DOMS and both primary and secondary pain requests', () => {
    const input = extraInput({
      daily: [{ date: '2026-10-08', sleepHours: 7, energy: 4, soreness: { quads: 4 } }],
      constraints: [request],
    });
    expect(extraSessionOptions(input).find((o) => o.slotId === 'legs')?.reason).toBe('DOMS_HIGH');
    expect(extraSessionOptions(input).find((o) => o.slotId === 'push')?.reason).toBe(
      'AVOIDED_BY_REQUEST',
    );
    expect(planCustom(input, ['legs', 'push', 'pull']).exercises.map((e) => e.exerciseId)).toEqual([
      'pull',
    ]);
  });
  it('offers work above target but trims at the weekly maximum', () => {
    const input = extraInput({
      sessions: [{ date: '2026-10-05', sets: Array.from({ length: 5 }, () => set('push')) }],
    });
    expect(selectCustom(input, ['push']).items[0]?.sets).toBe(
      TRAINING_CONFIG.weeklyWorkingSetsPerMuscle.max - 5,
    );
    const full = extraInput({
      sessions: [{ date: '2026-10-05', sets: Array.from({ length: 6 }, () => set('push')) }],
    });
    expect(extraSessionOptions(full).find((o) => o.slotId === 'push')?.reason).toBe(
      'VOLUME_AT_MAX',
    );
  });
  it('shows missing, unknown, excluded, and medically disallowed block exercises as unavailable', () => {
    const input = extraInput({
      eligibility: { profile: HARD_ONLY, excludedIds: new Set(['push']) },
    });
    input.block.selections.pull = 'missing';
    delete input.block.selections.core;
    input.catalog = {
      ...input.catalog,
      legs: exercise({ id: 'legs', loadsKnee: true, planesOfMotion: ['Frontal'] }),
    };
    expect(
      extraSessionOptions(input).every((o) => o.item === null && o.reason === 'NO_CANDIDATE'),
    ).toBe(true);
  });
  it('respects combined daily and time limits when choices are individually available', () => {
    const input = extraInput();
    input.catalog = { ...input.catalog, pull: exercise({ id: 'pull', primaryMuscles: ['chest'] }) };
    expect(extraSessionOptions(input).filter((o) => o.item)).toHaveLength(4);
    const selection = selectCustom(input, ['push', 'pull']);
    expect(selection.items).toHaveLength(1);
    expect(selection.skipped[0]?.reason).toBe('ALREADY_TODAY');
    input.slots = input.slots.map((s) => ({ ...s, restSec: 1000 }));
    const long = planCustom(input, ['push', 'legs', 'core']);
    expect(long.estimatedMinutes).toBeLessThanOrEqual(30);
    expect(long.skipped.some((s) => s.reason === 'NOT_PICKED')).toBe(true);
  });
});
