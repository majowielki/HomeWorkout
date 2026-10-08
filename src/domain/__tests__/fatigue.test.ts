import {
  type FatigueInput,
  fatigueSignals,
  warrantsReactiveDeload,
} from '../autoregulation/fatigue';
import { slotByExercise } from '../plan/eligibility';
import type { DailyReadiness } from '../plan/types';
import type { HistorySession, HistorySet } from '../progression/history';
import type { PlannedLoad } from '../types';
import { byId, exercise, slot } from './fixtures';

const ASOF = '2026-10-20';
const db = (kg: number): PlannedLoad => ({ kind: 'dumbbell', mode: 'paired', kg });

const squat = exercise({ id: 'squat', equipment: ['dumbbell'], dumbbellMode: 'paired' });
const curl = exercise({ id: 'curl', equipment: ['dumbbell'], dumbbellMode: 'paired' });
const row = exercise({ id: 'row', equipment: ['band'] });
const slots = [
  slot({ id: 'squat', kind: 'compound', exerciseIds: ['squat'], repRange: [8, 15] }),
  slot({ id: 'curl', kind: 'accessory', exerciseIds: ['curl'], repRange: [8, 15] }),
  slot({ id: 'row', kind: 'compound', exerciseIds: ['row'], repRange: [8, 15] }),
];

const set = (patch: Partial<HistorySet> = {}): HistorySet => ({
  exerciseId: 'squat',
  isWarmup: false,
  reps: 10,
  timeSec: null,
  rir: 2,
  load: db(6),
  ...patch,
});
const session = (date: string, sets: HistorySet[]): HistorySession => ({ date, sets });
const day = (date: string, patch: Partial<DailyReadiness> = {}): DailyReadiness => ({
  date,
  sleepHours: 7,
  energy: 3,
  soreness: null,
  ...patch,
});

const input = (patch: Partial<FatigueInput> = {}): FatigueInput => ({
  asOf: ASOF,
  sessions: [],
  catalog: byId([squat, curl, row]),
  slotOf: slotByExercise(slots),
  daily: [],
  ...patch,
});

