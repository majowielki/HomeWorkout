/**
 * How a result is made out of what the person did at the logger (engine v2, 06 §1, 13 §12, P5.4).
 *
 * Touch and voice both end here, so a set said aloud and a set tapped become
 * the same kind of record. Every field says where it came from: a value the
 * person typed or said is *reported*; a suggestion they accepted is
 * *confirmed*, and only counts as seen when something showed it to them —
 * the highlighted chip, or the voice reply that read it out (D20). A suggestion
 * saved without having been shown is kept, but as `none`, and the effort of it
 * is no evidence (`effortOf`).
 */
import type { ResistanceSpec } from '../resistance/types';
import type { InputChannel, ActualQuantity, SetObservation } from './types';

/** What a suggested effort is when nothing else says: the last set's, else the bottom of the target, else "hard". */
export const FALLBACK_EFFORT_RIR = 2;

export function defaultEffort(
  previous: Pick<SetObservation, 'rir'> | null | undefined,
  targetRir: { min: number; max: number } | null | undefined,
): number {
  return previous?.rir.value ?? targetRir?.min ?? FALLBACK_EFFORT_RIR;
}

/** How a suggested value reached the person before it was saved. */
export type Shown = 'visible' | 'read_back' | 'none';

export interface EntryField<T> {
  value: T;
  /** The person typed or said it. False: it is the suggestion, as it was. */
  edited: boolean;
}

export interface SetEntry {
  status: 'performed' | 'interrupted';
  amount: EntryField<ActualQuantity>;
  resistance: EntryField<ResistanceSpec>;
  /** `null`: the person gave none and there is no suggestion to stand for it. */
  rir: EntryField<number | null>;
  shortfall?: SetObservation['shortfall'];
}

export interface EntryContext {
  channel: Extract<InputChannel, 'touch' | 'voice'>;
  /** ISO instant of the confirmation. */
  at: string;
  /** What each unedited suggestion was shown as; a field left out was not shown. */
  shown: Partial<Record<'amount' | 'resistance' | 'rir', Shown>>;
  performedAt?: string;
}

type Fieldwise = 'amount' | 'resistance' | 'rir';

function provenance<T>(
  name: Fieldwise,
  field: EntryField<T>,
  ctx: EntryContext,
): Omit<SetObservation['amount'], 'value'> & { value: T } {
  if (field.edited) {
    return {
      value: field.value,
      origin: 'user_reported',
      channel: ctx.channel,
      confirmedAt: ctx.at,
      presentedDefault: false,
      confirmation: 'edited',
    };
  }
  return {
    value: field.value,
    origin: 'user_confirmed',
    channel: ctx.channel,
    confirmedAt: ctx.at,
    presentedDefault: true,
    confirmation: ctx.shown[name] ?? 'none',
  };
}

/**
 * The observation of a set from an entry. Only the fields of `LogSetCommand` are
 * returned; the id, revision and the time of recording are the store's.
 */
export function buildObservation(
  entry: SetEntry,
  ctx: EntryContext,
): Pick<SetObservation, 'status' | 'amount' | 'resistance' | 'rir' | 'shortfall' | 'performedAt'> {
  // No effort given and none suggested: nothing is claimed.
  const rir: SetObservation['rir'] =
    entry.rir.value === null
      ? {
          value: null,
          origin: 'user_reported',
          channel: ctx.channel,
          confirmedAt: ctx.at,
          presentedDefault: false,
          confirmation: 'none',
        }
      : provenance('rir', entry.rir as EntryField<number>, ctx);
  return {
    status: entry.status,
    amount: provenance('amount', entry.amount, ctx),
    resistance: provenance('resistance', entry.resistance, ctx),
    rir,
    shortfall: entry.shortfall ?? null,
    performedAt: ctx.performedAt ?? ctx.at,
  };
}

/**
 * The reply a voice entry reads back, so the effort counts as seen: "Zapisuję 12, ciężko".
 * In silent mode nothing is read and the effort is saved as a suggestion not shown.
 */
const EFFORT_WORDS: Record<number, string> = {
  0: 'na maksa',
  1: 'bardzo ciężko',
  2: 'ciężko',
  3: 'spokojnie',
  4: 'lekko',
};

export function readBackText(entry: SetEntry): string {
  const q = entry.amount.value;
  const amount =
    q.kind === 'reps'
      ? `${q.reps}`
      : q.kind === 'duration'
        ? `${q.seconds} sekund`
        : `${q.meters} m`;
  const effort =
    entry.rir.value === null ? null : (EFFORT_WORDS[entry.rir.value] ?? `zapas ${entry.rir.value}`);
  return effort === null ? `Zapisuję ${amount}` : `Zapisuję ${amount}, ${effort}`;
}

// ---------------------------------------------------------------------- late transcripts

/** What a recogniser was listening for when it started (06 §3). */
export interface VoiceTarget {
  sessionId: string;
  planRevision: number;
  /** The set the words are for; null for a command about the session. */
  plannedSetId: string | null;
}

/**
 * A transcript that arrives after the screen has moved on is not applied to
 * whatever is on screen now: it is for the set, and the plan, it was started for (T40).
 */
export function transcriptStillApplies(started: VoiceTarget, now: VoiceTarget): boolean {
  return (
    started.sessionId === now.sessionId &&
    started.planRevision === now.planRevision &&
    started.plannedSetId === now.plannedSetId
  );
}
