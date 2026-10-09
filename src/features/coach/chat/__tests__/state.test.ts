import type { TurnOutcome } from '@/ai/chat/runTurn';
import { CHAT_LIMITS } from '@/ai/contract/chat';
import { pl } from '@/strings/pl';

import { chatReducer, initialChatState, isBusy, type ChatAction, type ChatState } from '../state';
import { describeTurnFailure } from '../turnErrors';
import type { ProposalView } from '@/app-services/coach/proposalsV2';

const meta = {
  requestIds: ['req-1-aaaaaaa'],
  promptVersion: 'chat/v1',
  model: 'm',
  rounds: 0,
  tools: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 10,
  messages: [],
};

const proposal: ProposalView = {
  id: 'p',
  note: 'Jutro wolne.',
  summary: {
    kind: 'plan',
    proposalId: 'p',
    requiresAcceptance: true,
    constraints: [
      { kind: 'rest_day', muscles: [], from: '2026-10-02', until: '2026-10-02', reason: 'busy' },
    ],
    changes: [],
  },
};

describe('proposal consent state', () => {
  it('shows drafts only after a complete checked reply and expires unaccepted cards on a new question', () => {
    const out = chatReducer(apply([asked()]), {
      type: 'finished',
      outcome: { ...meta, kind: 'answered', text: 'Podgląd.', truncated: false, history: [] },
      proposals: [proposal],
    });
    expect(out.entries.at(-1)).toMatchObject({ kind: 'proposal', status: 'pending' });
    const applying = chatReducer(out, { type: 'proposalStatus', id: 'p', status: 'applying' });
    expect(applying.entries.at(-1)).toMatchObject({ status: 'applying' });
    const next = chatReducer(out, asked('Następne pytanie.', 'q2'));
    expect(next.entries.find((e) => e.id === 'p')).toMatchObject({ status: 'stale' });
    const applied = chatReducer(out, { type: 'proposalStatus', id: 'p', status: 'applied' });
    expect(
      chatReducer(applied, asked('Następne pytanie.', 'q2')).entries.find((e) => e.id === 'p'),
    ).toMatchObject({ status: 'applied' });
  });
  it.each(['withheld', 'failed', 'aborted', 'truncated'])(
    'does not expose actionable proposals after %s',
    (kind) => {
      const outcome =
        kind === 'truncated'
          ? { ...meta, kind: 'answered' as const, text: 'Podgląd.', truncated: true, history: [] }
          : kind === 'withheld'
            ? {
                ...meta,
                kind: 'withheld' as const,
                text: 'Weź ciężar.',
                violations: ['load_prescription' as const],
              }
            : kind === 'failed'
              ? {
                  ...meta,
                  kind: 'failed' as const,
                  partialText: '',
                  failure: { kind: 'offline' as const },
                }
              : { ...meta, kind: 'aborted' as const };
      const out = chatReducer(apply([asked()]), {
        type: 'finished',
        outcome,
        proposals: [proposal],
      });
      expect(out.entries.some((e) => e.kind === 'proposal')).toBe(false);
    },
  );
});

const apply = (actions: ChatAction[], from: ChatState = initialChatState) =>
  actions.reduce(chatReducer, from);

const asked = (text = 'Pytanie?', id = 'q1'): ChatAction => ({ type: 'asked', id, text });
const finished = (outcome: Partial<TurnOutcome> & { kind: TurnOutcome['kind'] }): ChatAction => ({
  type: 'finished',
  outcome: { ...meta, ...outcome } as TurnOutcome,
});

describe('a question being asked', () => {
  it('puts the question on screen with an empty answer waiting under it', () => {
    const state = apply([asked('Jak idzie?')]);
    expect(state.entries).toEqual([
      { id: 'q1', kind: 'user', text: 'Jak idzie?' },
      { id: 'q1-a', kind: 'assistant', text: '', state: 'streaming', activity: null },
    ]);
    expect(isBusy(state.entries)).toBe(true);
  });

  it('adds streamed text to the answer, piece by piece', () => {
    const state = apply([
      asked(),
      { type: 'delta', text: 'Trzy ' },
      { type: 'delta', text: 'sesje.' },
    ]);
    expect(state.entries.at(-1)).toMatchObject({ text: 'Trzy sesje.', state: 'streaming' });
  });

  it('shows which tool is being run and clears it when the words resume', () => {
    const looking = apply([asked(), { type: 'tool', name: 'getWeeklyVolume' }]);
    expect(looking.entries.at(-1)).toMatchObject({ activity: 'getWeeklyVolume' });
    const resumed = apply([{ type: 'delta', text: 'Sześć.' }], looking);
    expect(resumed.entries.at(-1)).toMatchObject({ activity: null, text: 'Sześć.' });
    const done = apply([{ type: 'tool', name: null }], looking);
    expect(done.entries.at(-1)).toMatchObject({ activity: null });
  });

  it('ignores text and tool news when nothing is streaming', () => {
    expect(apply([{ type: 'delta', text: 'x' }])).toBe(initialChatState);
    expect(apply([{ type: 'tool', name: 'findExercises' }])).toBe(initialChatState);
    expect(apply([finished({ kind: 'aborted' })])).toBe(initialChatState);
  });
});

