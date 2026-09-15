import {
  DEFAULT_REMINDER_SETTINGS,
  isMuted,
  isMutedOn,
  muteUntilDate,
  REMINDER_HORIZON_DAYS,
  type ReminderSettings,
  weightReminderTimes,
  workoutReminderTimes,
} from '../reminders/schedule';

const settings: ReminderSettings = {
  weight: { enabled: true, hour: 7, minute: 0 },
  workout: { enabled: true, afterDays: 3, hour: 17, minute: 0 },
  mutedUntil: null,
};

// Local-time constructor: the app schedules against the phone's clock.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('weightReminderTimes', () => {
  it('lays out one nudge per day for the whole horizon, starting today when the slot is ahead', () => {
    const now = at(2026, 9, 15, 6, 30);
    const times = weightReminderTimes(settings, false, now);
    expect(times).toHaveLength(REMINDER_HORIZON_DAYS);
    expect(times[0]).toEqual({ date: '2026-09-15', at: at(2026, 9, 15, 7, 0) });
    expect(times[1]).toEqual({ date: '2026-09-16', at: at(2026, 9, 16, 7, 0) });
    expect(times[REMINDER_HORIZON_DAYS - 1]?.date).toBe('2026-09-28');
  });

  it('drops today when it already has an entry, keeps the rest', () => {
    const now = at(2026, 9, 15, 6, 30);
    const times = weightReminderTimes(settings, true, now);
    expect(times).toHaveLength(REMINDER_HORIZON_DAYS - 1);
    expect(times[0]?.date).toBe('2026-09-16');
  });

  it('drops today once the slot has passed', () => {
    const now = at(2026, 9, 15, 9, 0);
    expect(weightReminderTimes(settings, false, now)[0]?.date).toBe('2026-09-16');
  });

  it('is empty when disabled', () => {
    const off = { ...settings, weight: { ...settings.weight, enabled: false } };
    expect(weightReminderTimes(off, false, at(2026, 9, 15, 6))).toEqual([]);
  });

  it('skips the muted days and resumes by itself afterwards', () => {
    const muted = { ...settings, mutedUntil: '2026-09-20' };
    const times = weightReminderTimes(muted, false, at(2026, 9, 15, 6));
    expect(times[0]?.date).toBe('2026-09-21');
    expect(times.every((t) => t.date > '2026-09-20')).toBe(true);
  });

  it('rolls over a month boundary and counts the horizon from today', () => {
    // horizon 3 = today (slot already passed), tomorrow, the day after
    const times = weightReminderTimes(settings, false, at(2026, 9, 30, 9, 0), 3);
    expect(times.map((t) => t.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('workoutReminderTimes', () => {
  it('starts afterDays after the last session and counts the days since it', () => {
    const now = at(2026, 9, 15, 10, 0);
    const times = workoutReminderTimes(settings, '2026-09-14', now);
    expect(times).toHaveLength(REMINDER_HORIZON_DAYS);
    expect(times[0]).toEqual({
      date: '2026-09-17',
      at: at(2026, 9, 17, 17, 0),
      daysSinceSession: 3,
    });
    expect(times[1]?.daysSinceSession).toBe(4);
  });

  it('starts today when the session is already long past, skipping a slot that has gone by', () => {
    // last session 10 days ago, 10:00 now: today's 17:00 is still ahead
    expect(workoutReminderTimes(settings, '2026-09-10', at(2026, 9, 20, 10, 0))[0]).toEqual({
      date: '2026-09-20',
      at: at(2026, 9, 20, 17, 0),
      daysSinceSession: 10,
    });
    // 18:00 now: today's slot has passed
    expect(workoutReminderTimes(settings, '2026-09-10', at(2026, 9, 20, 18, 0))[0]?.date).toBe(
      '2026-09-21',
    );
  });

  it('fires today if the candidate is later today', () => {
    const now = at(2026, 9, 17, 10, 0);
    expect(workoutReminderTimes(settings, '2026-09-14', now)[0]?.at).toEqual(
      at(2026, 9, 17, 17, 0),
    );
  });

  it('never fires without any session history', () => {
    expect(workoutReminderTimes(settings, null, at(2026, 9, 15))).toEqual([]);
  });

  it('is empty when disabled and skips muted days', () => {
    const off = { ...settings, workout: { ...settings.workout, enabled: false } };
    expect(workoutReminderTimes(off, '2026-09-14', at(2026, 9, 15))).toEqual([]);
    const muted = { ...settings, mutedUntil: '2026-09-20' };
    const times = workoutReminderTimes(muted, '2026-09-14', at(2026, 9, 15));
    expect(times[0]?.date).toBe('2026-09-21');
  });
});

describe('mute', () => {
  it('muteUntilDate covers 7 calendar days including today', () => {
    expect(muteUntilDate(at(2026, 9, 15, 12))).toBe('2026-09-21');
  });

  it('isMuted is inclusive of the mutedUntil day and false the day after', () => {
    const muted = { ...settings, mutedUntil: '2026-09-21' };
    expect(isMuted(muted, at(2026, 9, 21, 23, 59))).toBe(true);
    expect(isMuted(muted, at(2026, 9, 22, 0, 0))).toBe(false);
    expect(isMutedOn(settings, '2026-09-21')).toBe(false);
  });

  it('defaults are sane', () => {
    expect(DEFAULT_REMINDER_SETTINGS.weight.hour).toBe(7);
    expect(DEFAULT_REMINDER_SETTINGS.workout.afterDays).toBe(3);
    expect(DEFAULT_REMINDER_SETTINGS.mutedUntil).toBeNull();
  });
});
