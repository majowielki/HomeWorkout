import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { StreamEnd } from '@/ai/client/chatClient';
import type { TurnDeps } from '@/ai/chat/runTurn';
import type { ChatEvent, ChatFacts, ChatRequest } from '@/ai/contract/chat';
import { pl } from '@/strings/pl';

import { ChatView } from '../ChatView';
import { useCoachChat } from '../useCoachChat';

const facts: ChatFacts = {
  asOf: '2026-10-01',
  historicalSessionCount: 12,
  signals: [],
  constraints: [],
};
const c = pl.coach.chat;

const start: ChatEvent = { type: 'start', requestId: 'r', promptVersion: 'chat/v1', model: 'm' };
const text = (delta: string): ChatEvent => ({ type: 'text', delta });
const finish: ChatEvent = {
  type: 'finish',
  reason: 'stop',
  usage: { inputTokens: 5, outputTokens: 5 },
};

type Step = { events: ChatEvent[]; end?: StreamEnd };

/**
 * A Worker the test controls: each step is scripted, and a step marked
 * `hold` waits until released so the screen can be looked at mid-stream.
 */
function server(steps: (Step & { hold?: boolean })[]) {
  const requests: ChatRequest[] = [];
  let release: (() => void) | null = null;
  const stream: TurnDeps['stream'] = async (request, options) => {
    requests.push(structuredClone(request));
    const step = steps[Math.min(requests.length - 1, steps.length - 1)]!;
    for (const event of step.events) options.onEvent(event);
    if (step.hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
        options.signal?.addEventListener('abort', () => resolve());
      });
      if (options.signal?.aborted) return { kind: 'failed', failure: { kind: 'aborted' } };
    }
    return step.end ?? { kind: 'complete' };
  };
  return { stream, requests, release: () => release?.() };
}

function Harness({
  deps,
  onTurn,
}: {
  deps: TurnDeps;
  onTurn?: Parameters<typeof useCoachChat>[0]['onTurn'];
}) {
  const chat = useCoachChat({ facts, deps, onTurn });
  return (
    <ChatView
      entries={chat.entries}
      busy={chat.busy}
      onSend={(t) => void chat.send(t)}
      onStop={chat.stop}
      onRetry={chat.retry}
      onNewChat={chat.newChat}
    />
  );
}

const depsFor = (stream: TurnDeps['stream'], executed: string[] = []): TurnDeps => ({
  stream,
  executeTool: async (call) => {
    executed.push(call.name);
    return { callId: call.id, name: call.name, output: { error: 'failed' } };
  },
  newRequestId: (() => {
    let n = 0;
    return () => `req-${(n += 1)}`.padEnd(12, '0');
  })(),
  now: () => 0,
});

/** Types a question and presses Send, each in its own render pass, as a person would. */
async function ask(question: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(c.placeholder), question);
  });
  await act(async () => {
    fireEvent.press(screen.getByText(c.send));
  });
}

