import { MUSCLE_GROUPS } from '../coach/vocabulary';
import { PLANNER_CONFIG, TRAINING_CONFIG } from '../config/training';
import type { PlanConstraint } from '../plan/constraints';
import { checkSelection } from '../plan/selectionGuard';
import type { DaySelection } from '../plan/types';
import type { MuscleGroup } from '../types';
import { dayInput } from './dayFixtures';

const base = dayInput();
const slot = base.slots.find((s) => s.id === 'core-front')!;
const item = {
  slotId: slot.id,
  exerciseId: base.block.selections[slot.id]!,
  sets: 1,
  role: 'work' as const,
};
const chosen = (patch: Partial<DaySelection> = {}): DaySelection => ({
  date: base.asOf,
  blockIndex: base.block.index,
  phase: 'work',
  items: [item],
  skipped: [],
  dayReasons: [],
  ...patch,
});
const emptyVolume = () =>
  Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
const check = (
  selection = chosen(),
  input = base,
  lastPrimary: Partial<Record<MuscleGroup, string>> = {},
  volume = emptyVolume(),
) =>
  checkSelection(
    selection,
    input,
    { ...PLANNER_CONFIG, maxDirectSetsPerMuscleDay: 3 },
    TRAINING_CONFIG,
    { volume, lastPrimary },
  );
const restriction = (
  kind: PlanConstraint['kind'],
  muscles: MuscleGroup[] = [],
): PlanConstraint => ({
  id: 'request',
  kind,
  muscles,
  from: base.asOf,
  until: base.asOf,
  reason: 'other',
  source: 'user',
  note: null,
});
it('keeps a legal choice and ignores older readiness entries', () => {
  expect(check()).toEqual([]);
  expect(
    check(chosen(), {
      ...base,
      constraints: undefined,
      daily: [{ date: '2000-01-01', sleepHours: null, energy: null, soreness: { core: 5 } }],
    }),
  ).toEqual([]);
  expect(check(chosen(), base, { core: '2000-01-01' })).toEqual([]);
});
it('rejects changed phase, block and lighter-day request', () => {
  expect(check(chosen({ blockIndex: 9 }))).toContainEqual({ slotId: null, code: 'BLOCK_CHANGED' });
  expect(check(chosen({ phase: 'deload' }))).toContainEqual({
    slotId: null,
    code: 'BLOCK_CHANGED',
  });
  expect(check(chosen(), { ...base, constraints: [restriction('lighter_day')] })).toContainEqual({
    slotId: null,
    code: 'REQUEST_CHANGED',
  });
});
it.each(['exercise', 'slot', 'excluded'] as const)('rejects an unavailable %s', (reason) => {
  const input = { ...base };
  const selection = chosen();
  if (reason === 'exercise') selection.items = [{ ...item, exerciseId: 'ghost' }];
  if (reason === 'slot') selection.items = [{ ...item, slotId: 'ghost' }];
  if (reason === 'excluded')
    input.eligibility = { ...base.eligibility, excludedIds: new Set([item.exerciseId]) };
  expect(check(selection, input)).toContainEqual({
    slotId: selection.items[0]!.slotId,
    code: 'NOT_ALLOWED',
  });
});
it('rejects a changed block choice but allows a deliberate swap or mobility', () => {
  const input = { ...base, block: { ...base.block, selections: {} } };
  expect(check(chosen(), input)).toContainEqual({ slotId: slot.id, code: 'SELECTION_CHANGED' });
  expect(check(chosen({ items: [{ ...item, swapped: true }] }), input)).toEqual([]);
  expect(check(chosen({ items: [{ ...item, role: 'mobility' }] }), input)).toEqual([]);
});
it('honours avoided muscles, soreness and projected recovery for hard work', () => {
  expect(
    check(chosen(), { ...base, constraints: [restriction('avoid_muscle', ['core'])] }),
  ).toContainEqual({ slotId: slot.id, code: 'AVOIDED_BY_REQUEST' });
  const sore = {
    ...base,
    daily: [{ date: base.asOf, sleepHours: null, energy: null, soreness: { core: 5 } }],
  };
  expect(check(chosen(), sore)).toContainEqual({ slotId: slot.id, code: 'DOMS_HIGH' });
  expect(check(chosen(), { ...sore, daily: [{ ...sore.daily[0]!, soreness: null }] })).toEqual([]);
  expect(check(chosen(), base, { core: base.asOf })).toContainEqual({
    slotId: slot.id,
    code: 'RECOVERING',
  });
});
it('light work obeys soreness and avoidance; mobility only obeys avoidance', () => {
  const light = chosen({ items: [{ ...item, role: 'light' }] });
  const mobility = chosen({ items: [{ ...item, role: 'mobility' }] });
  const avoid = { ...base, constraints: [restriction('avoid_muscle', ['core'])] };
  const sore = {
    ...base,
    daily: [{ date: base.asOf, sleepHours: null, energy: null, soreness: { core: 5 } }],
  };
  expect(check(light, base)).toEqual([]);
  expect(check(light, avoid)).toContainEqual({ slotId: slot.id, code: 'AVOIDED_BY_REQUEST' });
  expect(check(light, sore)).toContainEqual({ slotId: slot.id, code: 'DOMS_HIGH' });
  expect(check(mobility, avoid)).toContainEqual({ slotId: slot.id, code: 'AVOIDED_BY_REQUEST' });
  expect(check(mobility, sore)).toEqual([]);
});
it('limits both the day and the week', () => {
  expect(check(chosen({ items: [{ ...item, sets: 4 }] }))).toContainEqual({
    slotId: null,
    code: 'VOLUME_AT_MAX',
  });
  const volume = { ...emptyVolume(), core: 20 };
  expect(check(chosen(), base, {}, volume)).toContainEqual({ slotId: null, code: 'VOLUME_AT_MAX' });
});
