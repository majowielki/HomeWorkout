import {
  allowedCandidates,
  type EligibilityContext,
  ineligibility,
  isEligible,
  slotByExercise,
} from '../plan/eligibility';
import { byId, CONSERVATIVE, exercise, HARD_ONLY, HEALTHY, slot } from './fixtures';

const ctx = (patch: Partial<EligibilityContext> = {}): EligibilityContext => ({
  profile: HARD_ONLY,
  excludedIds: new Set(),
  ...patch,
});

const splitSquat = exercise({
  id: 'split-squat',
  loadsKnee: true,
  stanceMechanics: 'UnilateralSupported',
});
const lateralLunge = exercise({
  id: 'lateral-lunge',
  loadsKnee: true,
  planesOfMotion: ['Frontal'],
  stanceMechanics: 'UnilateralSupported',
});

describe('ineligibility', () => {
  it('is empty for an ordinary exercise', () => {
    expect(ineligibility(exercise(), ctx())).toEqual([]);
    expect(isEligible(exercise(), ctx())).toBe(true);
  });

  it('passes the knee codes through', () => {
    expect(ineligibility(lateralLunge, ctx())).toEqual(['KNEE_FRONTAL_PLANE']);
    expect(ineligibility(splitSquat, ctx({ profile: CONSERVATIVE }))).toEqual([
      'KNEE_UNILATERAL_PENDING_PHYSIO',
    ]);
  });

  it('lets a split squat through with hard exclusions only (the 2026-10-02 choice)', () => {
    expect(isEligible(splitSquat, ctx())).toBe(true);
  });

  it("honours the person's own list", () => {
    expect(ineligibility(exercise(), ctx({ excludedIds: new Set(['test']) }))).toEqual([
      'USER_EXCLUDED',
    ]);
  });

  it('drops a retired exercise', () => {
    expect(ineligibility(exercise({ archived: true }), ctx())).toEqual(['ARCHIVED']);
  });

  it('needs all of the equipment, from the room by default', () => {
    const bike = exercise({ equipment: ['bike'] });
    expect(isEligible(bike, ctx())).toBe(true);
    expect(ineligibility(bike, ctx({ equipment: ['dumbbell', 'bodyweight'] }))).toEqual([
      'EQUIPMENT_MISSING',
    ]);
  });

  it('lists every reason at once', () => {
    const everything = { ...lateralLunge, archived: true };
    expect(
      ineligibility(everything, {
        profile: HARD_ONLY,
        excludedIds: new Set(['lateral-lunge']),
        equipment: [],
      }),
    ).toEqual(['KNEE_FRONTAL_PLANE', 'USER_EXCLUDED', 'ARCHIVED', 'EQUIPMENT_MISSING']);
  });
});

describe('allowedCandidates', () => {
  const catalog = byId([splitSquat, lateralLunge, exercise({ id: 'step-up' })]);
  const lunges = slot({
    id: 'lunge',
    exerciseIds: ['split-squat', 'ghost', 'lateral-lunge', 'step-up'],
  });

  it('keeps rotation order and drops unknown and excluded ids', () => {
    expect(allowedCandidates(lunges, catalog, ctx()).map((e) => e.id)).toEqual([
      'split-squat',
      'step-up',
    ]);
  });

  it('follows the profile', () => {
    expect(allowedCandidates(lunges, catalog, ctx({ profile: HEALTHY })).map((e) => e.id)).toEqual([
      'split-squat',
      'lateral-lunge',
      'step-up',
    ]);
  });
});

describe('slotByExercise', () => {
  it('maps every candidate to its slot', () => {
    const a = slot({ id: 'a', exerciseIds: ['x', 'y'] });
    const b = slot({ id: 'b', exerciseIds: ['z'] });
    const map = slotByExercise([a, b]);
    expect(map.get('y')).toBe(a);
    expect(map.get('z')).toBe(b);
    expect(map.get('nope')).toBeUndefined();
  });
});
