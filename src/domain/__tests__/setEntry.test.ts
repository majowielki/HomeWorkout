import { buildObservation } from '../observations/entry';
import type { SetObservation } from '../observations/types';
import type { PlannedSet } from '../plan/plan';
import { specFromLoad } from '../resistance/persistedLoad';
import {
  correctionOf,
  entryOf,
  isBelowTarget,
  isTimed,
  ladderFor,
  resistanceOf,
  resultValues,
  suggestedValues,
  usesBand,
  usesDumbbell,
} from '../session/setEntry';
import { exercise } from './fixtures';
import { legalObservation } from './planFixtures';
import { body, kg } from './progressionFixtures';

const dumbbells = exercise({ equipment: ['dumbbell'], dumbbellMode: 'paired' });
const single = exercise({ equipment: ['dumbbell'], dumbbellMode: 'single' });
const band = exercise({ equipment: ['band'] });
const hold = exercise({ equipment: ['bodyweight'], forceProfile: 'Isometric' });
const floor = exercise({ equipment: ['bodyweight'] });

const repsSet = (resistance = kg(6)): Pick<PlannedSet, 'target' | 'targetRir' | 'resistance'> => ({
  target: { kind: 'reps', min: 8, target: 10, max: 12, count: 'total' },
  targetRir: { min: 2, max: 3 },
  resistance,
});
const holdSet: Pick<PlannedSet, 'target' | 'targetRir' | 'resistance'> = {
  target: { kind: 'duration', minSec: 20, targetSec: 30, maxSec: 40 },
  targetRir: null,
  resistance: body,
};
const bandSpec = specFromLoad({ kind: 'band', bandId: 'black', position: 2 });

