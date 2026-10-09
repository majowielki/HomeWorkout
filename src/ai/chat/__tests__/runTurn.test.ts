import type { StreamEnd } from '../../client/chatClient';
import {
  CHAT_LIMITS,
  type ChatEvent,
  type ChatFacts,
  type ChatRequest,
  conversationProblem,
  type ToolCall,
  type ToolResult,
} from '../../contract/chat';
import { CONTRACT_VERSION } from '../../contract/versions';
import { runTurn, type TurnDeps, type TurnListener } from '../runTurn';

const facts: ChatFacts = {
  asOf: '2026-10-01',
  historicalSessionCount: 12,
  signals: [],
  constraints: [],
};
const sparse: ChatFacts = { ...facts, historicalSessionCount: 2, signals: ['SPARSE_HISTORY'] };

const start: ChatEvent = { type: 'start', requestId: 'r', promptVersion: 'chat/v1', model: 'm' };
const text = (delta: string): ChatEvent => ({ type: 'text', delta });
const finish = (
  reason: 'stop' | 'tool_calls' | 'length' | 'other' = 'stop',
  tokens: [number, number] = [100, 10],
): ChatEvent => ({
  type: 'finish',
  reason,
  usage: { inputTokens: tokens[0], outputTokens: tokens[1] },
});
const call = (id: string, name: ToolCall['name'] = 'getWeeklyVolume'): ToolCall => ({
  id,
  name,
  input: name === 'getWeeklyVolume' ? { weeksAgo: 0 } : { days: 30 },
});
const toolStep = (...calls: ToolCall[]): Step => ({
  events: [
    start,
    ...calls.map((c): ChatEvent => ({ type: 'tool_call', call: c })),
    finish('tool_calls'),
  ],
});
const answerStep = (...pieces: string[]): Step => ({
  events: [start, ...pieces.map(text), finish('stop')],
});

type Step = { events: ChatEvent[]; end?: StreamEnd };

/** A Worker that answers the scripted steps in order, and remembers what it was asked. */
function harness(steps: Step[], overrides: Partial<TurnDeps> = {}) {
  const requests: ChatRequest[] = [];
  const executed: string[] = [];
  let ids = 0;
  let clock = 0;
  const deps: TurnDeps = {
    stream: async (request, options) => {
      requests.push(structuredClone(request));
      const step = steps[Math.min(requests.length - 1, steps.length - 1)]!;
      for (const event of step.events) options.onEvent(event);
      return step.end ?? { kind: 'complete' };
    },
    executeTool: async (c): Promise<ToolResult> => {
      executed.push(c.id);
      return { callId: c.id, name: c.name, output: { error: 'failed' } };
    },
    newRequestId: () => `req-${(ids += 1)}`.padEnd(12, '0'),
    now: () => (clock += 25),
    ...overrides,
  };
  return { deps, requests, executed };
}

const ask = (deps: TurnDeps, textToSend = 'Jak idzie wiosłowanie?', extra = {}) =>
  runTurn({ facts, history: [], text: textToSend, ...extra }, deps);

describe('a message the gate stops', () => {
  it.each([
    ['an injury', 'Strzyknęło mnie w kolanie', { kind: 'medical' }],
    ['a question about diet', 'Ile białka mam jeść?', { kind: 'out_of_scope', topic: 'diet' }],
    ['a message with nothing in it', '   ', { kind: 'empty' }],
    ['a message that is too long', 'a'.repeat(CHAT_LIMITS.userChars + 1), { kind: 'too_long' }],
  ])('%s sends nothing and reports why', async (_name, input, gate) => {
    const { deps, requests } = harness([answerStep('nope')]);
    const outcome = await ask(deps, input);
    expect(outcome).toMatchObject({ kind: 'blocked', gate, requestIds: [], rounds: 0 });
    expect(requests).toHaveLength(0);
  });
});

