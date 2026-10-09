/**
 * A day, a catalogue and a plan to audit (engine v2, P4). Not a suite and not counted in coverage.
 */
import { type AuditContext, type AuditDay } from '../plan/audit';
import { compileSession, type ExposureSpec } from '../plan/compile';
import type { SessionPlanV2 } from '../plan/planV2';
import type { Exercise } from '../types';
import { compileInput, exposure, kg, modelOf, set, stamp } from './compileFixtures';
import { exercise } from './fixtures';

export const catalogOf = (...patches: Partial<Exercise>[]): Record<string, Exercise> =>
  Object.fromEntries(
    patches.map((p, i) => {
      const e = exercise({
        id: `ex-e${i + 1}`,
        equipment: ['dumbbell'],
        primaryMuscles: ['quads'],
        ...p,
      });
      return [e.id, e];
    }),
  );

export const CATALOG = catalogOf({}, { primaryMuscles: ['back'] }, { primaryMuscles: ['chest'] });

export function day(patch: Partial<AuditDay> = {}): AuditDay {
  return {
    date: '2026-10-09',
    restDay: false,
    avoided: { primary: new Set(), any: new Set() },
    painMuscles: new Set(),
    isSore: () => false,
    isRecovering: () => false,
    doneToday: {},
    week: {},
    dayMax: 3,
    weekMax: () => 6,
    sessionSecMax: 30 * 60,
    lastResistance: new Map(),
    deload: false,
    ...patch,
  };
}

export function context(patch: Partial<AuditContext> = {}): AuditContext {
  return {
    mode: 'new_plan',
    catalog: CATALOG,
    eligibility: { profile: { knee: null }, excludedIds: new Set() },
    modelOf,
    day: day(),
    ...patch,
  };
}

/** A stamped plan from the recipes; the exercises are `ex-e1`, `ex-e2`, … of `CATALOG`. */
export function planOf(
  specs: readonly ExposureSpec[] = [exposure('e1')],
  patch: Partial<Parameters<typeof compileInput>[1]> = {},
): SessionPlanV2 {
  return stamp(compileSession(compileInput(specs, patch)));
}

export { exposure, kg, set };
