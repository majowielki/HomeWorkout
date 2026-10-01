import { exerciseTrend, type TrendSet } from '../coach/exerciseTrend';

const db = (kg: number, reps: number | null, mode: 'paired' | 'single' = 'paired'): TrendSet => ({
  load: { kind: 'dumbbell', mode, kg },
  reps,
  timeSec: null,
});
const band = (bandId: string, position: 0 | 1 | 2 | 3, reps: number): TrendSet => ({
  load: { kind: 'band', bandId, position },
  reps,
  timeSec: null,
});
const body = (reps: number): TrendSet => ({ load: { kind: 'bodyweight' }, reps, timeSec: null });
const hold = (timeSec: number): TrendSet => ({
  load: { kind: 'bodyweight' },
  reps: null,
  timeSec,
});

describe('exerciseTrend', () => {
  it('needs two sessions with working sets', () => {
    expect(exerciseTrend([])).toEqual({ verdict: 'insufficient_data', sessions: 0 });
    expect(exerciseTrend([[db(10, 12)]])).toEqual({ verdict: 'insufficient_data', sessions: 1 });
    expect(exerciseTrend([[db(10, 12)], []])).toEqual({
      verdict: 'insufficient_data',
      sessions: 1,
    });
  });

  describe('dumbbells', () => {
    it('improved: a heavier ladder step beats any rep count', () => {
      expect(exerciseTrend([[db(8, 15)], [db(10, 8)]]).verdict).toBe('improved');
    });

    it('declined: a lighter ladder step', () => {
      expect(exerciseTrend([[db(10, 12)], [db(8, 12)]]).verdict).toBe('declined');
    });

    it('maintained: same load, reps within the tolerance either way', () => {
      expect(exerciseTrend([[db(10, 12)], [db(10, 12)]]).verdict).toBe('maintained');
      expect(exerciseTrend([[db(10, 12)], [db(10, 13)]]).verdict).toBe('maintained');
      expect(exerciseTrend([[db(10, 12)], [db(10, 11)]]).verdict).toBe('maintained');
    });

    it('improved / declined: same load, reps beyond the tolerance', () => {
      expect(exerciseTrend([[db(10, 10)], [db(10, 13)]]).verdict).toBe('improved');
      expect(exerciseTrend([[db(10, 13)], [db(10, 10)]]).verdict).toBe('declined');
    });

    it('takes the hardest set of a session, then the most reps', () => {
      const first = [db(8, 15), db(10, 8), db(10, 9), db(10, 7)];
      const last = [db(10, 10), db(8, 12)];
      expect(exerciseTrend([first, last]).verdict).toBe('maintained');
    });

    it('does not compare paired with single loads', () => {
      expect(exerciseTrend([[db(8, 12, 'single')], [db(10, 12, 'paired')]]).verdict).toBe(
        'not_comparable',
      );
    });
  });

  describe('bands', () => {
    it('a position further out is progress even for fewer reps', () => {
      expect(exerciseTrend([[band('red', 1, 15)], [band('red', 2, 12)]]).verdict).toBe('improved');
    });

    it('a position closer in is a decline', () => {
      expect(exerciseTrend([[band('red', 2, 12)], [band('red', 1, 12)]]).verdict).toBe('declined');
    });

    it('does not rank one band against another', () => {
      expect(exerciseTrend([[band('red', 3, 12)], [band('black', 0, 12)]]).verdict).toBe(
        'not_comparable',
      );
    });
  });

  describe('bodyweight and holds', () => {
    it('counts reps', () => {
      expect(exerciseTrend([[body(8)], [body(12)]]).verdict).toBe('improved');
      expect(exerciseTrend([[body(12)], [body(12)]]).verdict).toBe('maintained');
    });

    it('counts seconds with their own tolerance', () => {
      expect(exerciseTrend([[hold(30)], [hold(34)]]).verdict).toBe('maintained');
      expect(exerciseTrend([[hold(30)], [hold(40)]]).verdict).toBe('improved');
      expect(exerciseTrend([[hold(40)], [hold(30)]]).verdict).toBe('declined');
    });

    it('does not compare reps with seconds', () => {
      expect(exerciseTrend([[body(12)], [hold(30)]]).verdict).toBe('not_comparable');
    });

    it('treats a set with neither reps nor time as zero reps', () => {
      expect(exerciseTrend([[db(10, null)], [db(10, 0)]]).verdict).toBe('maintained');
    });
  });

  describe('mixed history', () => {
    it('compares with the earliest session that is comparable to the latest', () => {
      const sessions = [[band('red', 1, 12)], [db(10, 10)], [db(10, 14)]];
      const result = exerciseTrend(sessions);
      expect(result).toEqual({ verdict: 'improved', sessions: 3 });
    });

    it('ignores sessions without sets when counting', () => {
      expect(exerciseTrend([[db(8, 12)], [], [db(10, 12)]])).toEqual({
        verdict: 'improved',
        sessions: 2,
      });
    });

    it('keeps the first set of a session whose sets are not comparable', () => {
      const mixed = [db(10, 10, 'single'), db(8, 12, 'paired')];
      expect(exerciseTrend([mixed, [db(10, 10, 'single')]]).verdict).toBe('maintained');
    });
  });
});
