import { fireEvent, render, screen } from '@testing-library/react-native';

import { loggerStep } from './loggerFixtures';
import type { Exercise } from '@/domain/types';

import { SetLogger } from '../SetLogger';

// SetLogger.test.tsx covers the fields with no clip; this is the layout with one.
jest.mock('@/assets/ymove-media', () => ({
  ymoveMedia: {
    'goblet-squat': { video: 101, bodyMap: 102, info: {} },
  },
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => undefined }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

const exercise: Exercise = {
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
};

describe('SetLogger with a clip', () => {
  it('shows the looping clip next to the title and the targets', async () => {
    await render(
      <SetLogger
        exercise={exercise}
        step={loggerStep({}, { lo: 10, target: 10, hi: 20 })}
        onSave={jest.fn()}
      />,
    );
    await screen.findByText('4 kg');

    expect(screen.getByLabelText('Film pokazujący: Przysiad goblet')).toBeTruthy();
    expect(screen.getByText('Przysiad goblet')).toBeTruthy();
    expect(screen.getByText('cel: 10–20')).toBeTruthy();
    expect(screen.getByText('odczucie: ciężko–spokojnie')).toBeTruthy();
  });

  it('opens the full description from the link', async () => {
    const onShowDetails = jest.fn();
    await render(
      <SetLogger
        exercise={exercise}
        step={loggerStep({}, { lo: 10, target: 10, hi: 20 })}
        onSave={jest.fn()}
        onShowDetails={onShowDetails}
      />,
    );
    await screen.findByText('4 kg');

    await fireEvent.press(screen.getByText('Opis i mięśnie'));
    expect(onShowDetails).toHaveBeenCalledTimes(1);
  });

  it('has no link when the caller gives it nowhere to go', async () => {
    await render(
      <SetLogger
        exercise={exercise}
        step={loggerStep({}, { lo: 10, target: 10, hi: 20 })}
        onSave={jest.fn()}
      />,
    );
    await screen.findByText('4 kg');

    expect(screen.queryByText('Opis i mięśnie')).toBeNull();
  });

  it('keeps the photo layout for an exercise without a clip', async () => {
    await render(
      <SetLogger
        exercise={{ ...exercise, id: 'no-clip' }}
        step={loggerStep({}, { lo: 10, target: 10, hi: 20 })}
        onSave={jest.fn()}
        onShowDetails={jest.fn()}
      />,
    );
    await screen.findByText('4 kg');

    expect(screen.getByLabelText('Brak zdjęcia')).toBeTruthy();
    expect(screen.queryByText('Opis i mięśnie')).toBeNull();
    expect(screen.getByText('cel: 10–20')).toBeTruthy();
  });
});
