import type { ClientFailure } from '@/ai/client/coachClient';
import { pl } from '@/strings/pl';

export interface FailureView {
  text: string;
  /** Whether trying again by hand can plausibly help. */
  canRetry: boolean;
}

/**
 * Every way a call can fail, as something a person can read. The `never`
 * in the last line makes this an exhaustive switch: a new `kind` in the
 * contract fails the typecheck here until it has a sentence of its own
 * (AI-INTEGRACJA §4.6).
 *
 * Returns null for `aborted`: pressing Cancel is not a failure to report.
 */
export function describeFailure(failure: ClientFailure): FailureView | null {
  const e = pl.coach.ai.errors;
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { text: e.offline, canRetry: true };
    case 'client_timeout':
    case 'timeout':
      return { text: e.timeout, canRetry: true };
    case 'rate_limited':
      return { text: e.rateLimited, canRetry: true };
    case 'upstream_error':
      return { text: e.upstream, canRetry: true };
    case 'invalid_output':
      return { text: e.invalidOutput, canRetry: true };
    case 'budget_exhausted':
      return { text: e.budget, canRetry: false };
    case 'unauthorized':
      return { text: e.unauthorized, canRetry: false };
    case 'contract_mismatch':
      return { text: e.contractMismatch, canRetry: false };
    case 'misconfigured':
      return { text: e.misconfigured, canRetry: false };
    case 'not_found':
    case 'bad_request':
    case 'payload_too_large':
    case 'protocol_error':
      return { text: e.incompatible, canRetry: false };
    default: {
      const unhandled: never = failure;
      return unhandled;
    }
  }
}
