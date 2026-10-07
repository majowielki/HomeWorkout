import { fireEvent, render, screen } from '@testing-library/react-native';

import { getRidesOn, logCardio } from '@/db/repositories/cardioLogs';
import { getProfile } from '@/db/repositories/profile';

import { RideCard } from '../RideCard';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
jest.mock('@/db/repositories/cardioLogs', () => ({
  getRidesOn: jest.fn(),
  logCardio: jest.fn(async () => 'id'),
}));
jest.mock('@/db/repositories/profile', () => ({ getProfile: jest.fn() }));

const mockedRides = jest.mocked(getRidesOn);
const mockedLog = jest.mocked(logCardio);

const ride = { minutes: 14, resistance: 3, reasons: ['BIKE_TIME_UP' as const] };

function row(minutes: number, rpe: number | null) {
  return {
    id: 'r',
    workoutId: null,
    trainingDate: '2026-10-08',
    purpose: 'cardio',
    minutes,
    resistanceLevel: 3,
    avgCadence: null,
    avgHr: null,
    rpe,
    loggedAt: '2026-10-08T18:00:00.000Z',
  } as Awaited<ReturnType<typeof getRidesOn>>[number];
}

beforeEach(() => {
  mockedRides.mockReset();
  mockedLog.mockClear();
  jest.mocked(getProfile).mockResolvedValue(null);
});

describe('RideCard', () => {
  it("offers today's ride and logs it with the dial and RPE", async () => {
    mockedRides.mockResolvedValueOnce([]).mockResolvedValueOnce([row(14, 5)]);
    await render(<RideCard asOf="2026-10-08" ride={ride} />);

    expect(await screen.findByText('Rower · 14 min, opór 3')).toBeTruthy();
    await fireEvent.press(screen.getByText('Zrobione'));
    await fireEvent.press(screen.getByLabelText('Zwiększ: RPE'));
    await fireEvent.press(screen.getByText('Zapisz jazdę'));

    expect(mockedLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workoutId: null,
        trainingDate: '2026-10-08',
        minutes: 14,
        resistanceLevel: 3,
        rpe: 1,
      }),
    );
    expect(await screen.findByText('Rower zrobiony')).toBeTruthy();
  });

  it('folds away on "Później" and comes back on a tap', async () => {
    mockedRides.mockResolvedValue([]);
    await render(<RideCard asOf="2026-10-08" ride={ride} />);
    await fireEvent.press(await screen.findByText('Później'));
    expect(screen.getByText('Rower 14 min — na później')).toBeTruthy();
    await fireEvent.press(screen.getByText('Rower 14 min — na później'));
    expect(screen.getByText('Rower · 14 min, opór 3')).toBeTruthy();
  });

  it('shows a ride already logged today instead of the plan', async () => {
    mockedRides.mockResolvedValue([row(12, 6)]);
    await render(<RideCard asOf="2026-10-08" ride={ride} />);
    expect(await screen.findByText('Rower zrobiony')).toBeTruthy();
    expect(screen.getByText('12 min · opór 3 · RPE 6')).toBeTruthy();
    expect(screen.queryByText('Później')).toBeNull();
  });
});
