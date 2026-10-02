/**
 * What every Worker endpoint can answer besides its own success shape.
 *
 * One union for every failure, so the app maps `kind` onto a screen state
 * with an exhaustive switch and never has to guess from a status code
 * (AI-INTEGRACJA §4.6). The weekly summary and the chat share it: a new
 * kind added here fails the typecheck in both screens until each has a
 * sentence for it.
 */
import { z } from 'zod';

const tokens = z.number().int().nonnegative();

export const usageSchema = z.strictObject({ inputTokens: tokens, outputTokens: tokens });

export type Usage = z.infer<typeof usageSchema>;

export const apiErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unauthorized') }),
  z.strictObject({ kind: z.literal('not_found') }),
  z.strictObject({ kind: z.literal('payload_too_large') }),
  z.strictObject({ kind: z.literal('bad_request'), issues: tokens }),
  z.strictObject({
    kind: z.literal('contract_mismatch'),
    expected: z.number().int(),
    got: z.number().int().nullable(),
  }),
  z.strictObject({ kind: z.literal('rate_limited') }),
  z.strictObject({ kind: z.literal('budget_exhausted') }),
  /** The model's answers failed validation twice. Nothing is returned that could mislead. */
  z.strictObject({
    kind: z.literal('invalid_output'),
    requestId: z.string(),
    promptVersion: z.string(),
    attempts: tokens,
    usage: usageSchema,
  }),
  z.strictObject({ kind: z.literal('upstream_error'), retryable: z.boolean() }),
  z.strictObject({ kind: z.literal('timeout') }),
  z.strictObject({ kind: z.literal('misconfigured') }),
]);

export type ApiError = z.infer<typeof apiErrorSchema>;
