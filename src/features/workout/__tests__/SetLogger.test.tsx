import { fireEvent, render, screen } from '@testing-library/react-native';

import { getLastSetForExercise } from '@/db/repositories/setLogs';
import type { PlannedExercise } from '@/domain/plan/types';
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

  it('logs mini-band mobility without long-band colours, anchors or kilograms', async () => {
    mockedLastSet.mockResolvedValue(null);
    const onSave = jest.fn();
    await render(
      <SetLogger
        exercise={exercise({
          id: 'mini-band-overhead-raise',
          equipment: ['mini-band'],
          dumbbellMode: undefined,
          movementPattern: 'Mobility',
          loadsKnee: false,
        })}
        block={block}
        setNumber={1}
        totalSets={2}
        onSave={onSave}
      />,
    );
    expect(await screen.findByText(/Mini band: używaj tego samego lekkiego oporu/)).toBeTruthy();
    expect(screen.queryByText('żółta')).toBeNull();
    expect(screen.queryByText('P1')).toBeNull();
    expect(screen.queryByText('2 kg')).toBeNull();
    await fireEvent.press(screen.getByText('Seria zrobiona'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ reps: 10, weightKg: null, bandId: null, anchorPosition: null }),
    );
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

    await fireEvent.press(screen.getByText('Seria zrobiona'));

    expect(onSave).toHaveBeenCalledWith({
      reps: 10,
      timeSec: null,
      rir: 2, // block.targetRirMin
      weightKg: 2,
      dumbbellMode: 'single',
      bandId: null,
      anchorPosition: null,
      estimatedLoadKg: null,
    });
  });

  it('has no warm-up set toggle (SPEC v1.3)', async () => {
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
    await screen.findByText('2 kg');
    expect(screen.queryByText('Seria rozgrzewkowa')).toBeNull();
  });

  it('asks to pre-stretch a band before its first set only', async () => {
    mockedLastSet.mockResolvedValue(null);
    const band = exercise({ equipment: ['band'], dumbbellMode: undefined });
    const { rerender } = await render(
      <SetLogger exercise={band} block={block} setNumber={1} totalSets={2} onSave={jest.fn()} />,
    );
    expect(await screen.findByText(/rozciągnij gumę 5–10 razy/)).toBeTruthy();
    await rerender(
      <SetLogger
        key="2"
        exercise={band}
        block={block}
        setNumber={2}
        totalSets={2}
        onSave={jest.fn()}
      />,
    );
    await screen.findByText('Seria zrobiona');
    expect(screen.queryByText(/rozciągnij gumę/)).toBeNull();
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

    await fireEvent.press(screen.getByText('Seria zrobiona'));

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
    await fireEvent.press(screen.getByText('Seria zrobiona'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        weightKg: null,
        bandId: 'black',
        anchorPosition: 3,
        estimatedLoadKg: null,
      }),
    );
  });

  it('shows a calibrated band as a range, never past the measured maximum', async () => {
    mockedLastSet.mockResolvedValue(lastSet({ bandId: 'black', anchorPosition: 1 }));
    const onSave = jest.fn();
    // F(λ) = 20(λ − 1) on a 100 cm band, measured up to 12 kg. A 'Pull'
    // exercise travels 50 cm: P1 spans 130→180 cm, i.e. 6→16 kg — past 12.
    const calibrations = {
      black: {
        restLengthCm: 100,
        points: [],
        fit: { type: 'linear' as const, coeffs: [-20, 20] },
        maxMeasuredKg: 12,
      },
    };

    await render(
      <SetLogger
        exercise={exercise({
          id: 'band-row',
          equipment: ['band'],
          dumbbellMode: undefined,
          movementPattern: 'Pull',
        })}
        block={{ ...block, exerciseId: 'band-row' }}
        setNumber={1}
        totalSets={2}
        onSave={onSave}
        calibrations={calibrations}
      />,
    );

    expect(await screen.findByText('> 12 kg')).toBeTruthy();

    // P0 spans 100→150 cm: 0→10 kg, inside the calibrated range.
    await fireEvent.press(screen.getByText('P0'));
    expect(screen.getByText('≈ 0–10 kg')).toBeTruthy();

    await fireEvent.press(screen.getByText('Seria zrobiona'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ bandId: 'black', anchorPosition: 0, estimatedLoadKg: 10 }),
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
    await fireEvent.press(screen.getByText('Seria zrobiona'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ reps: null, timeSec: 50, weightKg: null, bandId: null }),
    );
  });

  it('times a hold with the stopwatch and logs what was held', async () => {
    mockedLastSet.mockResolvedValue(null);
    const onSave = jest.fn();
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

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

    await fireEvent.press(await screen.findByText('Start'));
    now.mockReturnValue(1_000_000 + 38_400);
    await fireEvent.press(screen.getByText('Stop'));
    expect(screen.getByText('38 s')).toBeTruthy();
    await fireEvent.press(screen.getByText('Seria zrobiona'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reps: null, timeSec: 38 }));
    now.mockRestore();
  });

  it('has no stopwatch for a rep-based exercise', async () => {
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
    expect(await screen.findByText('Seria zrobiona')).toBeTruthy();
    expect(screen.queryByText('Start')).toBeNull();
  });

  it('names the other half of a superset', async () => {
    mockedLastSet.mockResolvedValue(null);
    await render(
      <SetLogger
        exercise={exercise({})}
        block={block}
        setNumber={1}
        totalSets={2}
        onSave={jest.fn()}
        supersetWith="Wiosłowanie gumą"
      />,
    );
    expect(await screen.findByText(/Superseria z: Wiosłowanie gumą/)).toBeTruthy();
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

  describe('a session from the engine plan', () => {
    const planned: PlannedExercise = {
      ...block,
      slotId: 'squat',
      load: { kind: 'dumbbell', mode: 'single', kg: 8 },
      unit: 'reps',
      target: 13,
      warmupSet: false,
      reasons: ['REP_PROGRESSION'],
      confidence: 'high',
    };

    it('starts the first set from the plan, without reading the last log', async () => {
      const onSave = jest.fn();
      await render(
        <SetLogger
          exercise={exercise({})}
          block={planned}
          planned={planned}
          setNumber={1}
          totalSets={2}
          onSave={onSave}
        />,
      );
      expect(await screen.findByText('8 kg')).toBeTruthy();
      expect(screen.getByText('13')).toBeTruthy();
      expect(mockedLastSet).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByText('Seria zrobiona'));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ reps: 13, weightKg: 8, rir: 2 }),
      );
    });

    it('reads the last log for later sets and for a substitute', async () => {
      mockedLastSet.mockResolvedValue(lastSet({ weightKg: 10, reps: 12 }));
      await render(
        <SetLogger
          exercise={exercise({})}
          block={planned}
          planned={planned}
          setNumber={2}
          totalSets={2}
          onSave={jest.fn()}
        />,
      );
      expect(await screen.findByText('10 kg')).toBeTruthy();

      mockedLastSet.mockResolvedValue(null);
      await render(
        <SetLogger
          exercise={exercise({ id: 'box-squat' })}
          block={planned}
          planned={planned}
          setNumber={1}
          totalSets={2}
          onSave={jest.fn()}
        />,
      );
      expect(await screen.findByText('2 kg')).toBeTruthy();
    });

    it('prefills a band and a hold from the plan', async () => {
      const hold: PlannedExercise = {
        ...planned,
        repMin: undefined,
        repMax: undefined,
        timeSec: 30,
        unit: 'sec',
        target: 30,
        load: { kind: 'band', bandId: 'red', position: 2 },
        warmupSet: false,
      };
      const onSave = jest.fn();
      await render(
        <SetLogger
          exercise={exercise({
            equipment: ['band'],
            dumbbellMode: undefined,
            forceProfile: 'Isometric',
          })}
          block={hold}
          planned={hold}
          setNumber={1}
          totalSets={2}
          onSave={onSave}
        />,
      );
      expect(await screen.findByText('30 s')).toBeTruthy();
      await fireEvent.press(screen.getByText('Seria zrobiona'));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ timeSec: 30, bandId: 'red', anchorPosition: 2 }),
      );
    });
  });
});
