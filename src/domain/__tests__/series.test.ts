import { movingAverage, round1, weeklyTrend } from '../metrics/series';

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;

describe('movingAverage', () => {
  it('averages the trailing 7 calendar days, not the last 7 points', () => {
    // Points on days 1,2,3 then a gap, then day 10. The window ending on
    // day 10 contains only day 10 itself (days 4..10) — the earlier points
    // are more than 7 days back and must not leak in.
    const pts = [1, 2, 3, 10].map((d) => ({ date: day(d), value: d === 10 ? 80 : 90 }));
    const out = movingAverage(pts, 7, 1);
    expect(out[3]!.average).toBe(80);
  });

  it('includes the boundary correctly: 7-day window = today and the 6 days before', () => {
    const pts = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => ({ date: day(d), value: d }));
    const out = movingAverage(pts, 7, 1);
    // day 8's window is days 2..8 -> mean of 2..8 = 5
    expect(out[7]!.average).toBe(5);
    // day 7's window is days 1..7 -> mean = 4
    expect(out[6]!.average).toBe(4);
  });

  it('returns null until minPoints are in the window', () => {
    const pts = [1, 2, 3].map((d) => ({ date: day(d), value: 80 }));
    const out = movingAverage(pts, 7, 3);
    expect(out.map((p) => p.average)).toEqual([null, null, 80]);
  });

  it('does not interpolate across missing days', () => {
    const pts = [
      { date: day(1), value: 80 },
      { date: day(5), value: 82 },
    ];
    const out = movingAverage(pts, 7, 1);
    expect(out).toHaveLength(2);
    expect(out[1]!.average).toBe(81);
  });

  it('sorts unsorted input and keeps output aligned by date', () => {
    const pts = [
      { date: day(3), value: 3 },
      { date: day(1), value: 1 },
      { date: day(2), value: 2 },
    ];
    const out = movingAverage(pts, 7, 1);
    expect(out.map((p) => p.date)).toEqual([day(1), day(2), day(3)]);
    expect(out[2]!.average).toBe(2);
  });

  it('handles empty input', () => {
    expect(movingAverage([])).toEqual([]);
  });

  it('rejects a non-positive window', () => {
    expect(() => movingAverage([], 0)).toThrow(RangeError);
  });
});

describe('weeklyTrend', () => {
  it('recovers a clean linear slope, expressed per week', () => {
    // -0.1 kg/day for 21 days -> -0.7 kg/week
    const pts = Array.from({ length: 21 }, (_, i) => ({ date: day(i + 1), value: 90 - 0.1 * i }));
    expect(round1(weeklyTrend(pts)!)).toBe(-0.7);
  });

  it('returns null with fewer than minPoints in the window', () => {
    const pts = Array.from({ length: 9 }, (_, i) => ({ date: day(i + 1), value: 90 - i }));
    expect(weeklyTrend(pts, 21, 10)).toBeNull();
  });

  it('only looks at the most recent windowDays', () => {
    // 20 days of steep loss followed by 21 flat days: the trend is flat.
    const early = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-08-${10 + i}`,
      value: 100 - i,
    }));
    const late = Array.from({ length: 21 }, (_, i) => ({ date: day(i + 1), value: 85 }));
    expect(weeklyTrend([...early, ...late], 21, 10)).toBe(0);
  });

  it('returns null for empty input', () => {
    expect(weeklyTrend([])).toBeNull();
  });

  it('returns null when every point shares a date (no x-variance)', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ date: day(1), value: 80 + i }));
    expect(weeklyTrend(pts, 21, 10)).toBeNull();
  });
});

describe('round1', () => {
  it('rounds to one decimal', () => {
    expect(round1(80.449)).toBe(80.4);
    expect(round1(80.45)).toBe(80.5);
    expect(round1(-0.05)).toBe(-0);
  });
});
