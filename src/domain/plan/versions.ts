/**
 * The versions the engine stamps on a plan (engine, 01 §4, 02 §1):
 * the engine that decided it, the policy bundle, the compiler that made its
 * steps and the schema of the trace. The catalogue and inventory versions come
 * from the data the plan was made from. A change of any of them is a change of
 * how plans are made, and is written down where the stage that makes it lives.
 */
import type { PlanVersions } from './plan';

export const ENGINE_VERSIONS = {
  engine: '2.0.0',
  policies: 'policy-2.1',
  compiler: 'compiler-1',
  traceSchema: 1,
} as const;

export function planVersions(catalog: string, inventory = 'inventory-1'): PlanVersions {
  return { ...ENGINE_VERSIONS, catalog, inventory };
}
