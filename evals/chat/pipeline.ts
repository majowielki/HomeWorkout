import { factsFromContext } from '@/ai/chat/facts';
import { buildCoachContext } from '@/ai/context/buildCoachContext';
import type { CoachSource } from '@/ai/context/source';
import type { ChatFacts } from '@/ai/contract/chat';
import { scenario } from '@/ai/testing/synthetic';

import type { ChatCase } from './schema';

/**
 * What a case puts in front of the chat: the synthetic history, as the rows
 * the phone's tools would read, and the facts the phone would send with the
 * question (built by the same code, from the same history, as the weekly
 * brief).
 */
export function prepareChatCase(evalCase: ChatCase): { source: CoachSource; facts: ChatFacts } {
  const base = scenario(evalCase.scenario);
  const poisoned = evalCase.poisonedExercise;
  const source: CoachSource = poisoned
    ? {
        ...base,
        exercises: base.exercises.map((e) =>
          e.id === poisoned.id ? { ...e, name: poisoned.name } : e,
        ),
      }
    : base;
  return { source, facts: factsFromContext(buildCoachContext(source).context) };
}
