import { useCallback, useEffect, useReducer, useRef } from 'react';

import { runTurn, type TurnDeps, type TurnOutcome } from '@/ai/chat/runTurn';
import type { Exchange } from '@/ai/chat/history';
import type { ChatFacts } from '@/ai/contract/chat';

import { chatReducer, initialChatState, isBusy } from './state';

interface Options {
  /** Null until the weekly context is built; nothing can be asked before. */
  facts: ChatFacts | null;
  deps: TurnDeps;
  /** Called once per finished turn, to keep it. A failure here never reaches the screen. */
  onTurn?: (outcome: TurnOutcome, facts: ChatFacts) => void | Promise<void>;
}

/**
 * The conversation, as state a screen can draw: what was asked, what is
 * streaming in, what ended how. The loop itself is `runTurn`; this holds
 * the parts that outlive one question (the memory, the cancel handle).
 *
 * Leaving the screen cancels the turn in flight, all the way to the provider.
 */
export function useCoachChat({ facts, deps, onTurn }: Options) {
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

      const outcome = await runTurn(
        {
          facts,
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
      dispatch({ type: 'finished', outcome });

      try {
        await onTurn?.(outcome, facts);
      } catch (error) {
        console.warn('could not keep the chat exchange', error);
      }
    },
    [facts, deps, onTurn],
  );

  return {
    entries: state.entries,
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
