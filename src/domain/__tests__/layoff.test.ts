import { layoffState, tierOf } from '../progression/layoff';

describe('tierOf — SPEC §6.3', () => {
  it.each([
    [0, 'none'],
    [7, 'none'],
    [8, 'short'],
    [14, 'short'],
    [15, 'medium'],
    [30, 'medium'],
    [31, 'long'],
    [120, 'long'],
  ])('%s days -> %s', (gap, tier) => {
    expect(tierOf(gap)).toBe(tier);
  });
});

describe('layoffState', () => {
  it('has nothing to say before the first session', () => {
    expect(layoffState([], '2026-10-10')).toEqual({
      tier: 'none',
      gapDays: null,
      recalibrating: false,
    });
  });

  it('measures from the latest session, ignoring future dates and repeats', () => {
    expect(
      layoffState(['2026-10-01', '2026-09-20', '2026-10-01', '2026-10-20'], '2026-10-10'),
    ).toEqual({ tier: 'short', gapDays: 9, recalibrating: false });
  });

  it('counts a session today as no gap', () => {
    expect(layoffState(['2026-10-10'], '2026-10-10')).toMatchObject({ tier: 'none', gapDays: 0 });
  });

  it('recalibrates on the first session after a long layoff ...', () => {
    expect(layoffState(['2026-08-01'], '2026-10-10')).toEqual({
      tier: 'long',
      gapDays: 70,
      recalibrating: true,
    });
  });

  it('... and the second, then progression restarts', () => {
    const back = ['2026-08-01', '2026-10-08'];
    expect(layoffState(back, '2026-10-10').recalibrating).toBe(true);
    expect(layoffState([...back, '2026-10-10'], '2026-10-11').recalibrating).toBe(false);
  });

  it('does not recalibrate after ordinary gaps', () => {
    expect(
      layoffState(['2026-10-01', '2026-10-05', '2026-10-08'], '2026-10-10').recalibrating,
    ).toBe(false);
  });
});
