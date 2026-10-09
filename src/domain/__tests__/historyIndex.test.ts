/**
 * Engine v2, P2 (13 §13, 02 §7, T19, T20, T34): the index of exposures the
 * planners read — progression, work done, recovery — as three separate
 * questions.
 */
import { buildHistoryIndex } from '../history';
import type { ExposureRecord, ExposureSetRecord } from '../observations/exposure';
import type { SetObservation } from '../observations/types';
import type { PlannedSet } from '../plan/plan';
import type { Exercise } from '../types';
import { exercise } from './fixtures';
import { legalObservation, plannedSet } from './planFixtures';

const catalog: Record<string, Exercise> = {
  row: exercise({ id: 'row', primaryMuscles: ['back', 'lats'], secondaryMuscles: ['biceps'] }),
  curl: exercise({
    id: 'curl',
    primaryMuscles: ['biceps'],
    secondaryMuscles: ['forearms'],
    secondaryWeights: { forearms: 0.25 },
  }),
  drill: exercise({ id: 'drill', movementPattern: 'Mobility', primaryMuscles: ['back'] }),
};

const withRir = (
  rir: number | null,
  confirmation: 'visible' | 'none' = 'visible',
): SetObservation => {
  const base = legalObservation();
  return {
    ...base,
    rir: {
      ...base.rir,
      value: rir,
      confirmation,
      presentedDefault: confirmation === 'none' || base.rir.presentedDefault,
    },
  };
};

/** A set done, with the effort it was done at. */
const done = (
  patch: Partial<PlannedSet> = {},
  observation: SetObservation = withRir(2),
): ExposureSetRecord => ({
  planned: { ...plannedSet(1, null, { side: 'bilateral' }), ...patch },
  disposition: 'performed',
  observation,
});

const exposure = (
  patch: Partial<ExposureRecord> & { sets?: ExposureSetRecord[] } = {},
): ExposureRecord => ({
  exposureId: 's1/r1/e1',
  sessionId: 's1',
  trainingDate: '2026-10-09',
  exerciseId: 'row',
  slotId: 'pull',
  comparisonKey: 'row|key',
  progressionScope: 'primary',
  sets: [done()],
  extra: [],
  context: { abandoned: false, userReduced: false, feel: null, deload: false },
  ...patch,
});

describe('what progression reads', () => {
  it('keeps the primary exposures of a key, oldest first, whatever order they come in', () => {
    const a = exposure({ exposureId: 'a', trainingDate: '2026-10-01' });
    const b = exposure({ exposureId: 'b', trainingDate: '2026-10-05' });
    const other = exposure({
      exposureId: 'c',
      trainingDate: '2026-10-03',
      comparisonKey: 'row|other',
    });
    const index = buildHistoryIndex([b, other, a], catalog);
    expect(index.byKey.get('row|key')!.map((r) => r.exposureId)).toEqual(['a', 'b']);
    expect(index.byKey.get('row|other')!.map((r) => r.exposureId)).toEqual(['c']);
  });

  it('puts two exposures of one day in the order of their ids', () => {
    const later = exposure({ exposureId: 'z', trainingDate: '2026-10-01' });
    const first = exposure({ exposureId: 'a', trainingDate: '2026-10-01' });
    expect(
      buildHistoryIndex([later, first], catalog)
        .byKey.get('row|key')!
        .map((r) => r.exposureId),
    ).toEqual(['a', 'z']);
  });

  it('leaves out what only added work — a supplemental exposure, or one outside the progression', () => {
    const index = buildHistoryIndex(
      [
        exposure({ exposureId: 'p', trainingDate: '2026-10-01' }),
        exposure({ exposureId: 's', trainingDate: '2026-10-02', progressionScope: 'supplemental' }),
        exposure({ exposureId: 'n', trainingDate: '2026-10-03', progressionScope: 'none' }),
      ],
      catalog,
    );
    expect(index.byKey.get('row|key')!.map((r) => r.exposureId)).toEqual(['p']);
  });

  it('T34 remembers the last result of a key however long ago it was', () => {
    const old = exposure({ exposureId: 'old', trainingDate: '2025-02-01' });
    const index = buildHistoryIndex([old], catalog);
    expect(index.lastComparable.get('row|key')!.exposureId).toBe('old');
    expect(index.lastComparable.get('row|never')).toBeUndefined();
    const newer = exposure({ exposureId: 'new', trainingDate: '2026-10-01' });
    expect(buildHistoryIndex([newer, old], catalog).lastComparable.get('row|key')!.exposureId).toBe(
      'new',
    );
  });
});

