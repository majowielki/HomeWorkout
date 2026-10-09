import { compileSession } from '../plan/compile';
import {
  buildSessionSteps,
  findResumeIndex,
  groupExposureIndices,
  groupsOf,
  isGroupComplete,
  isSettled,
  labelsOf,
  latestResult,
  nextPendingFrom,
  nextPendingIndex,
  type SetStates,
  type StoredResult,
} from '../session/progress';
import { compileInput, exposure, set } from './compileFixtures';
import { legalObservation } from './planV2Fixtures';

const plan = (...specs: Parameters<typeof compileInput>[0][number][]) =>
  compileSession(compileInput(specs));

/** A superset of two exercises (3 and 2 sets), a lone one, then a one-sided one. */
const day = () =>
  plan(
    exposure('a', { group: 'A', sets: [set(), set(), set()] }),
    exposure('b', { group: 'A', sets: [set(), set()] }),
    exposure('c', { sets: [set(), set()] }),
    exposure('d', { sideMode: 'per_set', sets: [set()] }),
  );

describe('where a running session stands', () => {
  it('finds the supersets by the rounds in the order of the sets, and names them A1, A2, B1…', () => {
    const p = day();
    expect(groupsOf(p)).toEqual([[0, 1], [2], [3]]);
    expect(labelsOf(p)).toEqual(['A1', 'A2', 'B1', 'C1']);
    expect(groupExposureIndices(p, 1)).toEqual([0, 1]);
    expect(groupExposureIndices(p, 3)).toEqual([3]);
  });

  it('a lone exercise whose sets run one after another is a group of its own', () => {
    const p = plan(
      exposure('a', { sets: [set(), set()] }),
      exposure('b', { sets: [set(), set()] }),
    );
    expect(groupsOf(p)).toEqual([[0], [1]]);
    expect(labelsOf(p)).toEqual(['A1', 'B1']);
    expect(groupExposureIndices(p, 7)).toEqual([7]);
  });

  it('walks the sets in the order the plan performs them, with the round, the side and the place in the exercise', () => {
    const p = day();
    const steps = buildSessionSteps(p, new Map());
    expect(steps).toHaveLength(3 + 2 + 2 + 2);
    expect(steps.every((s) => s.state === 'pending')).toBe(true);
    const first = steps[0]!;
    expect(first).toMatchObject({
      exposureIndex: 0,
      label: 'A1',
      round: 1,
      rounds: 3,
      side: null,
      stepOfExposure: 0,
      stepsInExposure: 3,
    });
    const sided = steps.filter((s) => s.exposureIndex === 3);
    expect(sided.map((s) => s.side)).toEqual(['left', 'right']);
    expect(sided.map((s) => [s.round, s.rounds, s.stepOfExposure, s.stepsInExposure])).toEqual([
      [1, 1, 0, 2],
      [1, 1, 1, 2],
    ]);
    // Superset: the rounds interleave, so the first exposure is not done three times in a row.
    expect(steps.slice(0, 4).map((s) => s.exposureIndex)).toEqual([0, 1, 0, 1]);
  });

  it('carries the cues the plan puts before a set', () => {
    const p = plan(exposure('a', { bandWarmup: true, sets: [set(), set()] }));
    expect(buildSessionSteps(p, new Map()).map((s) => s.cues)).toEqual([['BAND_WARMUP'], []]);
  });

  it('knows what became of each set, and resumes at the first one still to do', () => {
    const p = day();
    const all = buildSessionSteps(p, new Map());
    const states: SetStates = new Map([
      [all[0]!.set.id, 'performed'],
      [all[1]!.set.id, 'skipped'],
      [all[2]!.set.id, 'interrupted'],
    ]);
    const steps = buildSessionSteps(p, states);
    expect(steps.slice(0, 4).map((s) => s.state)).toEqual([
      'performed',
      'skipped',
      'interrupted',
      'pending',
    ]);
    expect(steps.slice(0, 3).every(isSettled)).toBe(true);
    expect(isSettled(steps[3]!)).toBe(false);
    expect(findResumeIndex(steps)).toBe(3);
    expect(nextPendingIndex(steps, 0)).toBe(3);
    expect(nextPendingIndex(steps, 4)).toBe(4);
    expect(nextPendingIndex(steps, -5)).toBe(3);
    expect(nextPendingIndex(steps, steps.length)).toBeNull();
  });

  it('goes round to the beginning when nothing is left after a step, and says when nothing is left at all', () => {
    const p = day();
    const all = buildSessionSteps(p, new Map());
    const states: SetStates = new Map(all.slice(1).map((s) => [s.set.id, 'performed']));
    const steps = buildSessionSteps(p, states);
    expect(nextPendingFrom(steps, 5)).toBe(0);
    expect(nextPendingFrom(steps, 0)).toBe(0);
    const done = buildSessionSteps(p, new Map(all.map((s) => [s.set.id, 'skipped'])));
    expect(nextPendingFrom(done, 3)).toBeNull();
    expect(findResumeIndex(done)).toBe(done.length);
  });

  it('a superset is complete when every set of every exercise in it is settled', () => {
    const p = day();
    const all = buildSessionSteps(p, new Map());
    const group = groupExposureIndices(p, 0);
    const mostOfIt: SetStates = new Map(
      all
        .filter((s) => group.includes(s.exposureIndex))
        .slice(1)
        .map((s) => [s.set.id, 'performed']),
    );
    expect(isGroupComplete(buildSessionSteps(p, mostOfIt), group)).toBe(false);
    const whole: SetStates = new Map(
      all.filter((s) => group.includes(s.exposureIndex)).map((s) => [s.set.id, 'performed']),
    );
    expect(isGroupComplete(buildSessionSteps(p, whole), group)).toBe(true);
    // The lone exercise after it is still to do.
    expect(isGroupComplete(buildSessionSteps(p, whole), [3])).toBe(false);
  });

  it('wraps the alphabet for a very long day', () => {
    const many = plan(
      ...Array.from({ length: 28 }, (_, i) => exposure(`e${i}`, { sets: [set()] })),
    );
    expect(labelsOf(many)[26]).toBe('A1');
  });

  it('the set taken back is the one written last', () => {
    const stored = (id: string, recordedAt: string): StoredResult => ({
      id,
      revision: 1,
      observation: legalObservation({ id, recordedAt }),
    });
    const first = stored('a', '2026-10-09T08:00:00.000Z');
    const second = stored('b', '2026-10-09T08:02:00.000Z');
    expect(latestResult([])).toBeNull();
    expect(latestResult([first, second])).toBe(second);
    expect(latestResult([second, first])).toBe(second);
  });
});