describe('a question answered at once', () => {
  it('sends the facts and the question, streams the text, and returns the answer', async () => {
    const { deps, requests } = harness([answerStep('Trzy ', 'sesje.')]);
    const deltas: string[] = [];
    const outcome = await ask(deps, 'Ile mam sesji?', {
      listener: { onText: (d: string) => deltas.push(d) } satisfies TurnListener,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      facts,
      messages: [{ role: 'user', text: 'Ile mam sesji?' }],
    });
    expect(deltas).toEqual(['Trzy ', 'sesje.']);
    expect(outcome).toMatchObject({
      kind: 'answered',
      text: 'Trzy sesje.',
      truncated: false,
      rounds: 0,
      tools: [],
      promptVersion: 'chat/v1',
      model: 'm',
      usage: { inputTokens: 100, outputTokens: 10 },
      history: [{ user: 'Ile mam sesji?', assistant: 'Trzy sesje.' }],
    });
    expect(outcome.latencyMs).toBeGreaterThan(0);
  });

  it('sends the cleaned message, not the raw one', async () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const { deps, requests } = harness([answerStep('ok')]);
    await ask(deps, `  Jak${zeroWidth}   idzie\n wiosłowanie?  `);
    expect(requests[0]!.messages[0]).toEqual({ role: 'user', text: 'Jak idzie wiosłowanie?' });
  });

  it('reports a reply that was cut off as unfinished, not as a failure', async () => {
    for (const reason of ['length', 'other'] as const) {
      const { deps } = harness([{ events: [start, text('Urwane'), finish(reason)] }]);
      expect(await ask(deps)).toMatchObject({ kind: 'answered', truncated: true, text: 'Urwane' });
    }
  });

  it('treats a reply with nothing in it as a failure', async () => {
    const { deps } = harness([{ events: [start, finish('stop')] }]);
    expect(await ask(deps)).toMatchObject({
      kind: 'failed',
      failure: { kind: 'empty_reply' },
      partialText: '',
    });
  });
});