describe('the work each muscle got in a day', () => {
  const day = (records: ExposureRecord[], options = {}) =>
    buildHistoryIndex(records, catalog, options).muscleDay.get('2026-10-09')!;

  it('counts a set at the effort of a hard set as certain work for each primary muscle', () => {
    const work = day([exposure()]);
    expect(work.back).toEqual({ certain: 1, uncertain: 0, secondary: 0 });
    expect(work.lats.certain).toBe(1);
    expect(work.quads.certain).toBe(0);
  });

  it('counts a secondary muscle by the weight of the exercise, the catalogue, or the person', () => {
    expect(day([exposure()]).biceps.secondary).toBe(0.5);
    expect(day([exposure({ exerciseId: 'curl' })]).forearms.secondary).toBe(0.25);
    expect(day([exposure()], { muscleWeights: { row: { biceps: 0.3 } } }).biceps.secondary).toBe(
      0.3,
    );
    expect(day([exposure()], { secondaryWeight: 0.4 }).biceps.secondary).toBe(0.4);
  });

  it('takes a set whose effort nobody gave as work that may have been hard (04 §2)', () => {
    const unknown = exposure({ sets: [done({}, withRir(null))] });
    expect(day([unknown]).back).toEqual({ certain: 0, uncertain: 1, secondary: 0 });
    // Saved without being shown, a default effort is not an answer either (T85).
    const silent = exposure({ sets: [done({}, withRir(2, 'none'))] });
    expect(day([silent]).back).toEqual({ certain: 0, uncertain: 1, secondary: 0 });
  });

  it('does not count practice far from failure, a warm-up or a mobility exercise', () => {
    const practice = exposure({ sets: [done({}, withRir(5))] });
    expect(day([practice]).back.certain + day([practice]).back.uncertain).toBe(0);
    const warmup = exposure({ sets: [done({ role: 'warmup', requiredForProgression: false })] });
    expect(day([warmup]).back.certain).toBe(0);
    const mobility = exposure({
      sets: [done({ role: 'mobility', requiredForProgression: false })],
    });
    expect(day([mobility]).back.certain).toBe(0);
    expect(
      buildHistoryIndex([exposure({ exerciseId: 'drill' })], catalog).muscleDay.has('2026-10-09'),
    ).toBe(false);
  });

  it('counts the two sides of one set as one set', () => {
    const both = exposure({
      sets: [done({ side: 'left' }), done({ side: 'right' })],
    });
    expect(day([both]).back.certain).toBe(1);
    expect(day([exposure({ sets: [done({ side: 'alternating' })] })]).back.certain).toBe(1);
  });

  it('counts only what was performed: not a skipped, an interrupted or a pending set', () => {
    const sets: ExposureSetRecord[] = [
      done(),
      { ...done(), disposition: 'skipped', observation: null },
      { ...done(), disposition: 'interrupted' },
      { ...done(), disposition: 'pending', observation: null },
      { ...done(), disposition: 'performed', observation: null },
    ];
    expect(day([exposure({ sets })]).back.certain).toBe(1);
  });

  it('T19 counts work beyond the plan, and the work of a supplemental or abandoned session (T14)', () => {
    const extra = legalObservation({ plannedSetId: null, logicalSetId: null, side: null });
    const beyond = exposure({ sets: [], extra: [extra, { ...extra, status: 'interrupted' }] });
    expect(day([beyond]).back.certain).toBe(1);
    const side = exposure({ sets: [], extra: [{ ...extra, side: 'left' }] });
    expect(day([side]).back.certain).toBe(0.5);
    const supplemental = exposure({ progressionScope: 'supplemental' });
    const abandoned = exposure({
      exposureId: 'b',
      context: { abandoned: true, userReduced: false, feel: null, deload: false },
    });
    expect(day([exposure(), supplemental, abandoned]).back.certain).toBe(3);
  });

  it('T20 keeps the days apart, and lets work past a limit stay on record', () => {
    const index = buildHistoryIndex(
      [
        exposure({ trainingDate: '2026-10-08' }),
        exposure({
          exposureId: 'x',
          sets: [done(), done({ ordinal: 2 }), done({ ordinal: 3 }), done({ ordinal: 4 })],
        }),
      ],
      catalog,
    );
    expect(index.muscleDay.get('2026-10-08')!.back.certain).toBe(1);
    expect(index.muscleDay.get('2026-10-09')!.back.certain).toBe(4);
  });
});

describe('when a muscle and a slot were last trained', () => {
  it('is the last day with direct work, certain or not, and the last day anything was done in the slot', () => {
    const index = buildHistoryIndex(
      [
        exposure({ trainingDate: '2026-10-01' }),
        exposure({
          exposureId: 'b',
          trainingDate: '2026-10-06',
          exerciseId: 'curl',
          slotId: 'biceps',
        }),
        exposure({ exposureId: 'c', trainingDate: '2026-10-08', sets: [done({}, withRir(null))] }),
      ],
      catalog,
    );
    expect(index.lastPrimary).toEqual({
      back: '2026-10-08',
      lats: '2026-10-08',
      biceps: '2026-10-06',
    });
    expect(index.lastSlot).toEqual({ pull: '2026-10-08', biceps: '2026-10-06' });
  });

  it('does not count practice, a warm-up or an exposure with nothing done', () => {
    const index = buildHistoryIndex(
      [
        exposure({ sets: [done({}, withRir(5))] }),
        exposure({
          exposureId: 'w',
          trainingDate: '2026-10-10',
          sets: [done({ role: 'warmup', requiredForProgression: false })],
        }),
        exposure({
          exposureId: 'n',
          trainingDate: '2026-10-11',
          sets: [{ ...done(), disposition: 'skipped', observation: null }],
        }),
      ],
      catalog,
    );
    expect(index.lastPrimary).toEqual({});
    // Practice is still something done in the slot; a warm-up or a skip is not.
    expect(index.lastSlot).toEqual({ pull: '2026-10-09' });
  });

  it('keeps a slot-less exposure out of the slots, and an exercise nobody knows out of the muscles', () => {
    const index = buildHistoryIndex(
      [exposure({ slotId: null }), exposure({ exposureId: 'q', exerciseId: 'ghost', slotId: 'x' })],
      catalog,
    );
    expect(index.lastSlot).toEqual({ x: '2026-10-09' });
    expect(index.muscleDay.get('2026-10-09')!.back.certain).toBe(1);
  });

  it('is empty for no history', () => {
    const index = buildHistoryIndex([], catalog);
    expect([index.byKey.size, index.muscleDay.size, Object.keys(index.lastSlot).length]).toEqual([
      0, 0, 0,
    ]);
  });
});
