/**
 * The shape of `simulateProposal` (contract 7, 11 §13, D36): the model checks what a change would do
 * to the coming days with the engine's own planner before it puts the change in front of the person.
 * It asks with the same relative dates and the same kinds of request as `proposePlanChange`, and with
 * no field for a load; the engine answers with sets, minutes and the findings of the rules, which the
 * model quotes ("pośladki w tygodniu 6 → 4 serie, poniżej minimum").
 *
 * It only reads: the simulation is a forecast that lives inside the engine and is stored nowhere.
 */
import { z } from 'zod';

import { MUSCLE_GROUPS } from '../../domain/coach/vocabulary';
import { WEEK_CONFIG } from '../../domain/config/training';
import { COACH_CONSTRAINT_KINDS, COACH_CONSTRAINT_REASONS } from '../../domain/plan/constraints';
import { checkSummarySchema, sessionChangeInputSchema, VERDICTS } from './sessionTools';

const count = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SIMULATION_LIMITS = {
  horizons: [7, 14, 28] as const,
  constraints: 3,
  warningsShown: 5,
  daysShown: 28,
} as const;

/** The same request the plan-change tool takes, in relative days. */
const weekChangeSchema = z.strictObject({
  kind: z.literal('week_change'),
  constraints: z
    .array(
      z.strictObject({
        kind: z.enum(COACH_CONSTRAINT_KINDS),
        muscles: z.array(z.enum(MUSCLE_GROUPS)).max(MUSCLE_GROUPS.length),
        fromDaysAhead: z
          .number()
          .int()
          .min(0)
          .max(SIMULATION_LIMITS.daysShown - 1),
        days: z.number().int().min(1).max(WEEK_CONFIG.requestMaxDays),
        reason: z.enum(COACH_CONSTRAINT_REASONS),
      }),
    )
    .min(1)
    .max(SIMULATION_LIMITS.constraints),
});

const setsOfKind = z.number().int().min(1).max(6).optional();

const policyChangeSchema = z.strictObject({
  kind: z.literal('policy_change'),
  /** The person's own number of sets for each kind of exercise; left out, the engine recommends. */
  setsPerExposure: z
    .strictObject({ compound: setsOfKind, accessory: setsOfKind, core: setsOfKind })
    .optional(),
  volumeProfile: z.enum(['standard', 'higher']).optional(),
});

export const simulateInputSchema = z.strictObject({
  proposal: z.discriminatedUnion('kind', [
    weekChangeSchema,
    policyChangeSchema,
    z.strictObject({ kind: z.literal('session_change'), change: sessionChangeInputSchema }),
  ]),
  horizonDays: z.union([z.literal(7), z.literal(14), z.literal(28)]),
  athlete: z.enum(['follows_plan', 'observed_trend']),
});

export type SimulateInput = z.infer<typeof simulateInputSchema>;

const summarySchema = z.strictObject({
  musclesWeek: z.array(
    z.strictObject({ muscle: z.enum(MUSCLE_GROUPS), sets: count, min: count, max: count }),
  ),
  minutesPerDay: z.array(count).max(SIMULATION_LIMITS.daysShown),
  expectedLoadSteps: count,
  expectedProbes: count,
  deloadTriggered: z.boolean(),
});

export const simulateOutputSchema = z.strictObject({
  horizonDays: z.union([z.literal(7), z.literal(14), z.literal(28)]),
  athlete: z.enum(['follows_plan', 'observed_trend']),
  baseline: summarySchema,
  withProposal: summarySchema,
  diff: z.strictObject({
    musclesWeek: z.array(z.strictObject({ muscle: z.enum(MUSCLE_GROUPS), sets: z.number().int() })),
    minutesPerDay: z.array(z.number().int()).max(SIMULATION_LIMITS.daysShown),
    expectedLoadSteps: z.number().int(),
    expectedProbes: z.number().int(),
    deloadTriggered: z.boolean(),
    daysChanged: z.array(isoDate).max(SIMULATION_LIMITS.daysShown),
  }),
  warnings: z.array(checkSummarySchema).max(SIMULATION_LIMITS.warningsShown),
  /** For a change to the running workout: what the engine's assessment of it said. */
  verdict: z.enum(VERDICTS).nullable(),
});

export type SimulateOutput = z.infer<typeof simulateOutputSchema>;
