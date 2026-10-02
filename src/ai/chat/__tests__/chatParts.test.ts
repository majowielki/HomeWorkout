import { CHAT_LIMITS, chatFactsSchema, conversationProblem } from '../../contract/chat';
import { buildCoachContext } from '../../context/buildCoachContext';
import { scenario } from '../../testing/synthetic';
import { factsFromContext } from '../facts';
import { gateUserText } from '../gate';
import { historyMessages, rememberTurn } from '../history';

describe('gateUserText', () => {
  it('lets an ordinary question through, cleaned', () => {
    expect(gateUserText('  Jak idzie   wiosłowanie?  ')).toEqual({
      kind: 'pass',
      text: 'Jak idzie wiosłowanie?',
    });
  });

  it('takes out invisible characters before it looks, so they cannot hide a word', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const hidden = `strzy${zeroWidth}ka mnie w kolanie`;
    expect(gateUserText(hidden)).toEqual({ kind: 'medical' });
    expect(gateUserText(`${zeroWidth}${zeroWidth}`)).toEqual({ kind: 'empty' });
  });

  it('says there is nothing to send for whitespace', () => {
    expect(gateUserText('')).toEqual({ kind: 'empty' });
    expect(gateUserText(' \n\t ')).toEqual({ kind: 'empty' });
  });

  it('measures the length after cleaning, and allows exactly the limit', () => {
    expect(gateUserText('a'.repeat(CHAT_LIMITS.userChars)).kind).toBe('pass');
    expect(gateUserText('a'.repeat(CHAT_LIMITS.userChars + 1))).toEqual({ kind: 'too_long' });
    const padded = `a${' '.repeat(50)}b`;
    expect(gateUserText(padded)).toEqual({ kind: 'pass', text: 'a b' });
  });

  it.each([
    'Kłuje mnie w kolanie',
    'Coś mnie boli od tygodnia',
    'Byłem u fizjoterapeuty',
    'Strzyknęło w barku przy wyciskaniu',
  ])('stops a message that reads as a complaint: %s', (text) => {
    expect(gateUserText(text)).toEqual({ kind: 'medical' });
  });

  it.each([
    ['Ile białka mam jeść?', 'diet'],
    ['Czy kalorie się liczą przy treningu?', 'diet'],
    ['Kiedy wziąć Mounjaro?', 'medication'],
  ] as const)('stops a question about diet or medication: %s', (text, topic) => {
    expect(gateUserText(text)).toEqual({ kind: 'out_of_scope', topic });
  });

  it('puts the complaint first when a message is both', () => {
    expect(gateUserText('Boli mnie kolano, a ile białka mam jeść?')).toEqual({ kind: 'medical' });
  });

  it.each([
    'Mam zakwasy w łydkach po wczorajszym',
    'Jak mi idzie z wiosłowaniem?',
    'Czemu waga stoi w miejscu?',
    'Ile sesji zrobiłem w tym miesiącu?',
  ])('lets through what the coach is for: %s', (text) => {
    expect(gateUserText(text).kind).toBe('pass');
  });
});

describe('the conversation memory', () => {
  it('appends a finished question and its answer', () => {
    expect(rememberTurn([], 'Pytanie?', 'Odpowiedź.')).toEqual([
      { user: 'Pytanie?', assistant: 'Odpowiedź.' },
    ]);
  });

  it('keeps the newest questions and no more than the limit', () => {
    let history = [] as ReturnType<typeof rememberTurn>;
    for (let i = 0; i < CHAT_LIMITS.rememberedTurns + 2; i += 1) {
      history = rememberTurn(history, `q${i}`, `a${i}`);
    }
    expect(history.map((h) => h.user)).toEqual(['q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
  });

  it('does not let one long answer push the conversation past what the Worker accepts', () => {
    const [exchange] = rememberTurn([], 'q', 'x'.repeat(CHAT_LIMITS.replyChars + 100));
    expect(exchange!.assistant).toHaveLength(CHAT_LIMITS.replyChars);
  });

  it('turns into messages the Worker will accept, at any length', () => {
    let history = [] as ReturnType<typeof rememberTurn>;
    for (let i = 0; i < 20; i += 1) history = rememberTurn(history, `q${i}`, `a${i}`);
    const messages = [...historyMessages(history), { role: 'user' as const, text: 'Nowe pytanie' }];
    expect(conversationProblem(messages)).toBeNull();
    expect(messages.length).toBeLessThanOrEqual(CHAT_LIMITS.messages);
  });

  it('is nothing for no history', () => {
    expect(historyMessages([])).toEqual([]);
  });
});

describe('factsFromContext', () => {
  it('takes the date, the session count and the codes from the weekly context', () => {
    const { context } = buildCoachContext(scenario({ sessions: 2, olderSessions: 0 }));
    const facts = factsFromContext(context);
    expect(facts).toEqual({
      asOf: context.asOf,
      historicalSessionCount: 2,
      signals: ['SPARSE_HISTORY'],
      constraints: context.constraints,
    });
    expect(chatFactsSchema.safeParse(facts).success).toBe(true);
  });

  it('carries no data about the person beyond those four things', () => {
    const { context } = buildCoachContext(
      scenario({ notes: [{ daysAgo: 1, source: 'daily', text: 'Dziś ciężki dzień w pracy' }] }),
    );
    const text = JSON.stringify(factsFromContext(context));
    expect(Object.keys(factsFromContext(context)).sort()).toEqual([
      'asOf',
      'constraints',
      'historicalSessionCount',
      'signals',
    ]);
    expect(text).not.toContain('ciężki');
  });
});
