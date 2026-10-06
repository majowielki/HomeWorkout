import { act, render, screen } from '@testing-library/react-native';

import type { Exercise } from '@/domain/types';
import { useRestTimerStore } from '@/stores/restTimerStore';

import { RestTimer } from '../RestTimer';

// RestTimer.test.tsx covers the countdown; this is what plays under it.
jest.mock('@/assets/ymove-media', () => ({
  ymoveMedia: {
    'goblet-squat': { video: 101, bodyMap: 102, info: {} },
  },
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => undefined }),
}));

jest.mock('@/lib/notifications', () => ({
  scheduleRestEndNotification: jest.fn(async () => 'notification-1'),
  cancelNotification: jest.fn(async () => undefined),
}));

const exercise = (id: string, name: string): Exercise => ({
  id,
  name,
  movementPattern: 'Squat',
  planesOfMotion: ['Sagittal'],
  isClosedKineticChain: true,
  stanceMechanics: 'Bilateral',
  forceProfile: 'ConcentricEccentric',
  loadsKnee: false,
  provokesValgusVarus: false,
  highAnteriorTibialShear: false,
  primaryMuscles: ['quads'],
  secondaryMuscles: [],
  equipment: ['bodyweight'],
  bandSuitability: 'ok',
  substituteIds: [],
  media: null,
  cues: ['cue'],
});

describe('RestTimer with the next exercise', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-14T10:00:00Z'));
    useRestTimerStore.setState({ restEndsAt: null, notificationId: null });
    await act(() => useRestTimerStore.getState().start(90, 'body'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('plays the clip of what comes next while you rest', async () => {
    await render(
      <RestTimer
        nextLabel="A1 · Przysiad goblet"
        nextExercise={exercise('goblet-squat', 'Przysiad goblet')}
        onDone={jest.fn()}
      />,
    );
    await act(() => jest.advanceTimersByTime(300));

    expect(screen.getByLabelText('Film pokazujący: Przysiad goblet')).toBeTruthy();
    expect(screen.getByText('A1 · Przysiad goblet')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy();
  });

  it('shows the label alone when the next exercise has no clip', async () => {
    await render(
      <RestTimer
        nextLabel="A2 · Deska"
        nextExercise={exercise('plank', 'Deska')}
        onDone={jest.fn()}
      />,
    );
    await act(() => jest.advanceTimersByTime(300));

    expect(screen.queryByLabelText('Film pokazujący: Deska')).toBeNull();
    expect(screen.getByText('A2 · Deska')).toBeTruthy();
  });

  it('is fine without a next exercise at all', async () => {
    await render(<RestTimer nextLabel={null} onDone={jest.fn()} />);
    await act(() => jest.advanceTimersByTime(300));

    expect(screen.getByText('1:30')).toBeTruthy();
    expect(screen.queryByText('Następne')).toBeNull();
  });
});
