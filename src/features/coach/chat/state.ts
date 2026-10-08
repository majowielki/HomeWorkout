import type { TurnOutcome } from '@/ai/chat/runTurn';
import { CHAT_LIMITS } from '@/ai/contract/chat';
import type { ToolName } from '@/ai/contract/chatTools';
import { pl } from '@/strings/pl';

import { describeTurnFailure } from './turnErrors';
import type { ProposalStatus, ProposalView } from './proposals';

export type Entry =
  | { id: string; kind: 'proposal'; proposal: ProposalView; status: ProposalStatus }
  | { id: string; kind: 'user'; text: string }
  | {
      id: string;
      kind: 'assistant';
      text: string;
      /** `streaming` until the turn ends; the others say how it ended. */
      state: 'streaming' | 'done' | 'truncated' | 'interrupted' | 'stopped';
      /** The tool being run right now, for the "looking that up" line. */
      activity: ToolName | null;
    }
  /** The app speaking for itself: a refusal, a withheld reply, an error. */
  | { id: string; kind: 'notice'; tone: 'info' | 'error'; text: string; canRetry: boolean };

export interface ChatState {
  entries: Entry[];
}

export const initialChatState: ChatState = { entries: [] };

export type ChatAction =
  | { type: 'asked'; id: string; text: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: ToolName | null }
  | { type: 'finished'; outcome: TurnOutcome; proposals?: ProposalView[] }
  | { type: 'proposalStatus'; id: string; status: ProposalStatus }
  | { type: 'preparationFailed' }
  | { type: 'preparationCancelled' }
  /** Takes the last question and everything that came of it off the screen, to ask it again. */
  | { type: 'dropLastTurn' }
  | { type: 'reset' };

const isStreaming = (entry: Entry | undefined): entry is Extract<Entry, { kind: 'assistant' }> =>
  entry?.kind === 'assistant' && entry.state === 'streaming';

/** Whether a turn is in flight: the last thing on screen is an answer still arriving. */
export const isBusy = (entries: readonly Entry[]) => isStreaming(entries[entries.length - 1]);

/** The app's own sentence for a message it did not pass on. */
function blockedText(gate: Extract<TurnOutcome, { kind: 'blocked' }>['gate']): string {
  const b = pl.coach.chat.blocked;
  switch (gate.kind) {
    case 'medical':
      return b.medical;
    case 'out_of_scope':
      return b.outOfScope;
    case 'too_long':
      return b.tooLong(CHAT_LIMITS.userChars);
    case 'empty':
      return b.empty;
  }
}

/** What replaces the streaming placeholder once the turn is over. */
function conclusion(placeholder: Entry & { kind: 'assistant' }, outcome: TurnOutcome): Entry[] {
  const notice = (tone: 'info' | 'error', text: string, canRetry = false): Entry => ({
    id: `${placeholder.id}-n`,
    kind: 'notice',
    tone,
    text,
    canRetry,
  });

  switch (outcome.kind) {
    case 'answered':
      return [
        {
          ...placeholder,
          text: outcome.text,
          state: outcome.truncated ? 'truncated' : 'done',
          activity: null,
        },
      ];
    case 'withheld':
      return [notice('info', pl.coach.chat.withheld)];
    case 'blocked':
      return [notice('info', blockedText(outcome.gate))];
    case 'aborted':
      return placeholder.text.trim() === ''
        ? []
        : [{ ...placeholder, state: 'stopped', activity: null }];
    case 'failed': {
      const view = describeTurnFailure(outcome.failure);
      const kept: Entry[] =
        outcome.partialText.trim() === ''
          ? []
          : [{ ...placeholder, text: outcome.partialText, state: 'interrupted', activity: null }];
      return view ? [...kept, notice('error', view.text, view.canRetry)] : kept;
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  const { entries } = state;
  const last = entries[entries.length - 1];

  switch (action.type) {
    case 'asked':
      return {
        entries: [
          ...entries.map((e) =>
            e.kind === 'proposal' && (e.status === 'pending' || e.status === 'failed')
              ? { ...e, status: 'stale' as const }
              : e,
          ),
          { id: action.id, kind: 'user', text: action.text },
          { id: `${action.id}-a`, kind: 'assistant', text: '', state: 'streaming', activity: null },
        ],
      };
    case 'delta':
      return isStreaming(last)
        ? {
            entries: [
              ...entries.slice(0, -1),
              { ...last, text: last.text + action.text, activity: null },
            ],
          }
        : state;
    case 'tool':
      return isStreaming(last)
        ? { entries: [...entries.slice(0, -1), { ...last, activity: action.name }] }
        : state;
    case 'finished':
      return isStreaming(last)
        ? {
            entries: [
              ...entries.slice(0, -1),
              ...conclusion(last, action.outcome),
              ...(action.outcome.kind === 'answered' && !action.outcome.truncated
                ? (action.proposals ?? []).map((proposal): Entry => ({
                    id: proposal.id,
                    kind: 'proposal',
                    proposal,
                    status: 'pending',
                  }))
                : []),
            ],
          }
        : state;
    case 'proposalStatus':
      return {
        entries: entries.map((e) =>
          e.kind === 'proposal' && e.id === action.id ? { ...e, status: action.status } : e,
        ),
      };
    case 'preparationFailed':
      return isStreaming(last)
        ? {
            entries: [
              ...entries.slice(0, -1),
              {
                id: `${last.id}-preflight`,
                kind: 'notice',
                tone: 'error',
                text: pl.coach.loadError,
                canRetry: true,
              },
            ],
          }
        : state;
    case 'preparationCancelled':
      return isStreaming(last) ? { entries: entries.slice(0, -1) } : state;
    case 'dropLastTurn': {
      const at = entries.map((e) => e.kind).lastIndexOf('user');
      return at === -1 ? state : { entries: entries.slice(0, at) };
    }
    case 'reset':
      return initialChatState;
  }
}
