import {
  CHAT_TOOLS,
  TOOL_ERRORS,
  TOOL_LIMITS,
  TOOL_NAMES,
  toolErrorSchema,
  toolResultSchemaFor,
  type ToolName,
} from '../chatTools';
import {
  CHAT_LIMITS,
  chatEventSchema,
  chatFactsSchema,
  chatMessageSchema,
  chatRequestSchema,
  conversationProblem,
  toolRoundsUsed,
  type ChatMessage,
  type ToolCall,
  type ToolResult,
} from '../chat';
import { CONTRACT_VERSION } from '../versions';

const OUTPUTS: Record<ToolName, ToolResult['output']> = {
  getRecentSessions: {
    totalCompleted: 9,
    sessions: [
      {
        date: '2026-09-30',
        durationMin: 41,
        sessionRpe: 7,
        workingSets: 12,
        exercises: [{ id: 'row', name: 'Wiosłowanie', sets: 3 }],
      },
    ],
  },
  getExerciseHistory: {
    exercise: { id: 'row', name: 'Wiosłowanie' },
    weeks: 4,
    sessionCount: 2,
    verdict: 'maintained',
    sessions: [
      {
        date: '2026-09-30',
        sets: [{ reps: 10, timeSec: null, rir: 2, load: { kind: 'bodyweight' } }],
      },
    ],
  },
  getWeeklyVolume: {
    endDate: '2026-10-01',
    muscles: [{ muscle: 'back', sets: 6, status: 'in_range' }],
  },
  getBodyTrend: {
    days: 28,
    weight: {
      latestKg: 94.2,
      latestDate: '2026-10-01',
      avg7Kg: 94.5,
      trendKgPerWeek: -0.5,
      avg7ChangeKg: -1.1,
      entries: 20,
    },
    waist: null,
  },
  findExercises: {
    total: 1,
    exercises: [{ id: 'row', name: 'Wiosłowanie', primaryMuscles: ['back', 'lats'] }],
  },
};

const INPUTS: Record<ToolName, ToolCall['input']> = {
  getRecentSessions: { count: 3 },
  getExerciseHistory: { exerciseId: 'row', weeks: 4 },
  getWeeklyVolume: { weeksAgo: 0 },
  getBodyTrend: { days: 28 },
  findExercises: { query: 'wios' },
};

const user = (text = 'Jak idzie wiosłowanie?'): ChatMessage => ({ role: 'user', text });
const call = (id: string, name: ToolName = 'getWeeklyVolume'): ToolCall => ({
  id,
  name,
  input: INPUTS[name],
});
const calling = (...calls: ToolCall[]): ChatMessage => ({
  role: 'assistant',
  text: '',
  toolCalls: calls,
});
const resultOf = (c: ToolCall): ToolResult => ({
  callId: c.id,
  name: c.name,
  output: OUTPUTS[c.name],
});
const toolMessage = (...items: ToolResult[]): ChatMessage => ({ role: 'tool', results: items });
const results = (...calls: ToolCall[]): ChatMessage => toolMessage(...calls.map(resultOf));
const reply = (text = 'Utrzymane.'): ChatMessage => ({ role: 'assistant', text, toolCalls: [] });

