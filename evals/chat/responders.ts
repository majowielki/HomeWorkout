import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { ChatEvent, ChatRequest } from '@/ai/contract/chat';

import type { Report } from '../report';
import { REFERENCE_CHAT_MODEL, referenceChatStep } from './reference';
import type { ChatCase } from './schema';

/**
 * Who plays the model in a chat case. A case is a conversation of several
 * steps (ask for tools, read the results, answer), so a responder is asked
 * once per case for something that answers one step at a time.
 */
export interface ChatStepper {
  /** One model step, as the events the Worker would stream. */
  step(request: ChatRequest): Promise<ChatEvent[]>;
  /** Called when the case is over, whatever came of it. */
  done?(): void;
}

export interface ChatResponder {
  kind: Report['responder'];
  forCase(evalCase: ChatCase): ChatStepper | { error: string };
}

/** The rule-based stand-in. Deterministic, instant, free: what CI runs on every push. */
export const referenceChatResponder: ChatResponder = {
  kind: 'reference',
  forCase: () => ({ step: async (request) => referenceChatStep(request) }),
};

/** What a live run saves for a case, and a recorded run replays. */
export interface Recording {
  steps: ChatEvent[][];
}

/** Steps saved by an earlier live run, replayed in order without a network. */
export function recordedChatResponder(dir: string): ChatResponder {
  return {
    kind: 'recorded',
    forCase(evalCase) {
      let recording: Recording;
      try {
        recording = JSON.parse(readFileSync(join(dir, `${evalCase.id}.json`), 'utf8')) as Recording;
      } catch {
        return { error: `no recording for ${evalCase.id} in ${dir}` };
      }
      let next = 0;
      return {
        async step() {
          const events = recording.steps[next];
          next += 1;
          if (!events) throw new Error('the conversation asked for more steps than were recorded');
          return events;
        },
      };
    },
  };
}

export interface LiveChatDeps {
  /** Calls the model through the very code the Worker runs. Injected so it can be faked. */
  step: (request: ChatRequest) => Promise<ChatEvent[]>;
  /** Where to save each case's steps for later replay, if anywhere. */
  recordTo?: string;
}

/**
 * A real model, called through the Worker's own step code, so the
 * evaluation measures what production runs: the same prompt, the same tool
 * declarations, the same events. Every step is kept so the case can be
 * replayed offline.
 */
export function liveChatResponder(deps: LiveChatDeps): ChatResponder {
  return {
    kind: 'live',
    forCase(evalCase) {
      const steps: ChatEvent[][] = [];
      return {
        async step(request) {
          const events = await deps.step(request);
          steps.push(events);
          return events;
        },
        done() {
          if (!deps.recordTo || steps.length === 0) return;
          const file = join(deps.recordTo, `${evalCase.id}.json`);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify({ steps } satisfies Recording, null, 2) + '\n');
        },
      };
    },
  };
}

export { REFERENCE_CHAT_MODEL };
