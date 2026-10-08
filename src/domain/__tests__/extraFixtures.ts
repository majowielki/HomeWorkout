import type { PlannerInput } from '../plan/dayPlanner';
import { byId, exercise, HARD_ONLY, slot } from './fixtures';

export const extraInput = (patch: Partial<PlannerInput> = {}): PlannerInput => ({
  asOf: '2026-10-08',
  catalog: byId([
    exercise({ id: 'legs', name: 'Nogi' }),
    exercise({
      id: 'push',
      name: 'Pchanie',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps'],
    }),
    exercise({ id: 'pull', name: 'Plecy', primaryMuscles: ['back'] }),
    exercise({ id: 'core', name: 'Brzuch', primaryMuscles: ['core'] }),
    exercise({ id: 'mobility', movementPattern: 'Mobility' }),
  ]),
  slots: [
    slot({ id: 'legs', name: 'Nogi', exerciseIds: ['legs'] }),
    slot({ id: 'push', name: 'Pchanie', exerciseIds: ['push'], region: 'push' }),
    slot({ id: 'pull', name: 'Plecy', exerciseIds: ['pull'], region: 'pull' }),
    slot({
      id: 'core',
      name: 'Brzuch',
      exerciseIds: ['core'],
      region: 'core',
      kind: 'core',
      lightFill: true,
    }),
    slot({ id: 'mobility', exerciseIds: ['mobility'], kind: 'filler' }),
  ],
  eligibility: { profile: HARD_ONLY, excludedIds: new Set() },
  block: {
    index: 1,
    startedOn: '2026-10-01',
    deloadFrom: null,
    deloadReason: null,
    selections: { legs: 'legs', push: 'push', pull: 'pull', core: 'core' },
  },
  sessions: [],
  rides: [],
  daily: [],
  ...patch,
});