describe('tool definitions', () => {
  it('define exactly the tools named in TOOL_NAMES', () => {
    expect(Object.keys(CHAT_TOOLS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(TOOL_NAMES)('%s accepts its example input and output', (name) => {
    expect(CHAT_TOOLS[name].input.safeParse(INPUTS[name]).success).toBe(true);
    expect(CHAT_TOOLS[name].output.safeParse(OUTPUTS[name]).success).toBe(true);
  });

  it.each(TOOL_NAMES)('%s rejects a field nobody listed, in input and in output', (name) => {
    expect(CHAT_TOOLS[name].input.safeParse({ ...INPUTS[name], extra: 1 }).success).toBe(false);
    const output = { ...(OUTPUTS[name] as object), diagnosis: 'x' };
    expect(CHAT_TOOLS[name].output.safeParse(output).success).toBe(false);
  });

  it('rejects an exercise entry that carries a field nobody listed', () => {
    const output = {
      total: 1,
      exercises: [{ id: 'row', name: 'W', primaryMuscles: ['back'], note: 'kolano' }],
    };
    expect(CHAT_TOOLS.findExercises.output.safeParse(output).success).toBe(false);
  });

  it('keeps inputs inside the documented ranges', () => {
    const { recentSessions, historyWeeks, weeksAgo, bodyDays } = TOOL_LIMITS;
    expect(
      CHAT_TOOLS.getRecentSessions.input.safeParse({ count: recentSessions.max + 1 }).success,
    ).toBe(false);
    expect(CHAT_TOOLS.getRecentSessions.input.safeParse({ count: 0 }).success).toBe(false);
    expect(
      CHAT_TOOLS.getExerciseHistory.input.safeParse({
        exerciseId: 'x',
        weeks: historyWeeks.max + 1,
      }).success,
    ).toBe(false);
    expect(CHAT_TOOLS.getWeeklyVolume.input.safeParse({ weeksAgo: weeksAgo.max + 1 }).success).toBe(
      false,
    );
    expect(CHAT_TOOLS.getWeeklyVolume.input.safeParse({ weeksAgo: -1 }).success).toBe(false);
    expect(CHAT_TOOLS.getBodyTrend.input.safeParse({ days: bodyDays.min - 1 }).success).toBe(false);
    expect(CHAT_TOOLS.findExercises.input.safeParse({ muscle: 'tail' }).success).toBe(false);
    expect(
      CHAT_TOOLS.findExercises.input.safeParse({ query: 'a'.repeat(TOOL_LIMITS.queryChars + 1) })
        .success,
    ).toBe(false);
  });

  it('describe every tool to the model', () => {
    for (const name of TOOL_NAMES) expect(CHAT_TOOLS[name].description.length).toBeGreaterThan(40);
  });
});

describe('toolResultSchemaFor', () => {
  it('accepts the tool output and any tool error, and nothing else', () => {
    const schema = toolResultSchemaFor('getWeeklyVolume');
    expect(schema.safeParse(OUTPUTS.getWeeklyVolume).success).toBe(true);
    for (const error of TOOL_ERRORS) expect(schema.safeParse({ error }).success).toBe(true);
    expect(schema.safeParse(OUTPUTS.getBodyTrend).success).toBe(false);
    expect(toolErrorSchema.safeParse({ error: 'stack trace here' }).success).toBe(false);
  });
});

describe('chatMessageSchema', () => {
  it('accepts the three kinds of message', () => {
    expect(chatMessageSchema.safeParse(user()).success).toBe(true);
    expect(chatMessageSchema.safeParse(calling(call('c1'))).success).toBe(true);
    expect(chatMessageSchema.safeParse(results(call('c1'))).success).toBe(true);
  });

  it('rejects a field nobody listed and an unknown role', () => {
    expect(chatMessageSchema.safeParse({ ...user(), extra: 1 }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ role: 'system', text: 'x' }).success).toBe(false);
  });

  it('caps the length of a question and the number of calls in a round', () => {
    expect(chatMessageSchema.safeParse(user('a'.repeat(CHAT_LIMITS.userChars))).success).toBe(true);
    expect(chatMessageSchema.safeParse(user('a'.repeat(CHAT_LIMITS.userChars + 1))).success).toBe(
      false,
    );
    expect(chatMessageSchema.safeParse(user('')).success).toBe(false);
    const many = Array.from({ length: CHAT_LIMITS.callsPerRound + 1 }, (_, i) => call(`c${i}`));
    expect(chatMessageSchema.safeParse(calling(...many)).success).toBe(false);
  });

  it('rejects a tool call for a tool that does not exist', () => {
    const bad = {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'c1', name: 'deleteAll', input: {} }],
    };
    expect(chatMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a tool result that is not what that tool returns', () => {
    const wrong = {
      role: 'tool',
      results: [{ callId: 'c1', name: 'getBodyTrend', output: OUTPUTS.getWeeklyVolume }],
    };
    expect(chatMessageSchema.safeParse(wrong).success).toBe(false);
  });

  it('accepts a tool error as a result', () => {
    const failed = {
      role: 'tool',
      results: [{ callId: 'c1', name: 'getBodyTrend', output: { error: 'failed' } }],
    };
    expect(chatMessageSchema.safeParse(failed).success).toBe(true);
  });
});

describe('conversationProblem', () => {
  const c1 = call('c1');
  const c2 = call('c2', 'getBodyTrend');

  it.each<[string, ChatMessage[]]>([
    ['a first question', [user()]],
    ['a question after a finished exchange', [user(), reply(), user('A teraz?')]],
    ['a round answered, waiting for the model', [user(), calling(c1), results(c1)]],
    [
      'two parallel calls answered in a different order',
      [user(), calling(c1, c2), toolMessage(resultOf(c2), resultOf(c1))],
    ],
    [
      'a reply after tool rounds, then a new question',
      [user(), calling(c1), results(c1), reply(), user('Jeszcze raz')],
    ],
  ])('accepts %s', (_name, messages) => {
    expect(conversationProblem(messages)).toBeNull();
  });

  it.each<[string, ChatMessage[], string]>([
    ['nothing', [], 'empty'],
    ['a reply before any question', [reply()], 'order'],
    ['two questions in a row', [user(), user()], 'order'],
    ['tool results with no calls', [user(), results(call('c1'))], 'order'],
    ['calls the next message does not answer', [user(), calling(call('c1'))], 'unanswered_calls'],
    [
      'a question after unanswered calls',
      [user(), calling(call('c1')), user()],
      'unanswered_calls',
    ],
    [
      'a question straight after results',
      [user(), calling(call('c1')), results(call('c1')), user()],
      'order',
    ],
    [
      'results for another call',
      [user(), calling(call('c1')), results(call('zzz'))],
      'results_do_not_match_calls',
    ],
    [
      'results naming another tool',
      [
        user(),
        calling(call('c1', 'getWeeklyVolume')),
        toolMessage({ callId: 'c1', name: 'getBodyTrend', output: { error: 'failed' } }),
      ],
      'results_do_not_match_calls',
    ],
    [
      'results for only some of the calls',
      [user(), calling(call('c1'), call('c2', 'getBodyTrend')), results(call('c1'))],
      'results_do_not_match_calls',
    ],
    [
      'the same result twice for two calls',
      [
        user(),
        calling(call('c1'), call('c2')),
        toolMessage(resultOf(call('c1')), resultOf(call('c1'))),
      ],
      'results_do_not_match_calls',
    ],
    [
      'a call id used twice',
      [user(), calling(call('c1')), results(call('c1')), calling(call('c1')), results(call('c1'))],
      'duplicate_call_id',
    ],
    ['an empty reply', [user(), reply('   ')], 'empty_reply'],
    ['a conversation that ends with an answer', [user(), reply()], 'ends_with_reply'],
  ])('rejects %s', (_name, messages, problem) => {
    expect(conversationProblem(messages)).toBe(problem);
  });

  it('allows exactly the permitted number of tool rounds, and not one more', () => {
    const rounds = (n: number): ChatMessage[] => [
      user(),
      ...Array.from({ length: n }, (_, i) => [
        calling(call(`r${i}`)),
        results(call(`r${i}`)),
      ]).flat(),
    ];
    expect(conversationProblem(rounds(CHAT_LIMITS.toolRounds))).toBeNull();
    expect(conversationProblem([...rounds(CHAT_LIMITS.toolRounds), calling(call('extra'))])).toBe(
      'too_many_rounds',
    );
  });

  it('counts rounds per question, not per conversation', () => {
    const turn = (n: number): ChatMessage[] => [
      user(),
      ...Array.from({ length: CHAT_LIMITS.toolRounds }, (_, i) => [
        calling(call(`t${n}-${i}`)),
        results(call(`t${n}-${i}`)),
      ]).flat(),
      reply(),
    ];
    expect(conversationProblem([...turn(1), ...turn(2), user('Dalej')])).toBeNull();
  });
});

describe('toolRoundsUsed', () => {
  it('counts the rounds of the latest question only', () => {
    const c = (id: string) => call(id);
    expect(toolRoundsUsed([user()])).toBe(0);
    expect(toolRoundsUsed([user(), calling(c('a')), results(c('a'))])).toBe(1);
    expect(
      toolRoundsUsed([
        user(),
        calling(c('a')),
        results(c('a')),
        calling(c('b')),
        results(c('b')),
        reply(),
        user(),
        calling(c('d')),
        results(c('d')),
      ]),
    ).toBe(1);
  });
});

describe('chatRequestSchema', () => {
  const facts = {
    asOf: '2026-10-01',
    historicalSessionCount: 12,
    signals: [],
    constraints: ['knee_no_frontal_plane_under_load'],
  };
  const request = (overrides: Record<string, unknown> = {}) => ({
    contractVersion: CONTRACT_VERSION,
    requestId: 'req-0001-abcdef',
    facts,
    messages: [user()],
    ...overrides,
  });

  it('accepts a first question', () => {
    expect(chatRequestSchema.safeParse(request()).success).toBe(true);
  });

  it('rejects another contract version', () => {
    expect(
      chatRequestSchema.safeParse(request({ contractVersion: CONTRACT_VERSION + 1 })).success,
    ).toBe(false);
  });

  it('rejects facts with a field nobody listed or a code it does not know', () => {
    expect(chatFactsSchema.safeParse({ ...facts, name: 'x' }).success).toBe(false);
    expect(chatFactsSchema.safeParse({ ...facts, signals: ['FATIGUE_HIGH'] }).success).toBe(false);
  });

  it('rejects a malformed conversation with the reason in the issue', () => {
    const parsed = chatRequestSchema.safeParse(request({ messages: [user(), reply()] }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('ends_with_reply');
  });

  it('rejects more messages than the cap', () => {
    const many = Array.from({ length: CHAT_LIMITS.messages + 1 }, () => user());
    expect(chatRequestSchema.safeParse(request({ messages: many })).success).toBe(false);
  });
});

describe('chatEventSchema', () => {
  it.each([
    { type: 'start', requestId: 'r', promptVersion: 'chat/v1', model: 'm' },
    { type: 'text', delta: 'Cześć' },
    { type: 'tool_call', call: call('c1') },
    { type: 'finish', reason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 2 } },
    { type: 'error', error: { kind: 'upstream_error', retryable: true } },
  ])('accepts a %j event', (event) => {
    expect(chatEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects an unknown event, an unknown field and an unknown finish reason', () => {
    expect(chatEventSchema.safeParse({ type: 'thinking', text: 'x' }).success).toBe(false);
    expect(chatEventSchema.safeParse({ type: 'text', delta: 'x', extra: 1 }).success).toBe(false);
    expect(
      chatEventSchema.safeParse({
        type: 'finish',
        reason: 'boom',
        usage: { inputTokens: 0, outputTokens: 0 },
      }).success,
    ).toBe(false);
  });
});
