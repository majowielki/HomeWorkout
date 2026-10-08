/**
 * Engine v2, P0.3 (13 §1, tests T01-T04): the training day follows the wall
 * clock of a time zone, not "the instant minus N hours". The two nights a
 * year the clocks change are where the old arithmetic was an hour off.
 * Poland: 2026-03-29 02:00 CET -> 03:00 CEST, 2026-10-25 03:00 CEST -> 02:00 CET.
 */

import { trainingDate, trainingDateOf } from '../time/trainingDate';

const WARSAW = 'Europe/Warsaw';
const at = (utc: string) => new Date(`${utc}Z`);

describe('T01 trainingDateOf — the night the clocks go back', () => {
  it('03:30 CET (+01) on 2026-10-25 is still the 24th with a 04:00 boundary', () => {
    expect(trainingDateOf(at('2026-10-25T02:30:00'), WARSAW, 4)).toBe('2026-10-24');
  });

  it('04:00 CET is the new day', () => {
    expect(trainingDateOf(at('2026-10-25T03:00:00'), WARSAW, 4)).toBe('2026-10-25');
  });
});

describe('T02 trainingDateOf — the night the clocks go forward', () => {
  it('04:00 and 04:30 CEST (+02) on 2026-03-29 belong to the 29th', () => {
    expect(trainingDateOf(at('2026-03-29T02:00:00'), WARSAW, 4)).toBe('2026-03-29');
    expect(trainingDateOf(at('2026-03-29T02:30:00'), WARSAW, 4)).toBe('2026-03-29');
  });

  it('03:59 CEST is still the 28th', () => {
    expect(trainingDateOf(at('2026-03-29T01:59:00'), WARSAW, 4)).toBe('2026-03-28');
  });
});

describe('T03 trainingDateOf — repeated and skipped hours, boundaries, calendar edges', () => {
  it('the repeated 02:00-02:59 hour is the previous day both times for a 04:00 boundary', () => {
    expect(trainingDateOf(at('2026-10-25T00:30:00'), WARSAW, 4)).toBe('2026-10-24'); // 02:30 CEST
    expect(trainingDateOf(at('2026-10-25T01:30:00'), WARSAW, 4)).toBe('2026-10-24'); // 02:30 CET
  });

  it('a boundary in the skipped hour starts the day at the first local time that exists', () => {
    // 02:00-02:59 does not exist on 2026-03-29; 01:59 CET is followed by 03:00 CEST.
    expect(trainingDateOf(at('2026-03-29T00:59:00'), WARSAW, 2)).toBe('2026-03-28');
    expect(trainingDateOf(at('2026-03-29T01:00:00'), WARSAW, 2)).toBe('2026-03-29');
  });

  it.each([
    [0, '2026-09-12T22:30:00', '2026-09-13'], // 00:30 local, boundary at midnight
    [2, '2026-09-12T23:59:00', '2026-09-12'], // 01:59 local
    [2, '2026-09-13T00:00:00', '2026-09-13'], // 02:00 local
    [23, '2026-09-12T20:59:00', '2026-09-11'], // 22:59 local, boundary 23:00
    [23, '2026-09-12T21:00:00', '2026-09-12'], // 23:00 local
  ])('boundary %i at %s UTC gives %s', (boundary, utc, expected) => {
    expect(trainingDateOf(at(utc), WARSAW, boundary)).toBe(expected);
  });

  it('crosses midnight, month and year', () => {
    expect(trainingDateOf(at('2026-12-31T23:30:00'), WARSAW, 4)).toBe('2026-12-31'); // 00:30 on 1 Jan
    expect(trainingDateOf(at('2027-01-01T01:00:00'), WARSAW, 4)).toBe('2026-12-31');
    expect(trainingDateOf(at('2026-05-31T23:30:00'), WARSAW, 4)).toBe('2026-05-31');
  });

  it('handles 29 February of a leap year', () => {
    expect(trainingDateOf(at('2028-02-29T23:30:00'), WARSAW, 4)).toBe('2028-02-29'); // 00:30 on 1 Mar
    expect(trainingDateOf(at('2028-03-01T04:00:00'), WARSAW, 4)).toBe('2028-03-01'); // 05:00
  });

  it('gives the same instant a different day in different zones', () => {
    const instant = at('2026-09-12T23:30:00');
    expect(trainingDateOf(instant, WARSAW, 4)).toBe('2026-09-12'); // 01:30 on the 13th
    expect(trainingDateOf(instant, 'America/New_York', 4)).toBe('2026-09-12'); // 19:30
    expect(trainingDateOf(instant, 'Asia/Tokyo', 4)).toBe('2026-09-13'); // 08:30 on the 13th
  });

  it('rejects an invalid instant, an unknown zone and a boundary outside 0-23', () => {
    expect(() => trainingDateOf(new Date(NaN), WARSAW, 4)).toThrow(RangeError);
    expect(() => trainingDateOf(new Date(), 'Mars/Olympus', 4)).toThrow(RangeError);
    expect(() => trainingDateOf(new Date(), WARSAW, 24)).toThrow(RangeError);
    expect(() => trainingDateOf(new Date(), WARSAW, 1.5)).toThrow(RangeError);
  });
});