describe('a turn that ends', () => {
  const streaming = (text = '') =>
    apply([asked(), ...(text ? [{ type: 'delta', text } as ChatAction] : [])]);

  it('settles an answer as done, or as cut off', () => {
    for (const [truncated, state] of [
      [false, 'done'],
      [true, 'truncated'],
    ] as const) {
      const out = apply(
        [finished({ kind: 'answered', text: 'Gotowe.', truncated, history: [] })],
        streaming('Got'),
      );
      expect(out.entries.at(-1)).toMatchObject({
        kind: 'assistant',
        text: 'Gotowe.',
        state,
        activity: null,
      });
      expect(isBusy(out.entries)).toBe(false);
    }
  });

  it('replaces a withheld answer with the app’s own sentence, without showing the text', () => {
    const out = apply(
      [finished({ kind: 'withheld', text: 'Zjedz białko.', violations: ['out_of_scope'] })],
      streaming('Zjedz białko.'),
    );
    expect(out.entries.map((e) => e.kind)).toEqual(['user', 'notice']);
    expect(out.entries.at(-1)).toMatchObject({ tone: 'info', text: pl.coach.chat.withheld });
    expect(JSON.stringify(out.entries)).not.toContain('białko');
  });

  it.each([
    [{ kind: 'medical' }, pl.coach.chat.blocked.medical],
    [{ kind: 'out_of_scope', topic: 'diet' }, pl.coach.chat.blocked.outOfScope],
    [{ kind: 'too_long' }, pl.coach.chat.blocked.tooLong(CHAT_LIMITS.userChars)],
    [{ kind: 'empty' }, pl.coach.chat.blocked.empty],
  ] as const)('answers a blocked message with the app’s own sentence: %j', (gate, sentence) => {
    const out = apply([finished({ kind: 'blocked', gate: gate as never })], streaming());
    expect(out.entries.at(-1)).toMatchObject({ kind: 'notice', text: sentence, canRetry: false });
  });

  it('keeps what was said before a failure, marked as interrupted, with the error after it', () => {
    const out = apply(
      [finished({ kind: 'failed', failure: { kind: 'offline' }, partialText: 'Zaczynam' })],
      streaming('Zaczynam'),
    );
    expect(out.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'notice']);
    expect(out.entries[1]).toMatchObject({ text: 'Zaczynam', state: 'interrupted' });
    expect(out.entries[2]).toMatchObject({ tone: 'error', canRetry: true });
  });

  it('shows only the error when a failure came before any words', () => {
    const out = apply(
      [finished({ kind: 'failed', failure: { kind: 'budget_exhausted' }, partialText: '  ' })],
      streaming(),
    );
    expect(out.entries.map((e) => e.kind)).toEqual(['user', 'notice']);
    expect(out.entries[1]).toMatchObject({ canRetry: false });
  });

  it('shows nothing for a failure that is only a cancellation, beyond what was said', () => {
    const out = apply(
      [finished({ kind: 'failed', failure: { kind: 'aborted' }, partialText: 'Zaczynam' })],
      streaming('Zaczynam'),
    );
    expect(out.entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
  });

  it('keeps the words of a turn that was stopped, and drops an empty answer', () => {
    const kept = apply([finished({ kind: 'aborted' })], streaming('Zaczynam'));
    expect(kept.entries.at(-1)).toMatchObject({ state: 'stopped', text: 'Zaczynam' });
    const dropped = apply([finished({ kind: 'aborted' })], streaming());
    expect(dropped.entries.map((e) => e.kind)).toEqual(['user']);
    expect(isBusy(dropped.entries)).toBe(false);
  });
});

describe('asking again and starting over', () => {
  it('takes the last question and what came of it off the screen', () => {
    const first = apply([
      asked('Pierwsze?', 'q1'),
      finished({ kind: 'answered', text: 'Tak.', truncated: false, history: [] }),
      asked('Drugie?', 'q2'),
      finished({ kind: 'failed', failure: { kind: 'offline' }, partialText: '' }),
    ]);
    expect(first.entries.map((e) => e.id)).toEqual(['q1', 'q1-a', 'q2', 'q2-a-n']);
    const dropped = apply([{ type: 'dropLastTurn' }], first);
    expect(dropped.entries.map((e) => e.id)).toEqual(['q1', 'q1-a']);
  });

  it('does nothing when there is nothing to take off', () => {
    expect(apply([{ type: 'dropLastTurn' }])).toBe(initialChatState);
  });

  it('starts over', () => {
    expect(apply([asked(), { type: 'reset' }])).toEqual(initialChatState);
  });
});

describe('describeTurnFailure', () => {
  it('has a sentence of its own for the two failures only the loop knows', () => {
    expect(describeTurnFailure({ kind: 'tool_limit' })).toEqual({
      text: pl.coach.chat.errors.toolLimit,
      canRetry: true,
    });
    expect(describeTurnFailure({ kind: 'empty_reply' })).toEqual({
      text: pl.coach.chat.errors.emptyReply,
      canRetry: true,
    });
  });

  it('uses the weekly summary’s sentences for the rest, and says nothing for a cancellation', () => {
    expect(describeTurnFailure({ kind: 'offline' })?.text).toBe(pl.coach.ai.errors.offline);
    expect(describeTurnFailure({ kind: 'aborted' })).toBeNull();
  });
});