describe('a question that needs tools', () => {
  it('runs the tool on the phone and asks again with the result in the conversation', async () => {
    const c = call('c1');
    const { deps, requests, executed } = harness([toolStep(c), answerStep('Sześć serii.')]);
    const seen: string[] = [];
    const outcome = await ask(deps, 'Ile serii na plecy?', {
      listener: {
        onToolStart: (x) => seen.push(`start ${x.name}`),
        onToolDone: (x) => seen.push(`done ${x.name}`),
      } satisfies TurnListener,
    });

    expect(executed).toEqual(['c1']);
    expect(seen).toEqual(['start getWeeklyVolume', 'done getWeeklyVolume']);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages).toEqual([
      { role: 'user', text: 'Ile serii na plecy?' },
      { role: 'assistant', text: '', toolCalls: [c] },
      {
        role: 'tool',
        results: [{ callId: 'c1', name: 'getWeeklyVolume', output: { error: 'failed' } }],
      },
    ]);
    expect(conversationProblem(requests[1]!.messages)).toBeNull();
    expect(outcome).toMatchObject({
      kind: 'answered',
      text: 'Sześć serii.',
      rounds: 1,
      tools: ['getWeeklyVolume'],
      usage: { inputTokens: 200, outputTokens: 20 },
    });
    expect((outcome as { requestIds: string[] }).requestIds).toHaveLength(2);
    expect(new Set((outcome as { requestIds: string[] }).requestIds).size).toBe(2);
  });

  it('runs several calls of one round in order, and answers all of them together', async () => {
    const calls = [call('a'), call('b', 'getBodyTrend')];
    const { deps, requests, executed } = harness([toolStep(...calls), answerStep('ok')]);
    await ask(deps);
    expect(executed).toEqual(['a', 'b']);
    expect(requests[1]!.messages.at(-1)).toMatchObject({
      role: 'tool',
      results: [{ callId: 'a' }, { callId: 'b' }],
    });
  });

  it('runs no more calls in a round than allowed', async () => {
    const many = Array.from({ length: CHAT_LIMITS.callsPerRound + 2 }, (_, i) => call(`c${i}`));
    const { deps, requests, executed } = harness([toolStep(...many), answerStep('ok')]);
    await ask(deps);
    expect(executed).toHaveLength(CHAT_LIMITS.callsPerRound);
    expect(conversationProblem(requests[1]!.messages)).toBeNull();
  });

  it('keeps what the model said before the call, with a line break before the answer', async () => {
    const { deps, requests } = harness([
      {
        events: [
          start,
          text('Sprawdzam.'),
          { type: 'tool_call', call: call('c1') },
          finish('tool_calls'),
        ],
      },
      answerStep('Gotowe.'),
    ]);
    const deltas: string[] = [];
    const outcome = await ask(deps, 'Pytanie?', {
      listener: { onText: (d: string) => deltas.push(d) } satisfies TurnListener,
    });
    expect(requests[1]!.messages[1]).toMatchObject({ role: 'assistant', text: 'Sprawdzam.' });
    expect(deltas).toEqual(['Sprawdzam.', '\nGotowe.']);
    expect(outcome).toMatchObject({ kind: 'answered', text: 'Sprawdzam.\nGotowe.' });
  });

  it('does not add a break after text that already ends in one', async () => {
    const { deps } = harness([
      {
        events: [
          start,
          text('Sprawdzam.\n'),
          { type: 'tool_call', call: call('c1') },
          finish('tool_calls'),
        ],
      },
      answerStep('Gotowe.'),
    ]);
    const outcome = await ask(deps);
    expect(outcome).toMatchObject({ text: 'Sprawdzam.\nGotowe.' });
  });

  it('takes a call that comes with a "stop" for a call all the same', async () => {
    const { deps, executed } = harness([
      { events: [start, { type: 'tool_call', call: call('c1') }, finish('stop')] },
      answerStep('ok'),
    ]);
    expect(await ask(deps)).toMatchObject({ kind: 'answered', rounds: 1 });
    expect(executed).toEqual(['c1']);
  });

  it('fails when the model says it wants tools and names none', async () => {
    const { deps } = harness([{ events: [start, finish('tool_calls')] }]);
    expect(await ask(deps)).toMatchObject({ kind: 'failed', failure: { kind: 'protocol_error' } });
  });

  it('treats words before a call, followed by an empty answer, as no answer', async () => {
    const { deps } = harness([
      {
        events: [
          start,
          text('Sprawdzam.'),
          { type: 'tool_call', call: call('c1') },
          finish('tool_calls'),
        ],
      },
      { events: [start, finish('stop')] },
    ]);
    expect(await ask(deps)).toMatchObject({
      kind: 'failed',
      failure: { kind: 'empty_reply' },
      partialText: 'Sprawdzam.',
    });
  });

  it('stops a model that will not stop asking, after exactly the allowed rounds', async () => {
    let n = 0;
    const endless: Step = { events: [] };
    const { deps, requests, executed } = harness([endless], {
      stream: async (request, options) => {
        requests.push(structuredClone(request));
        n += 1;
        for (const e of toolStep(call(`loop-${n}`)).events) options.onEvent(e);
        return { kind: 'complete' };
      },
    });
    const outcome = await ask(deps);
    expect(outcome).toMatchObject({
      kind: 'failed',
      failure: { kind: 'tool_limit' },
      rounds: CHAT_LIMITS.toolRounds,
    });
    expect(executed).toHaveLength(CHAT_LIMITS.toolRounds);
    expect(requests).toHaveLength(CHAT_LIMITS.toolRounds + 1);
  });
});

