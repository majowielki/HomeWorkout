import type { PlannedExercise } from '@/domain/plan/types';

import { loadText, planTitle, prescriptionText } from '../format';

const planned: PlannedExercise = {
  label: 'A1',
  exerciseId: 'goblet-squat',
  sets: 2,
  repMin: 10,
  repMax: 20,
  targetRirMin: 4,
  targetRirMax: 4,
  restSec: 120,
  slotId: 'squat',
  load: { kind: 'dumbbell', mode: 'paired', kg: 6 },
  unit: 'reps',
  target: 10,
  warmupSet: false,
  reasons: [],
  confidence: 'low',
};

describe('planTitle', () => {
  it('names the day after its first two regions', () => {
    expect(planTitle({ regions: ['lower', 'push', 'arms'] })).toBe('Nogi + pchanie');
    expect(planTitle({ regions: ['core'] })).toBe('Brzuch');
  });

  it('calls a day without hard work a light day', () => {
    expect(planTitle({ regions: [] })).toBe('Lekki dzień');
  });
});

describe('loadText', () => {
  it.each([
    [{ kind: 'dumbbell', mode: 'paired', kg: 6 } as const, '2 × 6 kg'],
    [{ kind: 'dumbbell', mode: 'single', kg: 8 } as const, '8 kg'],
    [{ kind: 'band', bandId: 'red', position: 1 } as const, 'guma czerwona, P1'],
    [{ kind: 'band', bandId: 'pink', position: 0 } as const, 'guma pink, P0'],
    [{ kind: 'bodyweight' } as const, 'masa ciała'],
  ])('%j -> %s', (load, text) => {
    expect(loadText(load)).toBe(text);
  });
});

describe('prescriptionText', () => {
  it('describes mini-band resistance without using the long-band load ladder', () => {
    const text = prescriptionText({
      ...planned,
      exerciseId: 'mini-band-overhead-raise',
      load: { kind: 'bodyweight' },
    });
    expect(text).toContain('mini band — stały lekki opór');
    expect(text).not.toContain('masa ciała');
  });
  it('reads sets, target with range, load and RIR', () => {
    expect(prescriptionText(planned)).toBe('2 serie · 10 powt. (zakres 10–20) · 2 × 6 kg · RIR 4');
  });

  it('reads a hold and a RIR range', () => {
    expect(
      prescriptionText({
        ...planned,
        sets: 1,
        repMin: undefined,
        repMax: undefined,
        unit: 'sec',
        target: 30,
        load: { kind: 'bodyweight' },
        targetRirMin: 1,
        targetRirMax: 2,
      }),
    ).toBe('1 seria · 30 s · masa ciała · RIR 1–2');
  });
});
