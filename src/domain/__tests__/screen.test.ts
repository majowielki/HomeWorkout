import { isAllowed, screenExercise } from '../exercises/screen';
import type { Exercise, MedicalProfile } from '../types';

/** Minimal valid exercise; tests override only what they assert on. */
function exercise(overrides: Partial<Exercise>): Exercise {
  return {
    id: 'test',
    name: 'Test',
    movementPattern: 'Squat',
    planesOfMotion: ['Sagittal'],
    isClosedKineticChain: true,
    stanceMechanics: 'Bilateral',
    forceProfile: 'ConcentricEccentric',
    loadsKnee: true,
    provokesValgusVarus: false,
    highAnteriorTibialShear: false,
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: ['bodyweight'],
    bandSuitability: 'ok',
    substituteIds: [],
    media: null,
    cues: ['cue'],
    kneeCue: 'knee',
    ...overrides,
  };
}

/** The actual user: right knee, no collaterals, ACL graft, varus thrust. */
const conservative: MedicalProfile = {
  knee: {
    side: 'right',
    missingCollaterals: true,
    aclReconstructed: true,
    varusThrust: true,
    physioApproved: false,
  },
};

const physioApproved: MedicalProfile = {
  knee: { ...conservative.knee!, physioApproved: true },
};

const healthy: MedicalProfile = { knee: null };

describe('screenExercise — the loadsKnee gate', () => {
  it('allows a frontal-plane exercise that does not load the knee (lateral raise)', () => {
    const lateralRaise = exercise({
      movementPattern: 'Isolation',
      planesOfMotion: ['Frontal'],
      loadsKnee: false,
      isClosedKineticChain: false,
      primaryMuscles: ['shoulders'],
    });
    expect(screenExercise(lateralRaise, conservative)).toEqual([]);
  });

  it('allows a transverse-plane exercise that does not load the knee (floor flyes)', () => {
    const flyes = exercise({
      movementPattern: 'Isolation',
      planesOfMotion: ['Transverse'],
      loadsKnee: false,
      isClosedKineticChain: false,
      stanceMechanics: 'Supine',
      primaryMuscles: ['chest'],
    });
    expect(screenExercise(flyes, conservative)).toEqual([]);
  });

  it('allows anti-rotation core work (Pallof press) despite the transverse plane', () => {
    const pallof = exercise({
      movementPattern: 'Core',
      planesOfMotion: ['Transverse'],
      loadsKnee: false,
      isClosedKineticChain: false,
      forceProfile: 'Isometric',
      primaryMuscles: ['core'],
    });
    expect(isAllowed(pallof, conservative)).toBe(true);
  });
});

describe('screenExercise — hard knee exclusions', () => {
  it('rejects a frontal-plane knee exercise (lateral lunge) with both codes', () => {
    const lateralLunge = exercise({
      movementPattern: 'Lunge',
      planesOfMotion: ['Frontal', 'Sagittal'],
      stanceMechanics: 'UnilateralSupported',
      provokesValgusVarus: true,
    });
    const codes = screenExercise(lateralLunge, conservative);
    expect(codes).toContain('KNEE_FRONTAL_PLANE');
    expect(codes).toContain('KNEE_VALGUS_VARUS');
  });

  it('rejects open-chain quad extension even with a band', () => {
    const legExtension = exercise({
      movementPattern: 'Isolation',
      isClosedKineticChain: false,
      stanceMechanics: 'Seated',
      highAnteriorTibialShear: true,
      equipment: ['band'],
    });
    expect(screenExercise(legExtension, conservative)).toEqual(['KNEE_OPEN_CHAIN_QUAD']);
  });

  it('rejects skater jumps on three counts at once', () => {
    const skaterJumps = exercise({
      movementPattern: 'Lunge',
      planesOfMotion: ['Frontal', 'Transverse'],
      stanceMechanics: 'UnilateralUnsupported',
      forceProfile: 'Plyometric',
      provokesValgusVarus: true,
    });
    const codes = screenExercise(skaterJumps, conservative);
    expect(codes).toEqual(
      expect.arrayContaining([
        'KNEE_FRONTAL_PLANE',
        'KNEE_TRANSVERSE_PLANE',
        'KNEE_VALGUS_VARUS',
        'KNEE_UNILATERAL_UNSUPPORTED',
        'KNEE_PLYOMETRIC',
      ]),
    );
  });

  it('rejects single-leg RDL as unsupported unilateral, even after physio approval', () => {
    const slRdl = exercise({ movementPattern: 'Hinge', stanceMechanics: 'UnilateralUnsupported' });
    expect(screenExercise(slRdl, conservative)).toEqual(['KNEE_UNILATERAL_UNSUPPORTED']);
    expect(screenExercise(slRdl, physioApproved)).toEqual(['KNEE_UNILATERAL_UNSUPPORTED']);
  });

  it('rejects an offset carry via the valgus/varus flag alone (suitcase carry)', () => {
    // Sagittal movement, bilateral stance — only the flag catches it.
    const suitcase = exercise({
      movementPattern: 'Carry',
      forceProfile: 'Isometric',
      provokesValgusVarus: true,
    });
    expect(screenExercise(suitcase, conservative)).toEqual(['KNEE_VALGUS_VARUS']);
  });
});

