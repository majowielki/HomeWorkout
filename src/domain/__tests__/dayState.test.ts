import { recoveryOutlook } from '../plan/dayState';
import type { HistorySet } from '../progression/history';
import { exercise, slot } from './fixtures';

const squat = exercise({ id: 'squat', primaryMuscles: ['quads', 'glutes'] });
const row = exercise({ id: 'row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'] });
const dog = exercise({ id: 'bird-dog', primaryMuscles: ['core'] });
const catalog = { squat, row, 'bird-dog': dog };
const slots = [
  slot({ id: 'squat', exerciseIds: ['squat'] }),
  slot({ id: 'row', region: 'pull', exerciseIds: ['row'] }),
  slot({ id: 'core-back', kind: 'core', region: 'core', exerciseIds: ['bird-dog'] }),
];

const set = (exerciseId: string, rir: number | null = 2): HistorySet => ({
  exerciseId,
  isWarmup: false,
  reps: 10,
  timeSec: null,
  rir,
  load: { kind: 'bodyweight' },
});

describe('recoveryOutlook', () => {
  it('rests the muscles worked today until the day after tomorrow, soonest first', () => {
    const sessions = [
      { date: '2026-10-06', sets: [set('row')] },
      { date: '2026-10-07', sets: [set('squat')] },
    ];
    expect(recoveryOutlook(sessions, catalog, slots, '2026-10-07')).toEqual([
      { muscle: 'back', lastWorked: '2026-10-06', readyOn: '2026-10-08' },
      { muscle: 'quads', lastWorked: '2026-10-07', readyOn: '2026-10-09' },
      { muscle: 'glutes', lastWorked: '2026-10-07', readyOn: '2026-10-09' },
    ]);
  });

  it('leaves out secondary muscles, light work at RIR 5, warm-ups and muscles already rested', () => {
    const sessions = [
      { date: '2026-10-04', sets: [set('squat')] },
      { date: '2026-10-07', sets: [set('bird-dog', 5), { ...set('row'), isWarmup: true }] },
    ];
    expect(recoveryOutlook(sessions, catalog, slots, '2026-10-07')).toEqual([]);
  });

  it('ignores sessions after the day asked about', () => {
    const sessions = [{ date: '2026-10-08', sets: [set('row')] }];
    expect(recoveryOutlook(sessions, catalog, slots, '2026-10-07')).toEqual([]);
  });
});
