import type { CalendarData } from '@/db/repositories/calendar';
import type { SessionPlan } from '@/domain/plan/types';
import { calendarDay } from '../dayView';

const plan = (date: string): SessionPlan => ({
  version: 1,
  date,
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
});

const session = (date: string, status: 'completed' | 'in_progress' | 'abandoned') =>
  ({
    workout: { id: `${date}-${status}`, trainingDate: date, status, plan: null },
    templateName: null,
    sets: 0,
  }) as unknown as CalendarData['sessions'][number];

const data: CalendarData = {
  sessions: [session('2026-10-06', 'completed'), session('2026-10-08', 'in_progress')],
  rides: [],
  diary: [],
  composed: [{ id: 'compose-9', date: '2026-10-09' }],
  days: [
    {
      date: '2026-10-07',
      selection: null,
      forecast: plan('2026-10-07'),
      status: 'planned',
    },
    { date: '2026-10-09', selection: null, forecast: plan('2026-10-09'), status: 'planned' },
  ],
};

describe('a calendar day', () => {
  it('shows the live plan today and the forecast on a later day', () => {
    const live = plan('2026-10-07');
    expect(calendarDay(data, '2026-10-07', '2026-10-07', live).plan).toBe(live);
    expect(calendarDay(data, '2026-10-09', '2026-10-07', live).plan?.date).toBe('2026-10-09');
    expect(calendarDay(data, '2026-10-10', '2026-10-07', live).plan).toBeNull();
  });

  it('knows which day was composed with the coach', () => {
    expect(calendarDay(data, '2026-10-09', '2026-10-07', null).composedIds).toEqual(['compose-9']);
    expect(calendarDay(data, '2026-10-07', '2026-10-07', null).composedIds).toEqual([]);
  });

  it('lets only an untrained day from today on change', () => {
    expect(calendarDay(data, '2026-10-07', '2026-10-07', null).editable).toBe(true);
    expect(calendarDay(data, '2026-10-05', '2026-10-07', null).editable).toBe(false);
    expect(calendarDay(data, '2026-10-06', '2026-10-06', null)).toMatchObject({
      completed: true,
      editable: false,
    });
    expect(calendarDay(data, '2026-10-08', '2026-10-07', null).editable).toBe(false);
    expect(calendarDay(data, null, '2026-10-07', null).editable).toBe(false);
  });
});
