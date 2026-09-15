import {
  DEFAULT_REMINDER_SETTINGS,
  isMuted,
  muteUntilDate,
  nextWeightReminderAt,
  nextWorkoutReminderAt,
  type ReminderSettings,
} from '../reminders/schedule';

const settings: ReminderSettings = {
  weight: { enabled: true, hour: 7, minute: 0 },
  workout: { enabled: true, afterDays: 3, hour: 17, minute: 0 },
  mutedUntil: null,
};

// Local-time constructor: the app schedules against the phone's clock.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('nextWeightReminderAt', () => {
  it('fires today when the slot is still ahead and there is no entry yet', () => {
    const now = at(2026, 9, 15, 6, 30);
    expect(nextWeightReminderAt(settings, false, now)).toEqual(at(2026, 9, 15, 7, 0));
  });

  it('skips to tomorrow when today already has an entry', () => {
    const now = at(2026, 9, 15, 6, 30);
    expect(nextWeightReminderAt(settings, true, now)).toEqual(at(2026, 9, 16, 7, 0));
  });

  it('skips to tomorrow when the slot has already passed today', () => {
    const now = at(2026, 9, 15, 9, 0);
    expect(nextWeightReminderAt(settings, false, now)).toEqual(at(2026, 9, 16, 7, 0));
  });

  it('returns null when disabled', () => {
    const off = { ...settings, weight: { ...settings.weight, enabled: false } };
    expect(nextWeightReminderAt(off, false, at(2026, 9, 15, 6))).toBeNull();
  });

  it('returns null while muted', () => {
    const muted = { ...settings, mutedUntil: '2026-09-20' };
    expect(nextWeightReminderAt(muted, false, at(2026, 9, 15, 6))).toBeNull();
  });

  it('rolls over a month boundary', () => {
    const now = at(2026, 9, 30, 9, 0);
    expect(nextWeightReminderAt(settings, false, now)).toEqual(at(2026, 10, 1, 7, 0));
  });
});

describe('nextWorkoutReminderAt', () => {
  it('fires afterDays after the last session, at the configured time', () => {
    const now = at(2026, 9, 15, 10, 0);
    expect(nextWorkoutReminderAt(settings, '2026-09-14', now)).toEqual(at(2026, 9, 17, 17, 0));
  });

  it('falls back to tomorrow once that moment has passed', () => {
    // last session 10 days ago: candidate (13th 17:00) is behind us
    const now = at(2026, 9, 20, 10, 0);
    expect(nextWorkoutReminderAt(settings, '2026-09-10', now)).toEqual(at(2026, 9, 21, 17, 0));
  });

  it('fires today if the candidate is later today', () => {
    const now = at(2026, 9, 17, 10, 0);
    expect(nextWorkoutReminderAt(settings, '2026-09-14', now)).toEqual(at(2026, 9, 17, 17, 0));
  });

  it('never fires without any session history', () => {
    expect(nextWorkoutReminderAt(settings, null, at(2026, 9, 15))).toBeNull();
  });

  it('returns null when disabled or muted', () => {
    const off = { ...settings, workout: { ...settings.workout, enabled: false } };
    expect(nextWorkoutReminderAt(off, '2026-09-14', at(2026, 9, 15))).toBeNull();
    const muted = { ...settings, mutedUntil: '2026-09-20' };
    expect(nextWorkoutReminderAt(muted, '2026-09-14', at(2026, 9, 15))).toBeNull();
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
  });

  it('defaults are sane', () => {
    expect(DEFAULT_REMINDER_SETTINGS.weight.hour).toBe(7);
    expect(DEFAULT_REMINDER_SETTINGS.workout.afterDays).toBe(3);
    expect(DEFAULT_REMINDER_SETTINGS.mutedUntil).toBeNull();
  });
});
