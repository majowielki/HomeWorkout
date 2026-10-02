import type { Env } from './env';

export type Outcome =
  | 'ok'
  | 'ok_after_repair'
  | 'invalid_output'
  | 'upstream_error'
  | 'timeout'
  | 'aborted'
  | 'rejected';

/**
 * One line per call, and only facts about the call. There is no field for
 * what the person or the model wrote: a log that can leak a note is a log
 * that eventually does (AI-INTEGRACJA §4.9).
 */
export interface LogRecord {
  event: 'weekly_summary' | 'chat';
  requestId: string | null;
  contractVersion: number;
  promptVersion: string | null;
  provider: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  attempts: number;
  outcome: Outcome;
  status: number;
  estimatedCostUsd: number | null;

  // --- chat only: counts and enums, still no content ---------------------
  /** Tool rounds the question had already used when this step was asked. */
  toolRound?: number;
  toolCalls?: number;
  /** Calls beyond the per-round cap that the model asked for and the Worker ignored. */
  droppedCalls?: number;
  replyChars?: number;
  finishReason?: string;
  /** How many rules the reply broke. The phone withdraws such a reply; this only counts. */
  guardViolations?: number;
  /** Why a request was refused, when the status alone does not say. */
  reason?: 'text_gate';
}

/** Prices come from configuration, not from this code: they change, and a stale table is a lie. */
export function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  env: Pick<Env, 'PRICE_INPUT_USD_PER_MTOK' | 'PRICE_OUTPUT_USD_PER_MTOK'>,
): number | null {
  const input = Number(env.PRICE_INPUT_USD_PER_MTOK);
  const output = Number(env.PRICE_OUTPUT_USD_PER_MTOK);
  if (!env.PRICE_INPUT_USD_PER_MTOK || !env.PRICE_OUTPUT_USD_PER_MTOK) return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (tokensIn * input + tokensOut * output) / 1_000_000;
}

export function logRecord(record: LogRecord, sink: (line: string) => void = console.log): void {
  sink(JSON.stringify(record));
}
