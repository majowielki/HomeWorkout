import { rankSubstitutes, substituteCandidates, substituteScore } from '../exercises/substitute';
import { byId, exercise } from './fixtures';

const goblet = exercise({
  id: 'goblet',
  movementPattern: 'Squat',
  primaryMuscles: ['quads', 'glutes'],
  substituteIds: ['box', 'ghost', 'goblet'],
});
const box = exercise({ id: 'box', movementPattern: 'Squat', primaryMuscles: ['quads', 'glutes'] });
const rdl = exercise({
  id: 'rdl',
  movementPattern: 'Hinge',
  primaryMuscles: ['hamstrings', 'glutes'],
});
const split = exercise({
  id: 'split',
  movementPattern: 'Lunge',
  stanceMechanics: 'UnilateralSupported',
  primaryMuscles: ['quads', 'glutes'],
});
const curl = exercise({
  id: 'curl',
  movementPattern: 'Isolation',
  isClosedKineticChain: false,
  stanceMechanics: 'Seated',
  primaryMuscles: ['biceps'],
});

describe('substituteScore', () => {
  it('adds up the SPEC §3.4 weights', () => {
    // 50 × 1 + 20 bilateral + 10 closed chain + 5 same pattern
    expect(substituteScore(goblet, box)).toBe(85);
    // 50 × 0.5 + 30 hinge + 20 + 10
    expect(substituteScore(goblet, rdl)).toBe(85);
    // 50 × 1 + 10 closed chain
    expect(substituteScore(goblet, split)).toBe(60);
    expect(substituteScore(goblet, curl)).toBe(0);
  });
});

describe('substituteCandidates', () => {
  it('puts the hand-picked ones first, then slot siblings, without repeats or ghosts', () => {
    const catalog = byId([goblet, box, rdl, split]);
    expect(
      substituteCandidates(goblet, catalog, ['split', 'box', 'goblet']).map((e) => e.id),
    ).toEqual(['box', 'split']);
  });

  it('works without siblings', () => {
    expect(substituteCandidates(goblet, byId([box])).map((e) => e.id)).toEqual(['box']);
  });
});

describe('rankSubstitutes', () => {
  const all = () => true;

  it('orders by score, ties in the order given, and cuts at the threshold', () => {
    expect(rankSubstitutes(goblet, [split, rdl, box, curl, goblet], all)).toEqual([
      { exercise: rdl, score: 85 },
      { exercise: box, score: 85 },
      { exercise: split, score: 60 },
    ]);
  });

  it('skips what is not allowed', () => {
    const noRdl = (e: { id: string }) => e.id !== 'rdl';
    expect(rankSubstitutes(goblet, [rdl, box], noRdl).map((r) => r.exercise.id)).toEqual(['box']);
  });
});
