/**
 * The shapes of the progression pipeline (engine, 13 §5). A prescription is
 * built by rules that run in a fixed order over one draft; each may only narrow
 * what an earlier one allowed or settle what is still open, and each says what
 * it changed. What it ends in is the same draft the plan compiler reads.
 */

import type { IsoDate } from '../observations/date';
import type { ExposureRecord } from '../observations/exposure';
import type { SetsRecommendation } from '../plan/sets';
import type { ResistanceModel, ResistanceSpec } from '../resistance/types';
import type { Assessed } from './assessed';
import type { DecisionCode } from './codes';
import type { FailedRung } from './failedRungs';
import type { LayoffState } from './layoff';
import type { AmountUnit, ProgressionPolicy } from './policy';

/** A change to the person’s plan that is proposed and never made by itself (D19). */
export type Proposal =
  | { kind: 'variant_up'; to: string; code: 'VARIANT_UP_SUGGESTED' }
  | { kind: 'variant_down'; to: string; code: 'VARIANT_DOWN_SUGGESTED' }
  | { kind: 'confirm_step_up'; to: ResistanceSpec; code: 'CONFIRM_STEP_UP' };

/** What a model of strength would say about a step; kept for the shadow report and never read by a rule (03 §7). */
export type StepAssessment =
  | { kind: 'unknown'; reasons: string[] }
  | {
      kind: 'estimated';
      targetCapacity: number;
      uncertainty: number | null;
      modelId: string;
      modelVersion: string;
      domain: string;
      evidenceIds: string[];
    };

export interface NextInput {
  exerciseId: string;
  unit: AmountUnit;
  model: ResistanceModel;
  /** Where a never-done exercise starts; null if nothing says, and then nothing is prescribed. */
  start: ResistanceSpec | null;
  /** The slot’s range, in reps or seconds, and the effort it asks for. */
  range: { lo: number; hi: number };
  targetRir: { min: number; max: number };
  /** The most reps a set is pushed to (`repCapOf`); a hold has none. */
  repCap: number;
  /** The primary exposures of this exercise on this setup, oldest first. */
  history: readonly ExposureRecord[];
  asOf: IsoDate;
  layoff: LayoffState;
  phase: 'work' | 'deload';
  /** The exercise may be planned at all: not excluded, the equipment is there, the model is known. */
  eligible: boolean;
  sets: SetsRecommendation;
  policy?: ProgressionPolicy;
  /** The neighbouring variants the person may be given (already filtered by what could be planned). */
  variants?: { harder: string | null; easier: string | null };
  /** What the person answered to what was proposed. */
  user?: { stepUp?: 'yes' | 'no'; variantDownDeferredAt?: IsoDate };
  /** A model of strength, off by default and read by no rule. */
  estimator?: (ctx: RuleCtx) => StepAssessment;
}

export interface RuleCtx extends Omit<NextInput, 'policy'> {
  policy: ProgressionPolicy;
  /** Every exposure with what it is evidence of, oldest first; `usable` are those with something done. */
  steps: readonly Assessed[];
  usable: readonly Assessed[];
  /** The latest exposure with something done. */
  last: Assessed | null;
  /** The latest that is not a deload week: what the decisions are made from. */
  base: Assessed | null;
  failed: ReadonlyMap<string, FailedRung>;
  step: number;
  minAmount: number;
  /** The top the range may be extended to, and the remaining exposures before the next probe. */
  extendedTop: number;
  probeCooldown: number;
}

export type Axis = 'none' | 'add_set' | 'extend_range' | 'variant_up' | 'calibration';

export interface Draft {
  resistance: ResistanceSpec | null;
  /** The target of each working set, in reps or seconds. */
  targets: number[];
  /** The range the targets are in: its top may be extended, and its bottom is the slot’s. */
  range: { lo: number; hi: number };
  /** Null until a rule or the sets rule settles it. */
  sets: number | null;
  targetRir: { min: number; max: number } | null;
  /** No later rule may prescribe a resistance harder than this. */
  maxHarder: ResistanceSpec | null;
  axis: Axis;
  /** One set at the next step, done first, and not required (03 §15). */
  probe: { resistance: ResistanceSpec; target: number } | null;
  proposals: Proposal[];
  codes: DecisionCode[];
  /** What the phase adds to the decision, said after its own codes: an intro exposure, a deload, a recalibration. */
  notes: DecisionCode[];
  /** What kind of decision it is: start, hold, advance, probe, regress, build_up, deload, return. */
  decision: string;
  confidence: 'high' | 'low';
  /** What the decision stands on, for the trace: ids and counts, never a copy of the log. */
  evidence: Record<string, unknown>;
  /** Stops the rules that follow, except those that always run. */
  final: boolean;
}

export interface Rule {
  id: string;
  /** Runs even after a rule has settled the draft: it only adds what does not depend on the decision. */
  always?: boolean;
  apply(ctx: RuleCtx, d: Draft): Draft;
}

export function emptyDraft(ctx: Pick<RuleCtx, 'range'>): Draft {
  return {
    resistance: null,
    targets: [],
    range: { ...ctx.range },
    sets: null,
    targetRir: null,
    maxHarder: null,
    axis: 'none',
    probe: null,
    proposals: [],
    codes: [],
    notes: [],
    decision: 'none',
    confidence: 'high',
    evidence: {},
    final: false,
  };
}

/** A code, once. */
export function withCode(d: Draft, ...codes: DecisionCode[]): DecisionCode[] {
  return [...d.codes, ...codes.filter((c) => !d.codes.includes(c))];
}
