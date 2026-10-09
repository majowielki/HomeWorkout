import { act, renderHook } from '@testing-library/react-native';
import type { ChatFacts } from '@/ai/contract/chat';
import type { TurnDeps } from '@/ai/chat/runTurn';
import { pl } from '@/strings/pl';
import { useCoachChat } from '../useCoachChat';

const oldFacts: ChatFacts = {
  asOf: '2026-10-07',
  historicalSessionCount: 2,
  signals: ['SPARSE_HISTORY'],
  constraints: [],
};
const freshFacts: ChatFacts = {
  asOf: '2026-10-08',
  historicalSessionCount: 5,
  signals: [],
  constraints: [],
};
const depsFor = (): TurnDeps => ({
  stream: jest.fn(async (_request, options) => {
    options.onEvent({ type: 'text', delta: 'Dane sprawdzone.' });
    options.onEvent({ type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } });
    return { kind: 'complete' as const };
  }),
  executeTool: jest.fn(),
  newRequestId: () => 'request-fresh-1',
  now: () => 1,
});
it('adds a session-change card only after the checked tool result and completed answer', async () => {
  const deps = depsFor();
  let round = 0;
  deps.stream = jest.fn(async (_request, options) => {
    if (++round === 1) {
      options.onEvent({
        type: 'tool_call',
        call: {
          id: 'session-tool',
          name: 'proposeSessionChange',
          input: { assessmentId: 'a'.repeat(64), patchId: 'b'.repeat(64) },
        },
      });
      options.onEvent({
        type: 'finish',
        reason: 'tool_calls',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    } else {
      options.onEvent({ type: 'text', delta: 'Oto podgląd zmiany.' });
      options.onEvent({
        type: 'finish',
        reason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    }
    return { kind: 'complete' as const };
  });
  deps.executeTool = jest.fn(async () => ({
    callId: 'session-tool',
    name: 'proposeSessionChange' as const,
    output: {
      proposalId: 'session-card',
      kind: 'session_change',
      requiresAcceptance: true,
      verdict: 'ok',
      patchId: 'b'.repeat(64),
      acknowledge: [],
    },
  }));
  const card = {
    id: 'session-card',
    note: '',
    summary: { kind: 'session_change' as const, sentences: ['Pozostałe serie zostaną pominięte.'] },
  };
  const resolveProposal = jest.fn(() => card);
  const view = await renderHook(() => useCoachChat({ facts: oldFacts, deps, resolveProposal }));
  await act(() => view.result.current.send('Pomiń resztę ćwiczenia'));
  expect(resolveProposal).toHaveBeenCalledWith('session-card');
  expect(view.result.current.entries.at(-1)).toMatchObject({
    kind: 'proposal',
    proposal: card,
    status: 'pending',
  });
});

it('loads fresh facts for each question and gives the same date to the proposal environment and the log', async () => {
  const deps = depsFor();
  const loadFacts = jest.fn().mockResolvedValue(freshFacts);
  const onQuestion = jest.fn(),
    onTurn = jest.fn();
  const view = await renderHook(() =>
    useCoachChat({ facts: oldFacts, deps, loadFacts, onQuestion, onTurn }),
  );
  await act(async () => {
    await view.result.current.send('Co mam w planie?');
  });
  expect(deps.stream).toHaveBeenCalledWith(
    expect.objectContaining({ facts: freshFacts }),
    expect.anything(),
  );
  expect(onQuestion).toHaveBeenCalledWith('Co mam w planie?', freshFacts);
  expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'answered' }), freshFacts);
  await act(async () => {
    await view.result.current.send('A plan jutro?');
  });
  expect(loadFacts).toHaveBeenCalledTimes(2);
});
it('shows a local retry when loading fails, without calling the model', async () => {
  const deps = depsFor();
  const loadFacts = jest.fn().mockRejectedValue(new Error('db unavailable'));
  const view = await renderHook(() => useCoachChat({ facts: oldFacts, deps, loadFacts }));
  await act(async () => {
    await view.result.current.send('Plan?');
  });
  expect(deps.stream).not.toHaveBeenCalled();
  expect(view.result.current.busy).toBe(false);
  expect(view.result.current.entries.at(-1)).toMatchObject({
    kind: 'notice',
    text: pl.coach.loadError,
    canRetry: true,
  });
});
it.each(['stop', 'new-chat'])(
  'cancels before the model request while preparing facts: %s',
  async (kind) => {
    const deps = depsFor();
    let finish!: (facts: ChatFacts) => void;
    const loadFacts = () =>
      new Promise<ChatFacts>((resolve) => {
        finish = resolve;
      });
    const view = await renderHook(() => useCoachChat({ facts: oldFacts, deps, loadFacts }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = view.result.current.send('Plan?');
    });
    await act(async () => {
      if (kind === 'stop') view.result.current.stop();
      else view.result.current.newChat();
      finish(freshFacts);
      await pending;
    });
    expect(deps.stream).not.toHaveBeenCalled();
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.entries.some((e) => e.kind === 'assistant')).toBe(false);
  },
);