describe('what the conversation remembers', () => {
  it('carries earlier questions as question and answer, and drops their tool traffic', async () => {
    const first = harness([toolStep(call('c1')), answerStep('Sześć serii.')]);
    const one = await ask(first.deps, 'Ile serii na plecy?');
    if (one.kind !== 'answered') throw new Error('expected an answer');

    const second = harness([answerStep('Dzięki.')]);
    await runTurn({ facts, history: one.history, text: 'A na nogi?' }, second.deps);
    expect(second.requests[0]!.messages).toEqual([
      { role: 'user', text: 'Ile serii na plecy?' },
      { role: 'assistant', text: 'Sześć serii.', toolCalls: [] },
      { role: 'user', text: 'A na nogi?' },
    ]);
  });

  it('forgets the oldest questions beyond the limit', async () => {
    let history = [] as { user: string; assistant: string }[];
    for (let i = 0; i < CHAT_LIMITS.rememberedTurns + 3; i += 1) {
      const { deps } = harness([answerStep(`odpowiedź ${i}`)]);
      const outcome = await runTurn({ facts, history, text: `pytanie ${i}` }, deps);
      if (outcome.kind !== 'answered') throw new Error('expected an answer');
      history = outcome.history;
    }
    expect(history).toHaveLength(CHAT_LIMITS.rememberedTurns);
    expect(history[0]!.user).toBe('pytanie 3');
  });

  it('does not remember a question whose answer was withheld or failed', async () => {
    const { deps } = harness([answerStep('Zjedz więcej białka.')]);
    const outcome = await runTurn(
      { facts, history: [{ user: 'a', assistant: 'b' }], text: 'Pytanie?' },
      deps,
    );
    expect(outcome.kind).toBe('withheld');
    expect('history' in outcome).toBe(false);
  });
});

describe('an answer that breaks a rule', () => {
  it('keeps the active-session count returned in the emulator smoke test', async () => {
    const reply =
      'Aktywna sesja ma łącznie 3 zaplanowane serie pompki, z czego 0 zostało wykonanych, a 3 pozostają do zrobienia.';
    const { deps } = harness([
      toolStep({ id: 'active', name: 'getActiveSession', input: {} }),
      answerStep(reply),
    ]);
    expect(await ask(deps, 'Ile serii ma aktywna sesja?')).toMatchObject({
      kind: 'answered',
      text: reply,
      tools: ['getActiveSession'],
    });
  });

  it.each([
    ['talks about diet', 'Zjedz więcej białka po treningu.', 'out_of_scope'],
    ['gives advice about a complaint', 'Zrób rozciąganie i okład.', 'medical_advice'],
    [
      'tells the person what to lift',
      'Następnym razem zwiększ hantle do 14 kg.',
      'load_prescription',
    ],
  ])('is withheld when it %s', async (_name, reply, kind) => {
    const { deps } = harness([answerStep(reply)]);
    const outcome = await ask(deps);
    expect(outcome).toMatchObject({ kind: 'withheld', text: reply });
    expect((outcome as { violations: string[] }).violations).toContain(kind);
  });

  it('is withheld for trend vocabulary only while the history is thin', async () => {
    const trend = () => harness([answerStep('Widać wyraźny trend wzrostowy.')]);
    expect(
      await runTurn({ facts: sparse, history: [], text: 'Jak idzie?' }, trend().deps),
    ).toMatchObject({
      kind: 'withheld',
      violations: ['sparse_vocabulary'],
    });
    expect(await runTurn({ facts, history: [], text: 'Jak idzie?' }, trend().deps)).toMatchObject({
      kind: 'answered',
    });
  });

  it('is judged on everything the person read, not only the last step', async () => {
    const { deps } = harness([
      {
        events: [
          start,
          text('Zjedz więcej białka.'),
          { type: 'tool_call', call: call('c1') },
          finish('tool_calls'),
        ],
      },
      answerStep('Wiosłowanie utrzymane.'),
    ]);
    expect(await ask(deps)).toMatchObject({ kind: 'withheld' });
  });

  it('withholds a reply that begins by reciting its own facts block, as a real model did', async () => {
    const reply =
      '<session_facts>{"asOf":"2026-10-02","historicalSessionCount":0}</session_facts> Nie ma jeszcze treningów.';
    const { deps } = harness([answerStep(reply)]);
    expect(await ask(deps)).toMatchObject({
      kind: 'withheld',
      violations: ['internal_markup'],
    });
  });

  it.each([
    'W tym tygodniu zrobiłeś 6 serii na plecy.',
    'W ostatniej sesji zrobiłeś po 14 powtórzeń z hantlem 14 kg.',
  ])('lets through a report of what was done, which a real model gave: %s', async (reply) => {
    const { deps } = harness([answerStep(reply)]);
    expect(await ask(deps)).toMatchObject({ kind: 'answered', text: reply });
  });

  it('lets an answer that quotes what was logged go through', async () => {
    const { deps } = harness([answerStep('Wiosłowanie: hantle po 10 kg, wynik utrzymany.')]);
    expect(await ask(deps)).toMatchObject({ kind: 'answered' });
  });
});

