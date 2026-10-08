/**
 * Identifiers of a session plan (engine v2, 02 §1).
 *
 * An id never comes from where something happens to be on the screen: moving
 * an exercise up the list must not attach its results to another exercise.
 * Ids are built from the session, the plan revision in which the thing was
 * created, a key local to the exposure and the number of the set, so they are
 * unique across sessions, stay the same for as long as the thing exists, and
 * a replacement made in a later revision gets a new one.
 *
 *   exposureId    s1/r1/e1
 *   logicalSetId  s1/r1/e1/2          a set, however many sides it has
 *   plannedSetId  s1/r1/e1/2L         one side of it (no suffix when it has none)
 */

export type IdSide = 'left' | 'right' | null;

export interface PlannedSetIdParts {
  sessionId: string;
  /** The revision that created the set; it does not change when later revisions keep the set. */
  planRevision: number;
  exposureKey: string;
  /** From 1. */
  ordinal: number;
  side: IdSide;
}

/** What a part of an id may be made of: nothing that could be mistaken for a separator. */
const SAFE = /^[A-Za-z0-9_-]+$/;

function assertPart(name: string, value: string): void {
  if (!SAFE.test(value))
    throw new RangeError(`${name} must be letters, digits, "_" or "-": "${value}"`);
}

export function exposureId(sessionId: string, planRevision: number, exposureKey: string): string {
  assertPart('sessionId', sessionId);
  assertPart('exposureKey', exposureKey);
  if (!Number.isInteger(planRevision) || planRevision < 1) {
    throw new RangeError(`planRevision must be an integer from 1, got ${planRevision}`);
  }
  return `${sessionId}/r${planRevision}/${exposureKey}`;
}

export function logicalSetId(parts: Omit<PlannedSetIdParts, 'side'>): string {
  if (!Number.isInteger(parts.ordinal) || parts.ordinal < 1) {
    throw new RangeError(`ordinal must be an integer from 1, got ${parts.ordinal}`);
  }
  return `${exposureId(parts.sessionId, parts.planRevision, parts.exposureKey)}/${parts.ordinal}`;
}

export function plannedSetId(parts: PlannedSetIdParts): string {
  const suffix = parts.side === 'left' ? 'L' : parts.side === 'right' ? 'R' : '';
  return `${logicalSetId(parts)}${suffix}`;
}

const PLANNED_SET_ID = /^([A-Za-z0-9_-]+)\/r([1-9][0-9]*)\/([A-Za-z0-9_-]+)\/([1-9][0-9]*)([LR]?)$/;

/** The parts of a planned-set id, or null when the text is not one. */
export function parsePlannedSetId(id: string): PlannedSetIdParts | null {
  const match = PLANNED_SET_ID.exec(id);
  if (!match) return null;
  return {
    sessionId: match[1]!,
    planRevision: Number(match[2]),
    exposureKey: match[3]!,
    ordinal: Number(match[4]),
    side: match[5] === 'L' ? 'left' : match[5] === 'R' ? 'right' : null,
  };
}

const EXPOSURE_ID = /^([A-Za-z0-9_-]+)\/r([1-9][0-9]*)\/([A-Za-z0-9_-]+)$/;

export function parseExposureId(
  id: string,
): { sessionId: string; planRevision: number; exposureKey: string } | null {
  const match = EXPOSURE_ID.exec(id);
  return match
    ? { sessionId: match[1]!, planRevision: Number(match[2]), exposureKey: match[3]! }
    : null;
}
