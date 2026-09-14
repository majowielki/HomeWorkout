import { fireEvent, render, screen } from '@testing-library/react-native';

import { getLastSetForExercise } from '@/db/repositories/setLogs';
import type { Exercise, TemplateBlock } from '@/domain/types';

import { SetLogger } from '../SetLogger';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@/db/repositories/setLogs', () => ({
  getLastSetForExercise: jest.fn(),
}));

const mockedLastSet = jest.mocked(getLastSetForExercise);

function exercise(overrides: Partial<Exercise>): Exercise {
  return {
    id: 'goblet-squat',
    name: 'Przysiad goblet',
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
    equipment: ['dumbbell'],
    dumbbellMode: 'single',
    bandSuitability: 'excellent',
    substituteIds: [],
    media: null,
    cues: ['cue'],
    kneeCue: 'Kolano nad stopą.',
    ...overrides,
  };
}

const block: TemplateBlock = {
  label: 'A1',
  exerciseId: 'goblet-squat',
  sets: 2,
  repMin: 10,
  repMax: 20,
  targetRirMin: 2,
  targetRirMax: 3,
  restSec: 120,
};

/** Minimal set_logs row shape — only the columns SetLogger reads. */
function lastSet(overrides: Partial<Awaited<ReturnType<typeof getLastSetForExercise>>>) {
  return {
    id: 'log-1',
    workoutId: 'w',
    exerciseId: 'goblet-squat',
    exerciseOrder: 0,
    setIndex: 1,
    isWarmup: false,
    reps: null,
    timeSec: null,
    rir: null,
    weightKg: null,
    dumbbellMode: null,
    bandId: null,
    anchorPosition: null,
    estimatedLoadKg: null,
    loggedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  } as NonNullable<Awaited<ReturnType<typeof getLastSetForExercise>>>;
}

describe('SetLogger', () => {
  beforeEach(() => {
    mockedLastSet.mockReset();
  });

  it('falls back to the block targets and the lightest rung on a first-ever set', async () => {
    mockedLastSet.mockResolvedValue(null);
    const onSave = jest.fn();

    await render(
      <SetLogger
        exercise={exercise({})}
        block={block}
        setNumber={1}
        totalSets={2}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText('2 kg')).toBeTruthy(); // LADDER_SINGLE[0]
    expect(screen.getByText('10')).toBeTruthy(); // block.repMin

    await fireEvent.press(screen.getByText('Zapisz serię'));

    expect(onSave).toHaveBeenCalledWith({
      reps: 10,
      timeSec: null,
      rir: 2, // block.targetRirMin
      weightKg: 2,
      dumbbellMode: 'single',
      bandId: null,
      anchorPosition: null,
    });
  });

  it('prefills from the previous log so a repeat set is one tap', async () => {
    mockedLastSet.mockResolvedValue(lastSet({ reps: 14, rir: 3, weightKg: 12 }));
    const onSave = jest.fn();

    await render(
      <SetLogger
        exercise={exercise({})}
        block={block}
        setNumber={2}
        totalSets={2}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText('12 kg')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();

    await fireEvent.press(screen.getByText('Zapisz serię'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ reps: 14, rir: 3, weightKg: 12, dumbbellMode: 'single' }),
    );
  });

  it('steps weight along the discrete ladder, not by arbitrary kilograms', async () => {
    mockedLastSet.mockResolvedValue(lastSet({ weightKg: 16 }));

    await render(
      <SetLogger
        exercise={exercise({})}
        block={block}
        setNumber={1}
        totalSets={2}
        onSave={jest.fn()}
      />,
    );
    await screen.findByText('16 kg');

    await fireEvent.press(screen.getByLabelText('Zwiększ: Hantel (jeden gryf)'));
    expect(screen.getByText('18 kg')).toBeTruthy();

    // 18 kg is the single-dumbbell ceiling; one more tap must not invent 20 kg.
    await fireEvent.press(screen.getByLabelText('Zwiększ: Hantel (jeden gryf)'));
    expect(screen.getByText('18 kg')).toBeTruthy();
  });

  it('shows band + anchor position controls instead of a weight for band work', async () => {
    mockedLastSet.mockResolvedValue(lastSet({ bandId: 'black', anchorPosition: 2 }));
    const onSave = jest.fn();

    await render(
      <SetLogger
        exercise={exercise({ id: 'band-row', equipment: ['band'], dumbbellMode: undefined })}
        block={{ ...block, exerciseId: 'band-row' }}
        setNumber={1}
        totalSets={2}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText('czarna')).toBeTruthy();
    expect(screen.queryByText(/kg$/)).toBeNull();

    await fireEvent.press(screen.getByText('P3'));
    await fireEvent.press(screen.getByText('Zapisz serię'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ weightKg: null, bandId: 'black', anchorPosition: 3 }),
    );
  });

  it('logs seconds, not reps, for an isometric hold', async () => {
    mockedLastSet.mockResolvedValue(null);
    const onSave = jest.fn();

    await render(
      <SetLogger
        exercise={exercise({
          id: 'plank',
          forceProfile: 'Isometric',
          equipment: ['mat', 'bodyweight'],
          dumbbellMode: undefined,
          loadsKnee: false,
          kneeCue: undefined,
        })}
        block={{ ...block, exerciseId: 'plank', repMin: undefined, repMax: undefined, timeSec: 45 }}
        setNumber={1}
        totalSets={2}
        onSave={onSave}
      />,
    );

    expect(await screen.findByText('45 s')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Zwiększ: Czas'));
    await fireEvent.press(screen.getByText('Zapisz serię'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ reps: null, timeSec: 50, weightKg: null, bandId: null }),
    );
  });

  it('shows the knee cue for knee-loading exercises', async () => {
    mockedLastSet.mockResolvedValue(null);
    await render(
      <SetLogger
        exercise={exercise({})}
        block={block}
        setNumber={1}
        totalSets={2}
        onSave={jest.fn()}
      />,
    );
    expect(await screen.findByText('Kolano nad stopą.')).toBeTruthy();
  });
});