describe('T04 the day belongs to the session start, whatever happens later', () => {
  it('a session across midnight keeps one training day with the default boundary', () => {
    const start = at('2026-09-12T21:50:00'); // 23:50 Warsaw
    const finish = at('2026-09-12T22:40:00'); // 00:40 Warsaw
    expect(trainingDateOf(start, WARSAW, 4)).toBe(trainingDateOf(finish, WARSAW, 4));
  });

  it('changing the boundary or the zone afterwards would move the day — so it is read once, at the start', () => {
    // The repositories freeze `plan.date` when a session starts and never recompute it;
    // this pins why that matters: the same instant maps to different days under other settings.
    const finish = at('2026-09-12T22:40:00'); // 00:40 Warsaw
    expect(trainingDateOf(finish, WARSAW, 4)).toBe('2026-09-12');
    expect(trainingDateOf(finish, WARSAW, 0)).toBe('2026-09-13');
    expect(trainingDateOf(finish, 'America/New_York', 4)).toBe('2026-09-12');
  });
});

describe('trainingDate — the device zone, across the clock changes', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = WARSAW;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('T01 on the device: 03:30 CET on 2026-10-25 is the 24th', () => {
    expect(trainingDate(at('2026-10-25T02:30:00'), 4)).toBe('2026-10-24');
  });

  it('T02 on the device: 04:00 CEST on 2026-03-29 is the 29th, 03:59 the 28th', () => {
    expect(trainingDate(at('2026-03-29T02:00:00'), 4)).toBe('2026-03-29');
    expect(trainingDate(at('2026-03-29T01:59:00'), 4)).toBe('2026-03-28');
  });

  it('T03 on the device: the repeated hour is the previous day both times', () => {
    expect(trainingDate(at('2026-10-25T00:30:00'), 4)).toBe('2026-10-24');
    expect(trainingDate(at('2026-10-25T01:30:00'), 4)).toBe('2026-10-24');
  });

  it('agrees with trainingDateOf for every half hour across both change-over days', () => {
    for (const day of ['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25']) {
      const base = Date.parse(`${day}T00:00:00Z`) - 3 * 3600_000;
      for (let i = 0; i < 2 * 36; i += 1) {
        const instant = new Date(base + i * 1800_000);
        expect(trainingDate(instant, 4)).toBe(trainingDateOf(instant, WARSAW, 4));
      }
    }
  });

  it('rejects an invalid instant', () => {
    expect(() => trainingDate(new Date(NaN), 4)).toThrow(RangeError);
  });
});
