import type { CalendarData } from '@/db/repositories/calendar';
import type { SessionPlan } from '@/domain/plan/plan';

/**
 * One date of the calendar as the day sheet shows it — what happened, what
 * is planned, and whether the person may still change it. Pure, so the
 * rules of the sheet are tested without rendering it.
 */
export function calendarDay(
  data: CalendarData,
  date: string | null,
  asOf: string,
  todayPlan: SessionPlan | null,
) {
  const day = data.days.find((d) => d.date === date);
  const sessions = data.sessions.filter((s) => s.workout.trainingDate === date);
  const rides = data.rides.filter((r) => r.trainingDate === date);
  const diary = data.diary.find((d) => d.date === date);
  const completed = sessions.some((s) => s.workout.status === 'completed');
  // The day's movements were composed with the coach; taking that back hands the day to the engine.
  const composedIds = data.composed.filter((c) => c.date === date).map((c) => c.id);
  // Today's plan is the live one (it follows this morning's log); later days show the forecast.
  const plan = date === asOf ? todayPlan : (day?.forecast ?? null);
  // A trained or running day is history; only today and later may become rest or training.
  const editable =
    date !== null &&
    date >= asOf &&
    !completed &&
    !sessions.some((s) => s.workout.status === 'in_progress');
  return { day, sessions, rides, diary, completed, plan, editable, composedIds };
}
