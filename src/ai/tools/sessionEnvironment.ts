/**
 * The phone's side of the tools that consult the running session (contract 7, 11 §8).
 *
 * `source()` hands over a fresh reading of the session and everything the assessment needs, or null
 * when no workout of engine is running; each call to a tool reads it again, so an answer is about
 * the session as it is now. The model asks with the words of the person; the engine assesses; the
 * assessments are remembered for the turn so that `proposeSessionChange` can name one by its id. A
 * proposal is accepted only if the session is still the one the assessment was about: it is assessed
 * again, and an assessment with another id is `stale_assessment`.
 *
 * Nothing here writes. The card the person accepts on becomes `applySessionChange`, which assesses
 * once more inside its own transaction.
 */
import { adviceToAcknowledge, type RuleCode } from '../../domain/policy/hardAdvice';
import { assessSessionChange } from '../../domain/session/assess';
import type {
  ActiveSessionState,
  ChangeAssessment,
  SessionChange,
  SessionChangeSnapshot,
} from '../../domain/session/types';
import type { ToolError, ToolInput, ToolOutput } from '../contract/chatTools';
import { SESSION_LIMITS, type SessionChangeInput } from '../contract/sessionTools';
import { activeSessionSummary, assessmentSummary } from './sessionSummary';

export interface SessionSource {
  snap: SessionChangeSnapshot;
  session: ActiveSessionState;
}

/** A change the person can accept on the phone: all the command needs but their word and a channel. */
export interface SessionProposal {
  proposalId: string;
  change: SessionChange;
  patchId: string;
  assessmentId: string;
  /** The revisions the assessment was made on; the command refuses anything else. */
  expected: { planRevision: number; historyRevision: number };
  acknowledge: RuleCode[];
  verdict: ChangeAssessment['verdict'];
}

export interface SessionToolHooks {
  activeSession(): Promise<ToolOutput<'getActiveSession'> | ToolError>;
  assessChange(
    input: ToolInput<'assessSessionChange'>,
  ): Promise<ToolOutput<'assessSessionChange'> | ToolError>;
  proposeChange(
    input: ToolInput<'proposeSessionChange'>,
  ): Promise<ToolOutput<'proposeSessionChange'> | ToolError>;
}

/** The words of the person in the model's input become the references the engine resolves. */
export function changeOf(input: SessionChangeInput): SessionChange {
  switch (input.kind) {
    case 'add_exercise':
      return {
        kind: 'add_exercise',
        exercise: { query: input.query },
        ...(input.sets === undefined ? {} : { sets: input.sets }),
        ...(input.placement === undefined ? {} : { position: input.placement }),
      };
    case 'swap_remaining':
      return {
        kind: 'swap_remaining',
        exposureId: input.exposureId,
        exercise: { query: input.query },
      };
    case 'reduce_remaining':
      return {
        kind: 'reduce_remaining',
        exposureId: input.exposureId,
        ...(input.dropSets === undefined ? {} : { dropSets: input.dropSets }),
        ...(input.easier === undefined ? {} : { easier: input.easier }),
      };
    default:
      return input;
  }
}

export function createSessionToolHooks(
  source: () => SessionSource | null,
  /** At most two assessments in a turn (11 §8); the count starts again with each new turn. */
  options: { maxAssessments?: number } = {},
): SessionToolHooks & { newTurn(): void; proposals: ReadonlyMap<string, SessionProposal> } {
  const remembered = new Map<string, SessionChange>();
  const proposals = new Map<string, SessionProposal>();
  let assessments = 0;
  const limit = options.maxAssessments ?? SESSION_LIMITS.assessmentsPerTurn;

  return {
    proposals,
    newTurn() {
      assessments = 0;
    },
    async activeSession() {
      const s = source();
      return s === null ? { error: 'no_active_session' } : activeSessionSummary(s.session, s.snap);
    },
    async assessChange(input) {
      const s = source();
      if (s === null) return { error: 'no_active_session' };
      if (assessments >= limit) return { error: 'invalid_input' };
      assessments += 1;
      const change = changeOf(input);
      const assessment = assessSessionChange(s.snap, s.session, change);
      remembered.set(assessment.assessmentId, change);
      for (const alt of assessment.alternatives) {
        remembered.set(alt.assessment.assessmentId, alt.change);
      }
      for (const option of assessment.feel?.options ?? []) {
        if (option.change !== null) remembered.set(option.assessment.assessmentId, option.change);
      }
      return assessmentSummary(assessment, s.snap.catalog);
    },
    async proposeChange({ assessmentId, patchId }) {
      const s = source();
      if (s === null) return { error: 'no_active_session' };
      const change = remembered.get(assessmentId);
      if (change === undefined) return { error: 'stale_assessment' };
      // Assessed again on the session as it is: another id means it moved on since.
      const now = assessSessionChange(s.snap, s.session, change, { maxAlternatives: 0 });
      if (now.assessmentId !== assessmentId) return { error: 'stale_assessment' };
      if (now.patch === null || now.patch.patchId !== patchId) return { error: 'invalid_input' };
      const acknowledge = adviceToAcknowledge(now.checks);
      const proposal: SessionProposal = {
        proposalId: `session-${patchId.slice(0, 24)}`,
        change,
        patchId,
        assessmentId,
        expected: {
          planRevision: s.session.plan.planRevision,
          historyRevision: s.snap.historyRevision,
        },
        acknowledge,
        verdict: now.verdict,
      };
      proposals.set(proposal.proposalId, proposal);
      return {
        proposalId: proposal.proposalId,
        kind: 'session_change',
        requiresAcceptance: true,
        verdict: now.verdict,
        patchId,
        acknowledge,
      };
    },
  };
}