describe('screenExercise — conservative mode until physio sign-off', () => {
  const splitSquat = exercise({ movementPattern: 'Lunge', stanceMechanics: 'UnilateralSupported' });

  it('holds back supported-unilateral work before approval', () => {
    expect(screenExercise(splitSquat, conservative)).toEqual(['KNEE_UNILATERAL_PENDING_PHYSIO']);
  });

  it('releases it after approval', () => {
    expect(screenExercise(splitSquat, physioApproved)).toEqual([]);
  });

  it('does not double-flag an exercise already excluded as unsupported', () => {
    const pistol = exercise({ stanceMechanics: 'UnilateralUnsupported' });
    expect(screenExercise(pistol, conservative)).toEqual(['KNEE_UNILATERAL_UNSUPPORTED']);
  });
});

describe('screenExercise — always allowed', () => {
  it('allows goblet squat', () => {
    expect(isAllowed(exercise({ equipment: ['dumbbell'] }), conservative)).toBe(true);
  });

  it('allows the stationary bike', () => {
    const bike = exercise({
      movementPattern: 'Cardio',
      stanceMechanics: 'Seated',
      equipment: ['bike'],
    });
    expect(isAllowed(bike, conservative)).toBe(true);
  });

  it('allows the glute bridge (supine, sagittal, closed chain)', () => {
    const bridge = exercise({ movementPattern: 'Hinge', stanceMechanics: 'Supine' });
    expect(isAllowed(bridge, conservative)).toBe(true);
  });

  it('allows everything for a profile with no knee condition', () => {
    const skaterJumps = exercise({
      planesOfMotion: ['Frontal', 'Transverse'],
      stanceMechanics: 'UnilateralUnsupported',
      forceProfile: 'Plyometric',
      provokesValgusVarus: true,
      highAnteriorTibialShear: true,
      isClosedKineticChain: false,
    });
    expect(isAllowed(skaterJumps, healthy)).toBe(true);
  });
});

describe('screenExercise — profile variants', () => {
  it('skips plane rules when collaterals are intact and there is no varus thrust', () => {
    const intactCollaterals: MedicalProfile = {
      knee: {
        side: 'right',
        missingCollaterals: false,
        aclReconstructed: true,
        varusThrust: false,
        physioApproved: true,
      },
    };
    const lateralLunge = exercise({
      planesOfMotion: ['Frontal'],
      stanceMechanics: 'UnilateralSupported',
      provokesValgusVarus: true,
    });
    expect(screenExercise(lateralLunge, intactCollaterals)).toEqual([]);
  });

  it('skips the open-chain rule when the ACL is native', () => {
    const noAclGraft: MedicalProfile = {
      knee: {
        side: 'right',
        missingCollaterals: true,
        aclReconstructed: false,
        varusThrust: true,
        physioApproved: true,
      },
    };
    const legExtension = exercise({
      isClosedKineticChain: false,
      stanceMechanics: 'Seated',
      highAnteriorTibialShear: true,
    });
    expect(screenExercise(legExtension, noAclGraft)).toEqual([]);
  });
});