describe('what the logger starts from, and what it makes of the form', () => {
  it('reads what an exercise uses', () => {
    expect([usesDumbbell(dumbbells), usesBand(dumbbells), isTimed(dumbbells)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([usesDumbbell(band), usesBand(band), isTimed(hold)]).toEqual([false, true, true]);
    expect(ladderFor(single)).not.toEqual(ladderFor(dumbbells));
    expect(ladderFor(dumbbells)[0]).toBeLessThan(ladderFor(dumbbells).at(-1)!);
  });

  it('suggests the target and the load of the planned set, and the bottom of the effort range', () => {
    expect(suggestedValues(dumbbells, repsSet(), null)).toEqual({
      reps: 10,
      timeSec: 30,
      rir: 2,
      weightKg: 6,
      bandId: 'yellow',
      position: 1,
      shortfall: null,
    });
    expect(suggestedValues(hold, holdSet, null)).toMatchObject({ timeSec: 30, reps: 10, rir: 2 });
    expect(suggestedValues(band, repsSet(bandSpec), null)).toMatchObject({
      bandId: 'black',
      position: 2,
    });
  });

  it('keeps the load and the effort of the last result in the exposure', () => {
    const last = legalObservation({
      resistance: {
        ...legalObservation().resistance,
        value: kg(10),
      },
      rir: { ...legalObservation().rir, value: 1 },
    });
    expect(suggestedValues(dumbbells, repsSet(kg(6)), last)).toMatchObject({
      weightKg: 10,
      rir: 1,
      reps: 10,
    });
  });

  it('starts from the first rung when the planned resistance is not one the form can show', () => {
    const stack = {
      ...kg(6),
      modelId: 'machine.stack',
      value: {
        kind: 'machine_setting' as const,
        settingId: 's',
        displayValue: 3,
        displayUnit: null,
      },
    };
    expect(suggestedValues(dumbbells, repsSet(stack), null).weightKg).toBe(ladderFor(dumbbells)[0]);
  });

  it('shows a stored result again, with its effort and its reason for falling short', () => {
    const result = legalObservation({ shortfall: 'pain' });
    expect(resultValues(dumbbells, result)).toMatchObject({
      reps: 12,
      rir: 2,
      shortfall: 'pain',
      weightKg: 4,
    });
    const timed = legalObservation({
      amount: { ...result.amount, value: { kind: 'duration', seconds: 41.6 } },
      rir: { ...result.rir, value: null },
      resistance: { ...result.resistance, value: null },
    });
    expect(resultValues(hold, timed)).toMatchObject({ timeSec: 42, rir: 2 });
    const distance = legalObservation({
      amount: { ...result.amount, value: { kind: 'distance', meters: 100 } },
    });
    expect(resultValues(floor, distance)).toMatchObject({ reps: 10, timeSec: 30 });
  });

  it('makes the resistance of the form: dumbbells, a band, or what was planned', () => {
    const values = suggestedValues(dumbbells, repsSet(), null);
    expect(resistanceOf(dumbbells, { ...values, weightKg: 8 })).toEqual(
      specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: 8 }),
    );
    expect(resistanceOf(single, { ...values, weightKg: 8 })).toEqual(
      specFromLoad({ kind: 'dumbbell', mode: 'single', kg: 8 }),
    );
    expect(resistanceOf(band, { ...values, bandId: 'red', position: 3 })).toEqual(
      specFromLoad({ kind: 'band', bandId: 'red', position: 3 }),
    );
    expect(resistanceOf(floor, values)).toBeNull();
    const noMode = exercise({ equipment: ['dumbbell'] });
    expect(resistanceOf(noMode, values)?.modelId).toBe('dumbbell.paired');
  });

  it('is below the target when the reps are under the range, or the hold under its minimum', () => {
    const values = suggestedValues(dumbbells, repsSet(), null);
    expect(isBelowTarget(dumbbells, { ...values, reps: 7 }, repsSet().target)).toBe(true);
    expect(isBelowTarget(dumbbells, { ...values, reps: 8 }, repsSet().target)).toBe(false);
    expect(isBelowTarget(hold, { ...values, timeSec: 19 }, holdSet.target)).toBe(true);
    expect(isBelowTarget(hold, { ...values, timeSec: 20 }, holdSet.target)).toBe(false);
    // A target of another kind than the exercise measures cannot be fallen short of.
    expect(isBelowTarget(dumbbells, { ...values, reps: 1 }, holdSet.target)).toBe(false);
    expect(isBelowTarget(hold, { ...values, timeSec: 1 }, repsSet().target)).toBe(false);
  });

  it('confirms an untouched form as the suggestion, and reports what was changed', () => {
    const suggested = suggestedValues(dumbbells, repsSet(), null);
    const confirmed = entryOf(dumbbells, repsSet(), suggested, suggested);
    expect([confirmed.amount.edited, confirmed.resistance.edited, confirmed.rir.edited]).toEqual([
      false,
      false,
      false,
    ]);
    expect(confirmed.shortfall).toBeNull();

    const changed = entryOf(
      dumbbells,
      repsSet(),
      { ...suggested, reps: 6, weightKg: 8, rir: 0, shortfall: 'doms' },
      suggested,
    );
    expect([changed.amount.edited, changed.resistance.edited, changed.rir.edited]).toEqual([
      true,
      true,
      true,
    ]);
    expect(changed.shortfall).toBe('doms');
    // The reason is dropped once the set is back within its range.
    expect(
      entryOf(dumbbells, repsSet(), { ...suggested, reps: 9, shortfall: 'doms' }, suggested)
        .shortfall,
    ).toBeNull();
  });

  it('makes the entry of a hold and of a band, with the changes noticed in each', () => {
    const holdValues = suggestedValues(hold, holdSet, null);
    const timed = entryOf(hold, holdSet, { ...holdValues, timeSec: 25 }, holdValues);
    expect(timed.amount).toEqual({ value: { kind: 'duration', seconds: 25 }, edited: true });
    expect(timed.resistance).toEqual({ value: body, edited: false });

    const bandValues = suggestedValues(band, repsSet(bandSpec), null);
    const stretched = entryOf(band, repsSet(bandSpec), { ...bandValues, position: 3 }, bandValues);
    expect(stretched.resistance.edited).toBe(true);
    expect(entryOf(band, repsSet(bandSpec), bandValues, bandValues).resistance.edited).toBe(false);
  });

  it('turns into an observation the store accepts', () => {
    const suggested = suggestedValues(dumbbells, repsSet(), null);
    const entry = entryOf(dumbbells, repsSet(), { ...suggested, reps: 11 }, suggested);
    const made: Pick<SetObservation, 'amount' | 'rir'> = buildObservation(entry, {
      channel: 'touch',
      at: '2026-10-09T08:00:00.000Z',
      shown: { amount: 'visible', resistance: 'visible', rir: 'visible' },
    });
    expect(made.amount.origin).toBe('user_reported');
    expect(made.rir.origin).toBe('user_confirmed');
  });

  it('corrects a result by the fields that changed, as reported now, and leaves the rest alone', () => {
    const result = legalObservation();
    const values = resultValues(dumbbells, result);
    const at = '2026-10-10T08:00:00.000Z';
    expect(correctionOf(dumbbells, result, values, at)).toEqual({});

    const patch = correctionOf(
      dumbbells,
      result,
      { ...values, reps: 9, weightKg: 6, rir: 0, shortfall: 'pain' },
      at,
    );
    expect(Object.keys(patch).sort()).toEqual(['amount', 'resistance', 'rir', 'shortfall']);
    expect(patch.amount).toMatchObject({
      value: { kind: 'reps', reps: 9 },
      origin: 'user_reported',
      confirmedAt: at,
    });
    expect(patch.resistance?.value).toEqual(
      specFromLoad({ kind: 'dumbbell', mode: 'paired', kg: 6 }),
    );
    expect(patch.rir?.value).toBe(0);
    expect(patch.shortfall).toBe('pain');
  });

  it('corrects the time of a hold, and a result whose load the form does not set', () => {
    const result = legalObservation({
      amount: { ...legalObservation().amount, value: { kind: 'duration', seconds: 30 } },
    });
    const patch = correctionOf(hold, result, { ...resultValues(hold, result), timeSec: 35 }, 'x');
    expect(patch.amount?.value).toEqual({ kind: 'duration', seconds: 35 });
    expect(patch.resistance).toBeUndefined();
  });
});
