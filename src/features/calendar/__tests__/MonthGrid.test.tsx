import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CalendarData } from '@/db/repositories/calendar';
import type { SessionPlanV2 } from '@/domain/plan/planV2';
import { pl } from '@/strings/pl';
import { MonthGrid } from '../MonthGrid';

const empty: CalendarData = { sessions: [], rides: [], diary: [], days: [], composed: [] };
const base = {
  month: '2026-10',
  asOf: '2026-10-07',
  horizon: '2026-10-13',
  data: empty,
  selected: null,
  onMonth: jest.fn(),
  onSelect: jest.fn(),
};
describe('MonthGrid', () => {
  it('allows past days and the horizon, prevents looking beyond it', async () => {
    const select = jest.fn();
    const move = jest.fn();
    await render(<MonthGrid {...base} onSelect={select} onMonth={move} />);
    await fireEvent.press(screen.getByLabelText(/wtorek, 13 października/));
    expect(select).toHaveBeenCalledWith('2026-10-13');
    await fireEvent.press(screen.getByLabelText(/środa, 14 października/));
    expect(select).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText('Następny miesiąc'));
    expect(move).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Poprzedni miesiąc'));
    expect(move).toHaveBeenCalledWith('2026-09');
  });
  it('lets the next month open when the rolling horizon crosses a month boundary', async () => {
    const move = jest.fn();
    await render(<MonthGrid {...base} asOf="2026-10-29" horizon="2026-11-04" onMonth={move} />);
    await fireEvent.press(screen.getByLabelText('Następny miesiąc'));
    expect(move).toHaveBeenCalledWith('2026-11');
  });
  it('marks planned, missed and multiple real sessions without treating an abandoned one as done', async () => {
    const data = {
      ...empty,
      days: [
        { date: '2026-10-06', status: 'missed', selection: {}, forecast: {} },
        { date: '2026-10-08', status: 'planned', selection: {}, forecast: {} },
        { date: '2026-10-07', status: 'done', selection: {}, forecast: {} },
      ],
      sessions: [
        { workout: { trainingDate: '2026-10-07', status: 'completed' } },
        { workout: { trainingDate: '2026-10-07', status: 'completed' } },
        { workout: { trainingDate: '2026-10-08', status: 'abandoned' } },
      ],
      rides: [{ trainingDate: '2026-10-07' }],
    } as unknown as CalendarData;
    await render(<MonthGrid {...base} data={data} />);
    expect(screen.getByLabelText(/6 października.*Pominięty trening/)).toBeTruthy();
    expect(screen.getByLabelText(/8 października.*Zaplanowane/)).toBeTruthy();
    const done = screen.getByLabelText(/7 października.*2 sesje siłowe/);
    expect(done.props.accessibilityLabel).toContain(pl.workout.quickCardio);
    expect(done.props.accessibilityLabel).not.toContain('Zaplanowane');
  });
  it('shows deload for the whole week, including adjacent days', async () => {
    const data: CalendarData = {
      ...empty,
      days: [
        {
          date: '2026-10-08',
          status: 'planned',
          selection: [],
          summary: {
            phase: 'deload',
            regions: [],
            composed: false,
            estimatedMinutes: 20,
            dayReasons: [],
            skipped: [],
          },
          forecast: {} as SessionPlanV2,
        },
      ],
    };
    await render(<MonthGrid {...base} data={data} />);
    expect(
      screen.getByLabelText(/^poniedziałek, 5 października/).props.accessibilityLabel,
    ).toContain(pl.plan.deloadNote);
  });
});
