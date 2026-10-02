import { bikePrescription, type Ride } from '../progression/bike';
import type { LayoffState } from '../progression/layoff';

const none: LayoffState = { tier: 'none', gapDays: 1, recalibrating: false };
const ride = (patch: Partial<Ride> = {}): Ride => ({
  date: '2026-10-01',
  minutes: 12,
  resistance: 4,
  rpe: 6,
  ...patch,
});

describe('bikePrescription — SPEC §7 v1.2', () => {
  it('starts at the minimum with the resistance left to the person', () => {
    expect(bikePrescription([], none)).toEqual({
      minutes: 10,
      resistance: null,
      reasons: ['FIRST_EXPOSURE'],
    });
  });

  it('goes back to the minimum after a medium or long layoff, keeping the dial', () => {
    expect(bikePrescription([ride()], { ...none, tier: 'medium' })).toEqual({
      minutes: 10,
      resistance: 4,
      reasons: ['LAYOFF_MEDIUM'],
    });
    expect(bikePrescription([ride()], { ...none, tier: 'long' }).reasons).toEqual(['LAYOFF_LONG']);
  });

  it('holds when the last ride has no RPE, clamped into 10-20 minutes', () => {
    expect(bikePrescription([ride({ rpe: null, minutes: 5 })], none)).toEqual({
      minutes: 10,
      resistance: 4,
      reasons: ['BIKE_HOLD'],
    });
    expect(bikePrescription([ride({ rpe: null, minutes: 30 })], none).minutes).toBe(20);
  });

  it('eases off after a hard ride', () => {
    expect(bikePrescription([ride({ rpe: 8, minutes: 14 })], none)).toEqual({
      minutes: 12,
      resistance: 4,
      reasons: ['BIKE_EASE_OFF'],
    });
    expect(bikePrescription([ride({ rpe: 9, minutes: 10 })], none).minutes).toBe(10);
  });

  it('holds a ride that was neither easy nor hard', () => {
    expect(bikePrescription([ride({ rpe: 6 })], none).reasons).toEqual(['BIKE_HOLD']);
  });

  it('adds time after an easy ride, up to the maximum', () => {
    expect(bikePrescription([ride({ rpe: 5, minutes: 12 })], none)).toEqual({
      minutes: 14,
      resistance: 4,
      reasons: ['BIKE_TIME_UP'],
    });
    expect(bikePrescription([ride({ rpe: 4, minutes: 19 })], none).minutes).toBe(20);
  });

  it('turns the dial up after two easy rides at full time', () => {
    const easy = ride({ rpe: 5, minutes: 20 });
    expect(bikePrescription([easy, easy], none)).toEqual({
      minutes: 20,
      resistance: 5,
      reasons: ['BIKE_RESISTANCE_UP'],
    });
  });

  it('holds at full time when it cannot turn the dial', () => {
    const easy = ride({ rpe: 5, minutes: 20 });
    expect(bikePrescription([easy], none).reasons).toEqual(['BIKE_HOLD']);
    expect(bikePrescription([ride({ rpe: 7 }), easy], none).reasons).toEqual(['BIKE_HOLD']);
    expect(bikePrescription([ride({ rpe: null }), easy], none).reasons).toEqual(['BIKE_HOLD']);
    const noDial = ride({ rpe: 5, minutes: 20, resistance: null });
    expect(bikePrescription([noDial, noDial], none).reasons).toEqual(['BIKE_HOLD']);
    const top = ride({ rpe: 5, minutes: 20, resistance: 20 });
    expect(bikePrescription([top, top], none).reasons).toEqual(['BIKE_HOLD']);
  });
});
