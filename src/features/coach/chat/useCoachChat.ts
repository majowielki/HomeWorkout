import { useCallback, useEffect, useReducer, useRef } from 'react';

import { runTurn, type TurnDeps, type TurnOutcome } from '@/ai/chat/runTurn';
import type { Exchange } from '@/ai/chat/history';
import type { ChatFacts } from '@/ai/contract/chat';
import type { ToolName } from '@/ai/contract/chatTools';

import { chatReducer, initialChatState, isBusy } from './state';
import type { ProposalStatus, ProposalView } from '@/app-services/coach/proposalsV2';

/** The tools whose result may carry a card for the person to apply. */
const PROPOSAL_TOOLS: ReadonlySet<ToolName> = new Set([
  'proposePlanChange',
  'proposeExtraSession',
  'proposeDayPlan',
  'proposeSessionChange',
]);

interface Options {
  /** Null until the weekly context is built; nothing can be asked before. */
  facts: ChatFacts | null;
  deps: TurnDeps;
  /** Called once per finished turn, to keep it. A failure here never reaches the screen. */
  onTurn?: (outcome: TurnOutcome, facts: ChatFacts) => void | Promise<void>;
  onQuestion?: (text: string, facts: ChatFacts) => void;
  loadFacts?: () => Promise<ChatFacts>;
  resolveProposal?: (id: string) => ProposalView | null;
}

/**
 * The conversation, as state a screen can draw: what was asked, what is
 * streaming in, what ended how. The loop itself is `runTurn`; this holds
 * the parts that outlive one question (the memory, the cancel handle).
 *
 * Leaving the screen cancels the turn in flight, all the way to the provider.
 */
export function useCoachChat({
  facts,
  deps,
  onTurn,
  onQuestion,
  resolveProposal,
  loadFacts,
}: Options) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const history = useRef<Exchange[]>([]);
  const controller = useRef<AbortController | null>(null);
  const lastText = useRef('');
  const asked = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      if (!facts || controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      lastText.current = text;
      asked.current += 1;
      dispatch({ type: 'asked', id: `q${asked.current}`, text });

      let askedFacts = facts;
      try {
        if (loadFacts) askedFacts = await loadFacts();
      } catch {
        if (controller.current === abort) {
          controller.current = null;
          dispatch({ type: abort.signal.aborted ? 'preparationCancelled' : 'preparationFailed' });
        }
        return;
      }
      if (controller.current !== abort) return;
      if (abort.signal.aborted) {
        controller.current = null;
        dispatch({ type: 'preparationCancelled' });
        return;
      }
      onQuestion?.(text, askedFacts);

      const outcome = await runTurn(
        {
          facts: askedFacts,
          history: history.current,
          text,
          signal: abort.signal,
          listener: {
            onText: (delta) => dispatch({ type: 'delta', text: delta }),
            onToolStart: (call) => dispatch({ type: 'tool', name: call.name }),
            onToolDone: () => dispatch({ type: 'tool', name: null }),
          },
        },
        deps,
      );

      // A new conversation was started while this one was running: nothing here belongs to it.
      if (controller.current !== abort) return;
      controller.current = null;
      if (outcome.kind === 'answered') history.current = outcome.history;
      const proposals: ProposalView[] = [];
      if (outcome.kind === 'answered' && !outcome.truncated) {
        for (const message of outcome.messages) {
          if (message.role !== 'tool') continue;
          for (const result of message.results) {
            if (!PROPOSAL_TOOLS.has(result.name)) continue;
            const output = result.output as { proposalId?: string | null };
            const proposal = output.proposalId ? resolveProposal?.(output.proposalId) : null;
            if (proposal && !proposals.some((p) => p.id === proposal.id)) proposals.push(proposal);
          }
        }
      }
      dispatch({ type: 'finished', outcome, proposals });

      try {
        await onTurn?.(outcome, askedFacts);
      } catch (error) {
        console.warn('could not keep the chat exchange', error);
      }
    },
    [facts, deps, onTurn, onQuestion, resolveProposal, loadFacts],
  );

  return {
    entries: state.entries,
    setProposalStatus: useCallback(
      (id: string, status: ProposalStatus) => dispatch({ type: 'proposalStatus', id, status }),
      [],
    ),
    busy: isBusy(state.entries),
    send,
    stop: useCallback(() => controller.current?.abort(), []),
    retry: useCallback(() => {
      dispatch({ type: 'dropLastTurn' });
      void send(lastText.current);
    }, [send]),
    newChat: useCallback(() => {
      controller.current?.abort();
      controller.current = null;
      history.current = [];
      dispatch({ type: 'reset' });
    }, []),
  };
}
