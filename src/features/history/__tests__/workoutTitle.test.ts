import { compileInput, exposure, stamp } from '@/domain/__tests__/compileFixtures';
import { compileSession } from '@/domain/plan/compile';
import { pl } from '@/strings/pl';
import { workoutTitle } from '../workoutTitle';

describe('workoutTitle', () => {
  it('names the current plan from its slots', () => {
    const plan = stamp(compileSession(compileInput([exposure('a', { slotId: 'squat' })])));
    expect(workoutTitle({ sessionPlan: plan, plan: null })).toBe('Nogi');
  });
  it('reads old plans with optional kind and keeps extra sessions identifiable', () => {
    const plan = { regions: ['lower' as const] };
    expect(
      workoutTitle({ sessionPlan: null, plan: plan as Parameters<typeof workoutTitle>[0]['plan'] }),
    ).toBe('Nogi');
    expect(
      workoutTitle({
        sessionPlan: null,
        plan: { ...plan, kind: 'extra' } as Parameters<typeof workoutTitle>[0]['plan'],
      }),
    ).toContain(pl.extra.title);
  });
  it('keeps the title of a migrated template session', () => {
    expect(workoutTitle({ sessionPlan: null, plan: { regions: [], title: 'FBW A' } })).toBe(
      'FBW A',
    );
  });
  it('has a fallback for sessions without a plan', () => {
    expect(workoutTitle({ sessionPlan: null, plan: null })).toBe(pl.history.fallbackTitle);
  });
});
