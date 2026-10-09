import { defaultPreferences } from '../preferences/preferences';
import { BASE_POLICY, resolveDayPolicy, volumeTargets } from '../policy/dayPolicy';

describe('the weekly volume of the day policy (12 §5.4, D32)', () => {
  it('is the config’s own for the standard profile, with the maxima of the muscles many slots train', () => {
    const v = volumeTargets(defaultPreferences());
    expect(v.weekly).toEqual({ min: 3, target: 4, max: 6 });
    expect(v.maxOf('glutes')).toBe(8);
    expect(v.maxOf('back')).toBe(8);
    expect(v.maxOf('biceps')).toBe(6);
  });

  it('is 4/6/10 for the higher profile, and no muscle falls below it', () => {
    const v = volumeTargets({ ...defaultPreferences(), volumeProfile: 'higher' });
    expect(v.weekly).toEqual({ min: 4, target: 6, max: 10 });
    expect(v.maxOf('glutes')).toBe(10);
    expect(v.maxOf('biceps')).toBe(10);
  });

  it('puts the person’s own maximum of a muscle before the profile’s', () => {
    const v = volumeTargets({
      ...defaultPreferences(),
      volumeProfile: 'higher',
      volumeOverrides: { biceps: 7, glutes: 4 },
    });
    expect(v.maxOf('biceps')).toBe(7);
    expect(v.maxOf('glutes')).toBe(4);
    expect(v.maxOf('chest')).toBe(10);
  });

  it('reaches the planner through the policy of every intent', () => {
    const prefs = { ...defaultPreferences(), volumeProfile: 'higher' as const };
    for (const intent of ['auto_day', 'extra', 'compose', 'template', 'session_change'] as const) {
      const policy = resolveDayPolicy(BASE_POLICY, undefined, intent, prefs);
      expect(policy.training.weeklyWorkingSetsPerMuscle).toEqual({ min: 4, target: 6, max: 10 });
      expect(
        policy.training.maxDirectSetsOverride.glutes ??
          policy.training.weeklyWorkingSetsPerMuscle.max,
      ).toBe(10);
    }
    expect(
      resolveDayPolicy(BASE_POLICY, undefined, 'auto_day').training.weeklyWorkingSetsPerMuscle.max,
    ).toBe(6);
  });
});
