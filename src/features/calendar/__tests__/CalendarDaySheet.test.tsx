import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CalendarData } from '@/db/repositories/calendar';
import type { SessionPlan } from '@/domain/plan/types';
import { exercise } from '@/domain/__tests__/fixtures';
import { pl } from '@/strings/pl';
import { CalendarDaySheet } from '../CalendarDaySheet';

jest.mock('@/db/repositories/cardioLogs', () => ({
  logCardio: jest.fn().mockResolvedValue('ride'),
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useFocusEffect: jest.fn(),
}));
jest.mock('@gorhom/bottom-sheet', () => ({
  __esModule: true,
  ...jest.requireActual('@gorhom/bottom-sheet/mock'),
}));

const empty: CalendarData = { sessions: [], rides: [], diary: [], days: [] };
const plan: SessionPlan = {
  version: 1,
  date: '2026-10-08',
  blockIndex: 1,
  phase: 'work',
  regions: ['push'],
  bike: { minutes: 10, resistance: 1, reasons: [] },
  exercises: [],
  skipped: [],
  dayReasons: [],
  signals: [],
  estimatedMinutes: 20,
  adjustments: [],
};
const base = {
  date: '2026-10-08',
  asOf: '2026-10-07',
  data: empty,
  todayPlan: null,
  exerciseMap: {},
  busy: false,
  starting: false,
  inProgressId: null,
  onClose: jest.fn(),
  onReload: jest.fn().mockResolvedValue(undefined),
  onTraining: jest.fn(),
  onStart: jest.fn(),
  onResume: jest.fn(),
};

describe('CalendarDaySheet', () => {
  it('changes a future rest day to a training day, only on a tap', async () => {
    const onTraining = jest.fn();
    const data: CalendarData = {
      ...empty,
      days: [{ date: base.date, selection: null, forecast: null, status: 'planned' }],
    };
    await render(<CalendarDaySheet {...base} data={data} onTraining={onTraining} />);
    expect(onTraining).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Jednak trenuję'));
    expect(onTraining).toHaveBeenCalledWith(base.date, true);
    expect(screen.queryByText(pl.plan.start)).toBeNull();
    expect(screen.queryByText(pl.workout.quickCardio)).toBeNull();
  });
  it('previews a future workout without starting it and can request a rest day', async () => {
    const data = {
      ...empty,
      days: [
        {
          date: base.date,
          selection: {} as NonNullable<CalendarData['days'][number]['selection']>,
          forecast: {
            ...plan,
            exercises: [
              { label: 'A1', exerciseId: 'side', sets: 2 } as SessionPlan['exercises'][number],
            ],
          },
          status: 'planned' as const,
        },
      ],
    };
    const onTraining = jest.fn();
    await render(
      <CalendarDaySheet
        {...base}
        data={data}
        onTraining={onTraining}
        exerciseMap={{ side: exercise({ id: 'side', name: 'Deska bokiem', sides: 'perSet' }) }}
      />,
    );
    expect(screen.getByText(pl.calendar.forecastHint)).toBeTruthy();
    expect(screen.getByText('A1 · Deska bokiem · 2 serie na stronę')).toBeTruthy();
    expect(screen.getByText(pl.calendar.details)).toBeTruthy();
    expect(screen.queryByText(pl.plan.start)).toBeNull();
    await fireEvent.press(screen.getByText(pl.calendar.restAction));
    expect(onTraining).toHaveBeenCalledWith(base.date, false);
  });
  it('keeps completed days immutable while linking to recorded sessions', async () => {
    const data = {
      ...empty,
      sessions: [
        {
          workout: { id: 'done', trainingDate: '2026-10-07', status: 'completed', plan: null },
          templateName: 'FBW A',
          sets: 8,
        },
      ],
    } as unknown as CalendarData;
    await render(<CalendarDaySheet {...base} date="2026-10-07" data={data} todayPlan={plan} />);
    expect(screen.getByText('FBW A')).toBeTruthy();
    expect(screen.getByText(pl.extra.title)).toBeTruthy();
    expect(screen.getByText(/Trening ukończony.*8 serii/)).toBeTruthy();
    expect(screen.queryByText(pl.calendar.restAction)).toBeNull();
    expect(screen.queryByText(pl.calendar.trainAction)).toBeNull();
    expect(screen.queryByText(pl.plan.start)).toBeNull();
    await fireEvent.press(screen.getByText('FBW A'));
    expect(base.onClose).toHaveBeenCalledTimes(1);
  });
  it('resumes an existing session and prevents starting or changing a day alongside it', async () => {
    const resume = jest.fn();
    await render(
      <CalendarDaySheet
        {...base}
        date="2026-10-07"
        todayPlan={plan}
        inProgressId="active"
        onResume={resume}
      />,
    );
    expect(screen.queryByText(pl.plan.start)).toBeNull();
    await fireEvent.press(screen.getByText(pl.workout.resume));
    expect(resume).toHaveBeenCalledWith('active');
    await fireEvent.press(screen.getByText(pl.calendar.restAction));
    expect(base.onTraining).not.toHaveBeenCalled();
  });
  it('shows diary and rides for a past date without offering changes', async () => {
    const data = {
      ...empty,
      rides: [{ id: 'ride', trainingDate: '2026-10-01', minutes: 15, resistanceLevel: 3, rpe: 4 }],
      diary: [
        {
          date: '2026-10-01',
          sleepHours: 7,
          energy: 4,
          soreness: { quads: 2 },
          note: 'Dobry dzień',
        },
      ],
    } as unknown as CalendarData;
    await render(<CalendarDaySheet {...base} date="2026-10-01" data={data} />);
    expect(screen.getByText(/Rower · 15 min/)).toBeTruthy();
    expect(screen.getByText('Dobry dzień')).toBeTruthy();
    expect(screen.getByText(/2\/5/)).toBeTruthy();
    expect(screen.queryByText(pl.calendar.trainAction)).toBeNull();
  });
  it('blocks repeated actions during a write', async () => {
    const onTraining = jest.fn();
    await render(<CalendarDaySheet {...base} busy onTraining={onTraining} />);
    await fireEvent.press(screen.getByText(pl.calendar.trainAction));
    expect(onTraining).not.toHaveBeenCalled();
  });
});
