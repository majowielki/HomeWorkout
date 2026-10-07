import { addDays } from '@/domain/time/trainingDate';

/** A report may still belong to yesterday before the training-day boundary. */
export function dailyLogDate(requested: string | undefined, calendarDate: string): string {
  return requested === calendarDate || requested === addDays(calendarDate, -1)
    ? requested
    : calendarDate;
}
