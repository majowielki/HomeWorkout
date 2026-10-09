/**
 * What was done, and how we know (engine, 02 §3-§4, 13 §3).
 *
 * A planned value becomes a result only through something the person did or a
 * sensor measured — never by being copied from the plan. So every field of a
 * result says where it came from, through which channel, and whether the
 * person saw the value before it was stored. That is what lets a confirmed
 * "12 reps, as planned" count as evidence (D03) while an untouched default
 * the person never saw does not (D20).
 */

import { z } from 'zod';

import { resistanceSpecSchema } from '../resistance/types';
import { SHORTFALL_REASONS } from '../types';

export const ORIGINS = ['user_reported', 'user_confirmed', 'measured', 'legacy_unknown'] as const;
export const CHANNELS = ['touch', 'voice', 'sensor', 'import', 'legacy'] as const;
export const CONFIRMATIONS = ['edited', 'visible', 'read_back', 'none'] as const;

export type Origin = (typeof ORIGINS)[number];
export type InputChannel = (typeof CHANNELS)[number];
/**
 * How the value reached the person before it was saved: `edited` — typed or
 * spoken by them; `visible` — a highlighted default confirmed by a tap;
 * `read_back` — read out by the voice reply; `none` — saved without being shown.
 */
export type Confirmation = (typeof CONFIRMATIONS)[number];

/**
 * A value with its provenance. `value: null` is "not known", and is a fact of
 * its own: an RIR the person chose not to give differs from a 0.
 */
export function observed<T extends z.ZodType>(value: T) {
  return z
    .strictObject({
      value: value.nullable(),
      origin: z.enum(ORIGINS),
      channel: z.enum(CHANNELS),
      /** When the person confirmed it (ISO instant), null for a measurement or an import. */
      confirmedAt: z.string().min(1).nullable(),
      /** The stored value is the suggestion that was shown, unchanged. */
      presentedDefault: z.boolean(),
      confirmation: z.enum(CONFIRMATIONS),
    })
    .superRefine((o, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (o.origin === 'measured' && o.channel !== 'sensor')
        issue('a measurement comes from a sensor');
      if (o.channel === 'sensor' && o.origin !== 'measured') issue('a sensor can only measure');
      if (o.origin === 'measured' && (o as unknown as { value: unknown }).value === null) {
        issue('a measurement has a value');
      }
      if (o.origin === 'legacy_unknown' && o.channel !== 'legacy' && o.channel !== 'import') {
        issue('unknown provenance only comes from legacy or imported data');
      }
      // An unchanged default is a confirmation of the suggestion; a changed one is a report.
      if (o.presentedDefault && o.origin !== 'user_confirmed') {
        issue('an unchanged suggestion is confirmed, not reported');
      }
      if (o.confirmation === 'edited' && (o.presentedDefault || o.origin !== 'user_reported')) {
        issue('an edited value is reported by the person and is not the suggestion');
      }
      if (o.origin === 'user_confirmed' && !o.presentedDefault) {
        issue('a confirmed value is the suggestion as it was shown');
      }
    });
}

export const actualQuantitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reps'), reps: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('duration'), seconds: z.number().nonnegative().finite() }),
  z.strictObject({ kind: z.literal('distance'), meters: z.number().nonnegative().finite() }),
]);

export type ActualQuantity = z.infer<typeof actualQuantitySchema>;

export const SET_SIDES = ['left', 'right', 'bilateral', 'alternating', 'not_applicable'] as const;
export type PlannedSide = (typeof SET_SIDES)[number];

const quantityOf = (q: ActualQuantity) =>
  q.kind === 'reps' ? q.reps : q.kind === 'duration' ? q.seconds : q.meters;

export const setObservationSchema = z
  .strictObject({
    id: z.string().min(1),
    /** The command that wrote it: a retry of the same command finds this and writes nothing. */
    commandId: z.string().min(1),
    /** Starts at 1 and grows with every correction; the highest is the current result. */
    revision: z.number().int().min(1),
    sessionId: z.string().min(1),
    exposureId: z.string().min(1).nullable(),
    /** Null only for old data and for a set the person added beyond the plan. */
    plannedSetId: z.string().min(1).nullable(),
    logicalSetId: z.string().min(1).nullable(),
    side: z.enum(SET_SIDES).nullable(),
    status: z.enum(['performed', 'interrupted']),
    amount: observed(actualQuantitySchema),
    resistance: observed(resistanceSpecSchema),
    /** Reps in reserve; null is "not given". */
    rir: observed(z.number().int().min(0).max(10)),
    shortfall: z.enum(SHORTFALL_REASONS).nullable(),
    performedAt: z.string().min(1),
    recordedAt: z.string().min(1),
  })
  .superRefine((o, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    // A performed set did something. An attempt with nothing done is interrupted, and adds no volume.
    if (o.status === 'performed') {
      const q = o.amount.value;
      if (q === null || quantityOf(q) <= 0) issue('a performed set has something in it');
    }
    if (o.plannedSetId !== null && o.exposureId === null) {
      issue('a set of the plan belongs to an exposure');
    }
    if (o.plannedSetId === null && o.logicalSetId !== null) {
      issue('a set outside the plan has no logical set');
    }
  });

export type SetObservation = z.infer<typeof setObservationSchema>;

/** The state of one expected set, apart from what was recorded for it (02 §4). */
export const DISPOSITIONS = ['pending', 'performed', 'interrupted', 'skipped'] as const;
export type SetDispositionStatus = (typeof DISPOSITIONS)[number];

export const SKIP_REASON_CODES = [
  'user_skipped',
  'session_closed',
  'equipment_unavailable',
  'pain',
  'time',
  'replaced',
] as const;

export const setDispositionSchema = z
  .strictObject({
    plannedSetId: z.string().min(1),
    status: z.enum(DISPOSITIONS),
    reason: z.enum(SKIP_REASON_CODES).nullable(),
    commandId: z.string().min(1),
    at: z.string().min(1),
  })
  .superRefine((d, ctx) => {
    if (d.status === 'skipped' && d.reason === null) {
      ctx.addIssue({ code: 'custom', message: 'a skipped set says why' });
    }
    if (d.status !== 'skipped' && d.reason !== null) {
      ctx.addIssue({ code: 'custom', message: 'only a skipped set has a skip reason' });
    }
  });

export type SetDisposition = z.infer<typeof setDispositionSchema>;
