/**
 * Engine v2, P2 (02 §5, 10 §1): a v2 result written as the columns the first
 * engine's readers know, and the answer of a command.
 */
import { isDone } from '../commands/result';
import { legacyColumns } from '../observations/project';
import { bandValue } from '../resistance/legacy';
import { specFromLoad } from '../resistance/legacy';
import { legalObservation } from './planV2Fixtures';

const withResistance = (spec: ReturnType<typeof specFromLoad> | null, patch = {}) => {
  const base = legalObservation(patch);
  return { ...base, resistance: { ...base.resistance, value: spec } };
};

describe('legacyColumns', () => {
  it('writes repetitions, effort, the side and a dumbbell as the first engine would', () => {
    const paired = specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: 8 });
    expect(legacyColumns(withResistance(paired))).toEqual({
      reps: 12,
      timeSec: null,
      rir: 2,
      weightKg: 8,
      dumbbellMode: 'paired',
      bandId: null,
      anchorPosition: null,
      side: 'left',
    });
  });

  it('writes a band and its position', () => {
    const band = specFromLoad({ kind: 'band', bandId: 'red', position: 2 });
    expect(legacyColumns(withResistance(band, { side: null }))).toMatchObject({
      weightKg: null,
      bandId: 'red',
      anchorPosition: 2,
      side: null,
    });
  });

  it('writes seconds as whole seconds, and keeps bodyweight as no load at all', () => {
    const held = withResistance(specFromLoad({ kind: 'bodyweight' }), {
      side: 'right',
      amount: {
        ...legalObservation().amount,
        value: { kind: 'duration', seconds: 30.4 },
      },
    });
    expect(legacyColumns(held)).toMatchObject({
      reps: null,
      timeSec: 30,
      weightKg: null,
      bandId: null,
      side: 'right',
    });
  });

  it('does not write what the first engine cannot express — no invented dumbbell, no 0 kg (T51)', () => {
    const barbell = {
      schemaVersion: 1 as const,
      modelId: 'barbell.kg',
      equipmentInstanceIds: [],
      configurationKey: '',
      value: {
        kind: 'external_mass' as const,
        massGrams: 60000,
        convention: 'total' as const,
        implementCount: 1,
      },
    };
    expect(legacyColumns(withResistance(barbell))).toMatchObject({
      reps: 12,
      weightKg: null,
      dumbbellMode: null,
      bandId: null,
    });
    expect(legacyColumns(withResistance(null))).toMatchObject({ weightKg: null });
  });

  it('leaves the columns of an unknown amount and effort empty, and the side of a pair of sides alone', () => {
    const none = legalObservation({ status: 'interrupted', side: 'bilateral' });
    const unknown = {
      ...none,
      amount: { ...none.amount, value: null },
      rir: { ...none.rir, value: null },
    };
    expect(legacyColumns(unknown)).toMatchObject({
      reps: null,
      timeSec: null,
      rir: null,
      side: null,
    });
    expect(bandValue('red', 1).positionId).toBe('P1');
  });
});

describe('the answer of a command', () => {
  it('is done when it was committed now or before, and not when it conflicted or was refused', () => {
    expect(isDone({ kind: 'committed', result: 1, sessionRevision: 2 })).toBe(true);
    expect(isDone({ kind: 'already_committed', result: 1, sessionRevision: 2 })).toBe(true);
    expect(isDone({ kind: 'conflict', code: 'SESSION_CHANGED', actualRevision: 3 })).toBe(false);
    expect(isDone({ kind: 'rejected', code: 'INVALID_COMMAND', detail: 'x' })).toBe(false);
  });
});
