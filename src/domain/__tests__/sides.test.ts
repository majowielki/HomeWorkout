import { sideOrder } from '../session/sides';
import { DOCUMENTED_KNEE, exercise, HEALTHY } from './fixtures';

const rightKnee = { knee: { ...DOCUMENTED_KNEE, side: 'right' as const } };
const leftKnee = { knee: { ...DOCUMENTED_KNEE, side: 'left' as const } };

describe('sideOrder', () => {
  it('is null for two-sided work and for sides alternating inside a set', () => {
    expect(sideOrder(exercise({}), rightKnee)).toBeNull();
    expect(sideOrder(exercise({ sides: 'alternating' }), rightKnee)).toBeNull();
  });

  it('starts leg work on the weaker knee', () => {
    const splitSquat = exercise({ sides: 'perSet', loadsKnee: true, primaryMuscles: ['quads'] });
    const bridge = exercise({ sides: 'perSet', loadsKnee: false, primaryMuscles: ['glutes'] });
    expect(sideOrder(splitSquat, rightKnee)).toEqual(['right', 'left']);
    expect(sideOrder(bridge, rightKnee)).toEqual(['right', 'left']);
    expect(sideOrder(splitSquat, leftKnee)).toEqual(['left', 'right']);
    expect(sideOrder(splitSquat, HEALTHY)).toEqual(['left', 'right']);
  });

  it('starts everything else on the left', () => {
    const row = exercise({ sides: 'perSet', primaryMuscles: ['back'] });
    expect(sideOrder(row, rightKnee)).toEqual(['left', 'right']);
  });
});
