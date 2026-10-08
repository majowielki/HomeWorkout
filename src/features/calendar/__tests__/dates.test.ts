import { gridRange, monthGrid, monthLabel, shiftMonth } from '../dates';

describe('calendar dates', () => {
  it('keeps a fixed Monday-first grid across a year boundary', () => {
    const grid = monthGrid('2027-01');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-12-28');
    expect(grid[41]).toBe('2027-02-07');
    expect(new Set(grid).size).toBe(42);
    expect(gridRange('2027-01')).toEqual({ from: '2026-12-28', until: '2027-02-07' });
  });
  it('includes leap day and keeps dates continuous across daylight saving', () => {
    expect(monthGrid('2028-02')).toContain('2028-02-29');
    const grid = monthGrid('2026-03');
    const sunday = grid.indexOf('2026-03-29');
    expect(grid[sunday + 1]).toBe('2026-03-30');
  });
  it('moves months through January and December', () => {
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-10')).toMatch(/październik 2026/);
  });
});
