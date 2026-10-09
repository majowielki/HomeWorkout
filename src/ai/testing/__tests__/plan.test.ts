import { scenario } from '../synthetic';
import { syntheticWeekContext, syntheticPlan } from '../plan';
import { CHAT_TOOLS } from '../../contract/chatTools';

it('maps actual quantities and effort without inventing a frozen prescription', () => {
  const source = scenario({ sessions: 1, olderSessions: 0 });
  const first = source.sets.find((s) => !s.isWarmup)!;
  const changed = {
    ...source,
    sets: [
      first,
      { ...first, id: 'time', reps: null, timeSec: 30, side: 'left' as const, rir: null },
      { ...first, id: 'missing', reps: null, timeSec: null },
      { ...first, id: 'orphan', workoutId: 'unknown' },
      { ...first, id: 'warmup', isWarmup: true },
      { ...first, id: 'unknown-exercise', exerciseId: 'unknown' },
    ],
    exercises: [],
  };
  const context = syntheticWeekContext(changed);
  expect(context.records).toHaveLength(3);
  expect(
    context.records.every((r) => r.sets.length === 0 && r.progressionScope === 'supplemental'),
  ).toBe(true);
  expect(context.records[1]!.extra[0]).toMatchObject({
    amount: { value: { kind: 'duration', seconds: 30 } },
    rir: { value: null },
    side: 'left',
  });
  expect(context.records[2]!.slotId).toBeNull();
});
it('excludes future workouts and reads a schema-checked day from the current engine', () => {
  const source = scenario();
  const future = { ...source.completedWorkouts[0]!, id: 'future', trainingDate: '2099-01-01' };
  expect(syntheticWeekContext({ ...source, completedWorkouts: [future] }).records).toEqual([]);
  const plan = syntheticPlan(source, 0);
  expect(CHAT_TOOLS.getPlanExplanation.output.safeParse(plan).success).toBe(true);
  expect(syntheticPlan(source, 1)).toEqual({ error: 'no_plan' });
});
