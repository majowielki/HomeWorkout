import { warmupMoves } from '../session/warmup';
import type { KneeProfile } from '../types';

const knee = (physioApproved: boolean): KneeProfile => ({
  side: 'right',
  missingCollaterals: true,
  aclReconstructed: true,
  varusThrust: true,
  physioApproved,
});

describe('warmupMoves', () => {
  it('leaves the reverse lunge out until the physio signs off', () => {
    expect(warmupMoves({ knee: knee(false) })).not.toContain('reverse-lunge');
    expect(warmupMoves({ knee: knee(true) })).toContain('reverse-lunge');
  });

  it('keeps the general moves either way, upper body first', () => {
    const moves = warmupMoves({ knee: knee(false) });
    expect(moves[0]).toBe('arm-circles');
    expect(moves).toEqual(expect.arrayContaining(['arm-swings', 'hip-hinge', 'cat-cow']));
  });

  it('includes everything without a knee profile', () => {
    expect(warmupMoves({ knee: null })).toContain('reverse-lunge');
  });
});