describe('fatigueSignals', () => {
  it('is quiet with no data', () => {
    expect(fatigueSignals(input())).toEqual([]);
  });

  describe('FATIGUE_HIGH', () => {
    it('fires on RIR 0 in a compound in each of the last two sessions with one', () => {
      const sessions = [
        session('2026-10-15', [set({ rir: 0 })]),
        session('2026-10-17', [set({ exerciseId: 'curl', rir: 2 })]),
        session('2026-10-18', [set({ rir: 2 }), set({ rir: 0 })]),
      ];
      expect(fatigueSignals(input({ sessions }))).toEqual(['FATIGUE_HIGH']);
    });

    it('counts days, not sessions: a main and an extra session the same day are one', () => {
      const oneDay = [
        session('2026-10-18', [set({ rir: 0 })]),
        session('2026-10-18', [set({ exerciseId: 'row', rir: 0 })]),
      ];
      expect(fatigueSignals(input({ sessions: oneDay }))).toEqual([]);
      const twoDays = [session('2026-10-17', [set({ rir: 0 })]), ...oneDay];
      expect(fatigueSignals(input({ sessions: twoDays }))).toEqual(['FATIGUE_HIGH']);
    });

    it('ignores isolation work, warm-ups, unknown exercises and old sessions', () => {
      const sessions = [
        session('2026-09-01', [set({ rir: 0 })]),
        session('2026-10-15', [set({ exerciseId: 'curl', rir: 0 }), set({ rir: 2 })]),
        session('2026-10-18', [set({ isWarmup: true, rir: 0 }), set({ rir: 0 })]),
        session('2026-10-19', [set({ exerciseId: 'ghost', rir: 0 })]),
      ];
      expect(fatigueSignals(input({ sessions }))).toEqual([]);
      const once = [session('2026-10-18', [set({ rir: 0 })])];
      expect(fatigueSignals(input({ sessions: once }))).toEqual([]);
    });
  });

  describe('PERFORMANCE_DROP', () => {
    const at = (date: string, reps: number, load = db(6)) =>
      session(date, [set({ exerciseId: 'curl', reps, load })]);

    it('fires on fewer reps at the same load twice running', () => {
      const sessions = [at('2026-10-10', 12), at('2026-10-13', 11), at('2026-10-16', 10)];
      expect(fatigueSignals(input({ sessions }))).toEqual(['PERFORMANCE_DROP']);
    });

    it('does not fire on a lower load, a flat run or too few exposures', () => {
      expect(
        fatigueSignals(
          input({
            sessions: [at('2026-10-10', 12, db(8)), at('2026-10-13', 11), at('2026-10-16', 10)],
          }),
        ),
      ).toEqual([]);
      expect(
        fatigueSignals(
          input({ sessions: [at('2026-10-10', 12), at('2026-10-13', 12), at('2026-10-16', 10)] }),
        ),
      ).toEqual([]);
      expect(
        fatigueSignals(input({ sessions: [at('2026-10-13', 11), at('2026-10-16', 10)] })),
      ).toEqual([]);
    });

    it('reads band exercises on their own ladder and skips what it cannot place', () => {
      const r = (date: string, reps: number): HistorySession =>
        session(date, [
          set({
            exerciseId: 'row',
            isWarmup: true,
            load: { kind: 'band', bandId: 'red', position: 1 },
          }),
          set({ exerciseId: 'row', reps, load: { kind: 'band', bandId: 'red', position: 1 } }),
        ]);
      expect(
        fatigueSignals(
          input({ sessions: [r('2026-10-10', 12), r('2026-10-13', 11), r('2026-10-16', 10)] }),
        ),
      ).toEqual(['PERFORMANCE_DROP']);
      const orphan = exercise({ id: 'orphan' });
      expect(
        fatigueSignals(
          input({
            catalog: byId([squat, curl, row, orphan]),
            sessions: [session('2026-10-16', [set({ exerciseId: 'orphan' })])],
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('RECOVERY_LOW', () => {
    it('fires on three short nights in a row', () => {
      const daily = ['2026-10-18', '2026-10-19', '2026-10-20'].map((d) =>
        day(d, { sleepHours: 5 }),
      );
      expect(fatigueSignals(input({ daily }))).toEqual(['RECOVERY_LOW']);
    });

    it('fires on one muscle sore at 4+ for four logs running', () => {
      const daily = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map((d) =>
        day(d, { soreness: { quads: 4 } }),
      );
      expect(fatigueSignals(input({ daily }))).toEqual(['RECOVERY_LOW']);
    });

    it('needs the streak unbroken, the sleep known and the soreness high', () => {
      const daily = [
        day('2026-10-17', { sleepHours: 5, soreness: { quads: 4 } }),
        day('2026-10-18', { sleepHours: null, soreness: { quads: 3 } }),
        day('2026-10-19', { sleepHours: 5, soreness: { quads: 4 } }),
        day('2026-10-20', { sleepHours: 5, soreness: { quads: 4 } }),
      ];
      expect(fatigueSignals(input({ daily }))).toEqual([]);
    });
  });

  it('reports every signal at once, in a fixed order', () => {
    const sessions = [
      session('2026-10-10', [set({ exerciseId: 'curl', reps: 12 }), set({ rir: 0 })]),
      session('2026-10-13', [set({ exerciseId: 'curl', reps: 11 }), set({ rir: 0 })]),
      session('2026-10-16', [set({ exerciseId: 'curl', reps: 10 })]),
    ];
    const daily = ['2026-10-18', '2026-10-19', '2026-10-20'].map((d) => day(d, { sleepHours: 4 }));
    expect(fatigueSignals(input({ sessions, daily }))).toEqual([
      'FATIGUE_HIGH',
      'PERFORMANCE_DROP',
      'RECOVERY_LOW',
    ]);
  });
});

describe('warrantsReactiveDeload', () => {
  it('needs two different signals', () => {
    expect(warrantsReactiveDeload([])).toBe(false);
    expect(warrantsReactiveDeload(['FATIGUE_HIGH', 'FATIGUE_HIGH'])).toBe(false);
    expect(warrantsReactiveDeload(['FATIGUE_HIGH', 'RECOVERY_LOW'])).toBe(true);
  });
});
