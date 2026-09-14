import { buildSessionSteps, findResumeIndex, stepKey } from '../session/steps';
import type { TemplateBlock } from '../types';

function block(overrides: Partial<TemplateBlock>): TemplateBlock {
  return {
    label: 'A1',
    exerciseId: 'test',
    sets: 2,
    repMin: 8,
    repMax: 12,
    targetRirMin: 2,
    targetRirMax: 3,
    restSec: 90,
    ...overrides,
  };
}

describe('buildSessionSteps', () => {
  it('interleaves a two-exercise superset set by set', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 2 });
    const a2 = block({ label: 'A2', exerciseId: 'row', sets: 2 });

    const steps = buildSessionSteps([a1, a2]);

    expect(steps.map((s) => [s.block.exerciseId, s.setNumber])).toEqual([
      ['squat', 1],
      ['row', 1],
      ['squat', 2],
      ['row', 2],
    ]);
  });

  it('runs a solo block (no group partner) straight through', () => {
    const c2 = block({ label: 'C2', exerciseId: 'plank', sets: 3 });
    const steps = buildSessionSteps([c2]);
    expect(steps.map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it('keeps groups in their original order and does not merge unrelated groups', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 1 });
    const b1 = block({ label: 'B1', exerciseId: 'rdl', sets: 1 });
    const steps = buildSessionSteps([a1, b1]);
    expect(steps.map((s) => s.block.exerciseId)).toEqual(['squat', 'rdl']);
  });

  it('drops a shorter block once its sets are exhausted, keeping the longer one going', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 3 });
    const a2 = block({ label: 'A2', exerciseId: 'row', sets: 2 });
    const steps = buildSessionSteps([a1, a2]);
    expect(steps.map((s) => [s.block.exerciseId, s.setNumber])).toEqual([
      ['squat', 1],
      ['row', 1],
      ['squat', 2],
      ['row', 2],
      ['squat', 3],
    ]);
  });

  it('marks isLastSetOfBlock correctly per block, independent of the other block', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 1 });
    const a2 = block({ label: 'A2', exerciseId: 'row', sets: 2 });
    const steps = buildSessionSteps([a1, a2]);
    const squatStep = steps.find((s) => s.block.exerciseId === 'squat')!;
    const rowSteps = steps.filter((s) => s.block.exerciseId === 'row');
    expect(squatStep.isLastSetOfBlock).toBe(true);
    expect(rowSteps.map((s) => s.isLastSetOfBlock)).toEqual([false, true]);
  });

  it('computes the "up next" preview, and null after the final step', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 1 });
    const a2 = block({ label: 'A2', exerciseId: 'row', sets: 1 });
    const steps = buildSessionSteps([a1, a2]);
    expect(steps[0]!.next).toEqual({ block: a2, setNumber: 1 });
    expect(steps[1]!.next).toBeNull();
  });

  it('returns an empty sequence for an empty template', () => {
    expect(buildSessionSteps([])).toEqual([]);
  });

  it('falls back to the whole label as the group key if it has no letter prefix', () => {
    // Not a shape the seeded templates produce (schema enforces /^[A-Za-z]\d+$/),
    // but the grouping helper must not throw on a malformed one.
    const oddLabel = block({ label: '1', exerciseId: 'solo', sets: 1 });
    expect(buildSessionSteps([oddLabel]).map((s) => s.block.exerciseId)).toEqual(['solo']);
  });

  it('preserves blockIndex as the position in the original blocks array', () => {
    const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 1 });
    const a2 = block({ label: 'A2', exerciseId: 'row', sets: 1 });
    const steps = buildSessionSteps([a1, a2]);
    expect(steps.find((s) => s.block.exerciseId === 'squat')!.blockIndex).toBe(0);
    expect(steps.find((s) => s.block.exerciseId === 'row')!.blockIndex).toBe(1);
  });
});

describe('findResumeIndex', () => {
  const a1 = block({ label: 'A1', exerciseId: 'squat', sets: 2 });
  const a2 = block({ label: 'A2', exerciseId: 'row', sets: 2 });
  const steps = buildSessionSteps([a1, a2]);

  it('starts at 0 with no logged sets', () => {
    expect(findResumeIndex(steps, new Set())).toBe(0);
  });

  it('resumes right after the last logged step', () => {
    const logged = new Set([stepKey(0, 1), stepKey(1, 1)]);
    expect(findResumeIndex(steps, logged)).toBe(2);
  });

  it('reports completion when every step has a log', () => {
    const logged = new Set(steps.map((s) => stepKey(s.blockIndex, s.setNumber)));
    expect(findResumeIndex(steps, logged)).toBe(steps.length);
  });

  it('finds the first gap even if logs exist out of order', () => {
    // set 2 logged but set 1 missing — should resume at set 1, not treat
    // the session as further along than it is
    const logged = new Set([stepKey(0, 2), stepKey(1, 2)]);
    expect(findResumeIndex(steps, logged)).toBe(0);
  });
});