describe('when the call fails or is cancelled', () => {
  it('reports a failure with the text that had already been shown', async () => {
    const { deps } = harness([
      { events: [start, text('Zaczynam')], end: { kind: 'failed', failure: { kind: 'offline' } } },
    ]);
    expect(await ask(deps)).toMatchObject({
      kind: 'failed',
      failure: { kind: 'offline' },
      partialText: 'Zaczynam',
    });
  });

  it('reports an error that arrives inside the stream, with the text before it', async () => {
    const { deps } = harness([
      {
        events: [
          start,
          text('Zaczynam'),
          { type: 'error', error: { kind: 'upstream_error', retryable: true } },
        ],
        end: { kind: 'failed', failure: { kind: 'upstream_error', retryable: true } },
      },
    ]);
    expect(await ask(deps)).toMatchObject({
      kind: 'failed',
      failure: { kind: 'upstream_error', retryable: true },
      partialText: 'Zaczynam',
    });
  });

  it.each([
    [{ kind: 'budget_exhausted' }],
    [{ kind: 'rate_limited' }],
    [{ kind: 'contract_mismatch', expected: 1, got: 2 }],
  ] as const)('passes on what the Worker said: %j', async (failure) => {
    const { deps } = harness([{ events: [], end: { kind: 'failed', failure } }]);
    expect(await ask(deps)).toMatchObject({ kind: 'failed', failure });
  });

  it('reports a cancelled call as aborted, not as a failure', async () => {
    const { deps } = harness([
      { events: [start, text('Zaczynam')], end: { kind: 'failed', failure: { kind: 'aborted' } } },
    ]);
    expect(await ask(deps)).toMatchObject({ kind: 'aborted' });
  });

  it('stops between tool runs when cancelled, without running the rest', async () => {
    const controller = new AbortController();
    const ran: string[] = [];
    const { deps } = harness([toolStep(call('a'), call('b')), answerStep('x')], {
      executeTool: async (c) => {
        ran.push(c.id);
        controller.abort();
        return { callId: c.id, name: c.name, output: { error: 'failed' } };
      },
    });
    const outcome = await ask(deps, 'Pytanie?', { signal: controller.signal });
    expect(outcome).toMatchObject({ kind: 'aborted' });
    expect(ran).toEqual(['a']);
  });

  it('passes the cancellation signal to every request', async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const { deps } = harness([toolStep(call('a')), answerStep('ok')], {
      stream: async (_request, options) => {
        signals.push(options.signal);
        const step = signals.length === 1 ? toolStep(call('a')) : answerStep('ok');
        for (const e of step.events) options.onEvent(e);
        return { kind: 'complete' };
      },
    });
    await ask(deps, 'Pytanie?', { signal: controller.signal });
    expect(signals).toEqual([controller.signal, controller.signal]);
  });
});
