import { createSessionToolHooks } from '@/ai/tools/sessionEnvironment';
import { loadActiveSessionSource } from '@/db/repositories/sessionChangeSource';

/**
 * The tools that consult the running workout, bound to the phone's database. Made once for a
 * chat turn: the assessments it remembers are those of that turn, and the proposals it collects
 * are the cards the person is shown.
 */
export function createPhoneSessionTools() {
  return createSessionToolHooks(() => loadActiveSessionSource());
}
