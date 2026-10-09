import { compileSession } from '@/domain/plan/compile';
import { compileInput, exposure as spec, set } from '@/domain/__tests__/compileFixtures';
import { body, kg, single } from '@/domain/__tests__/progressionFixtures';
import { specFromLoad } from '@/domain/resistance/legacy';
import type { PlannedExposure } from '@/domain/plan/planV2';

import { loadText, planTitle, prescriptionText, workSetsOf } from '../format';

const planOf = (...exposures: ReturnType<typeof spec>[]) => compileSession(compileInput(exposures));

describe('planTitle', () => {
  it('names the day after its first two regions, the one with most sets first', () => {
    const plan = planOf(
      spec('a', { slotId: 'squat', sets: [set(), set(), set()] }),
      spec('b', { slotId: 'push-horizontal', sets: [set(), set()] }),
      spec('c', { slotId: 'lateral-delts', sets: [set()] }),
    );
    expect(planTitle(plan)).toBe('Nogi + pchanie');
  });

  it('calls a day without hard work, or without a known slot, a light day', () => {
    expect(planTitle(planOf(spec('a', { slotId: null })))).toBe('Lekki dzień');
    expect(planTitle(planOf(spec('a', { slotId: 'unknown-slot' })))).toBe('Lekki dzień');
    expect(
      planTitle(
        planOf(spec('a', { slotId: 'squat', sets: [set({ role: 'warmup', required: false })] })),
      ),
    ).toBe('Lekki dzień');
  });

  it('puts an extra session after its name', () => {
    const plan = { ...planOf(spec('a', { slotId: 'squat' })), kind: 'extra' as const };
    expect(planTitle(plan)).toBe('Dodatkowy trening · Nogi');
  });
});

describe('loadText', () => {
  it.each([
    [kg(6), '2 × 6 kg'],
    [single(8), '8 kg'],
    [specFromLoad({ kind: 'band', bandId: 'red', position: 1 }), 'guma czerwona, P1'],
    [specFromLoad({ kind: 'band', bandId: 'pink', position: 0 }), 'guma pink, P0'],
    [body, 'masa ciała'],
  ])('%j -> %s', (resistance, text) => {
    expect(loadText(resistance)).toBe(text);
  });

  it('calls the load of a mini band a steady light one, not body weight', () => {
    expect(loadText(body, 'mini-band-overhead-raise')).toContain('mini band');
    expect(loadText(body, 'goblet-squat')).toBe('masa ciała');
  });
});

describe('prescriptionText', () => {
  const exposureOf = (patch: Parameters<typeof spec>[1]): PlannedExposure =>
    planOf(spec('a', patch)).exposures[0]!;

  it('reads sets, target with range, load and RIR', () => {
    const text = prescriptionText(
      exposureOf({
        sets: [
          set({ resistance: kg(6), lo: 10, target: 10, hi: 20, targetRir: { min: 4, max: 4 } }),
          set({ resistance: kg(6), lo: 10, target: 10, hi: 20, targetRir: { min: 4, max: 4 } }),
        ],
      }),
    );
    expect(text).toBe('2 serie · 10 powt. (zakres 10–20) · 2 × 6 kg · RIR 4');
  });

  it('reads a hold with a RIR range, and a set with no RIR asked for', () => {
    const hold = exposureOf({
      unit: 'duration',
      sets: [set({ resistance: body, lo: 20, target: 30, hi: 40, targetRir: { min: 1, max: 2 } })],
    });
    expect(prescriptionText(hold)).toBe('1 seria · 30 s · masa ciała · RIR 1–2');
    const unrated = exposureOf({
      sets: [set({ resistance: body, targetRir: null })],
    });
    expect(prescriptionText(unrated)).not.toContain('RIR');
  });

  it('counts the logical sets of a one-sided exercise once, and falls back to all sets without work', () => {
    const sided = exposureOf({ sideMode: 'per_set', sets: [set(), set()] });
    expect(prescriptionText(sided)).toContain('2 serie');
    const warm = exposureOf({ sets: [set({ role: 'warmup', required: false })] });
    expect(workSetsOf(warm)).toHaveLength(1);
  });
});
