import { compileInput, exposure, stamp } from '@/domain/__tests__/compileFixtures';
import { compileSession } from '@/domain/plan/compile';
import { pl } from '@/strings/pl';
import { workoutTitle } from '../workoutTitle';

describe('workoutTitle', () => {
  it('names the current plan from its slots', () => {
    const plan = stamp(compileSession(compileInput([exposure('a', { slotId: 'squat' })])));
    expect(workoutTitle({ planV2: plan, plan: null })).toBe('Nogi');
  });
  it('reads old plans with optional kind and keeps extra sessions identifiable', () => {
    const plan = { regions: ['lower' as const] };
    expect(
      workoutTitle({ planV2: null, plan: plan as Parameters<typeof workoutTitle>[0]['plan'] }),
    ).toBe('Nogi');
    expect(
      workoutTitle({
        planV2: null,
        plan: { ...plan, kind: 'extra' } as Parameters<typeof workoutTitle>[0]['plan'],
      }),
    ).toContain(pl.extra.title);
  });
  it('has a fallback for sessions without a plan', () => {
    expect(workoutTitle({ planV2: null, plan: null })).toBe(pl.history.noTemplate);
  });
});