describe('the conversation screen', () => {
  it('invites a first question, and sends nothing until one is written', async () => {
    const { stream, requests } = server([{ events: [start, text('x'), finish] }]);
    await render(<Harness deps={depsFor(stream)} />);
    expect(screen.getByText(c.intro)).toBeTruthy();
    expect(screen.getByText(c.empty)).toBeTruthy();
    fireEvent.press(screen.getByText(c.send));
    expect(requests).toHaveLength(0);
  });

  it('shows the question, then the answer as it arrives, and keeps both', async () => {
    const srv = server([{ events: [start, text('Trzy '), text('sesje.'), finish] }]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Ile mam sesji?');

    expect(screen.getByText('Ile mam sesji?')).toBeTruthy();
    expect(await screen.findByText('Trzy sesje.')).toBeTruthy();
    expect(srv.requests[0]!.messages).toEqual([{ role: 'user', text: 'Ile mam sesji?' }]);
    expect(screen.getByText(c.disclaimer)).toBeTruthy();
    // The composer is cleared and ready again.
    expect(screen.getByLabelText(c.placeholder).props.value).toBe('');
    expect(screen.getByText(c.send)).toBeTruthy();
  });

  it('says what it is looking up while a tool runs, then answers', async () => {
    const executed: string[] = [];
    const srv = server([
      {
        events: [
          start,
          {
            type: 'tool_call',
            call: { id: 'c1', name: 'getWeeklyVolume', input: { weeksAgo: 0 } },
          },
          { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      },
      { events: [start, text('Sześć serii.'), finish] },
    ]);
    await render(<Harness deps={depsFor(srv.stream, executed)} />);
    await ask('Ile serii na plecy?');
    expect(await screen.findByText('Sześć serii.')).toBeTruthy();
    expect(executed).toEqual(['getWeeklyVolume']);
    expect(srv.requests).toHaveLength(2);
  });

  it('shows a stop button while the answer is streaming, and keeps the words when stopped', async () => {
    const srv = server([{ events: [start, text('Zaczynam odpowiedź')], hold: true }]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Pytanie?');

    expect(await screen.findByText('Zaczynam odpowiedź')).toBeTruthy();
    expect(screen.queryByText(c.send)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText(c.stop));
    });
    expect(await screen.findByText(c.stopped)).toBeTruthy();
    expect(screen.getByText('Zaczynam odpowiedź')).toBeTruthy();
    expect(screen.getByText(c.send)).toBeTruthy();
  });

  it('answers a complaint with the app’s own sentence and sends nothing', async () => {
    const srv = server([{ events: [start, text('nope'), finish] }]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Strzyknęło mnie w kolanie');
    expect(await screen.findByText(c.blocked.medical)).toBeTruthy();
    expect(srv.requests).toHaveLength(0);
  });

  it('does not show a reply that broke a rule, only that it did', async () => {
    const srv = server([{ events: [start, text('Zjedz więcej białka.'), finish] }]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Jak idzie wiosłowanie?');
    expect(await screen.findByText(c.withheld)).toBeTruthy();
    expect(screen.queryByText(/białka/)).toBeNull();
  });

  it('says why a call failed and asks the same question again on retry', async () => {
    const srv = server([
      { events: [start], end: { kind: 'failed', failure: { kind: 'offline' } } },
      { events: [start, text('Teraz działa.'), finish] },
    ]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Jak idzie wiosłowanie?');
    expect(await screen.findByText(pl.coach.ai.errors.offline)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText(c.retry));
    });
    expect(await screen.findByText('Teraz działa.')).toBeTruthy();
    expect(screen.queryByText(pl.coach.ai.errors.offline)).toBeNull();
    // The failed question is not on screen twice.
    expect(screen.getAllByText('Jak idzie wiosłowanie?')).toHaveLength(1);
    expect(srv.requests.map((r) => r.messages.at(-1))).toEqual([
      { role: 'user', text: 'Jak idzie wiosłowanie?' },
      { role: 'user', text: 'Jak idzie wiosłowanie?' },
    ]);
  });

  it('offers no retry for a failure that retrying cannot fix', async () => {
    const srv = server([
      { events: [], end: { kind: 'failed', failure: { kind: 'budget_exhausted' } } },
    ]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Pytanie?');
    expect(await screen.findByText(pl.coach.ai.errors.budget)).toBeTruthy();
    expect(screen.queryByText(c.retry)).toBeNull();
  });

  it('remembers the earlier question when asked another, and forgets it on a new conversation', async () => {
    const srv = server([
      { events: [start, text('Pierwsza odpowiedź.'), finish] },
      { events: [start, text('Druga odpowiedź.'), finish] },
      { events: [start, text('Trzecia odpowiedź.'), finish] },
    ]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Pierwsze?');
    await screen.findByText('Pierwsza odpowiedź.');
    await ask('Drugie?');
    await screen.findByText('Druga odpowiedź.');
    expect(srv.requests[1]!.messages).toEqual([
      { role: 'user', text: 'Pierwsze?' },
      { role: 'assistant', text: 'Pierwsza odpowiedź.', toolCalls: [] },
      { role: 'user', text: 'Drugie?' },
    ]);

    await act(async () => {
      fireEvent.press(screen.getByText(c.newChat));
    });
    expect(screen.getByText(c.intro)).toBeTruthy();
    await ask('Trzecie?');
    await screen.findByText('Trzecia odpowiedź.');
    expect(srv.requests[2]!.messages).toEqual([{ role: 'user', text: 'Trzecie?' }]);
  });

  it('keeps each finished turn through the callback, and survives it failing', async () => {
    const onTurn = jest.fn().mockRejectedValue(new Error('disk full'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const srv = server([{ events: [start, text('Odpowiedź.'), finish] }]);
    await render(<Harness deps={depsFor(srv.stream)} onTurn={onTurn} />);
    await ask('Pytanie?');
    expect(await screen.findByText('Odpowiedź.')).toBeTruthy();
    expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'answered' }), facts);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns about the length of a long question', async () => {
    await render(<Harness deps={depsFor(server([{ events: [] }]).stream)} />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(c.placeholder), 'a'.repeat(450));
    });
    expect(screen.getByText('450/500')).toBeTruthy();
  });

  it('refuses a second question while the first is still being answered', async () => {
    const srv = server([{ events: [start, text('Czekam')], hold: true }]);
    await render(<Harness deps={depsFor(srv.stream)} />);
    await ask('Pierwsze?');
    await screen.findByText('Czekam');
    // No send button while busy: only stop.
    expect(screen.queryByText(c.send)).toBeNull();
    expect(srv.requests).toHaveLength(1);
    await act(async () => {
      srv.release();
    });
  });
});
