import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { CallOutcome, CoachClient, SummaryResult } from '@/ai/client/coachClient';
import { buildCoachContext } from '@/ai/context/buildCoachContext';
import { scenario } from '@/ai/testing/synthetic';

import { AiSummaryCard } from '../AiSummaryCard';

const context = buildCoachContext(scenario()).context;

const OK: SummaryResult = {
  kind: 'ok',
  requestId: 'req-0001-abcdef',
  promptVersion: 'weekly-summary/v1',
  model: 'some-model',
  usage: { inputTokens: 1000, outputTokens: 200 },
  validationOutcome: 'ok',
  summary: {
    headline: 'Dziewięć sesji w cztery tygodnie.',
    highlights: ['Siła utrzymana przy spadającej wadze.', 'Talia spadła o 1,5 cm.'],
    flags: [{ code: 'LAYOFF_SHORT', comment: 'Krótka przerwa po ostatniej sesji.' }],
    questions: ['Jak spało się w tym tygodniu?'],
  },
};

const outcome = (result: SummaryResult): CallOutcome => ({
  requestId: 'req-0001-abcdef',
  result,
  attempts: 1,
  latencyMs: 3200,
});

/** A client whose answer the test controls, and that notices being told to stop. */
function pendingClient() {
  let resolve!: (value: CallOutcome) => void;
  let signal: AbortSignal | undefined;
  const client = {
    weeklySummary: jest.fn((_ctx, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<CallOutcome>((r) => {
        resolve = r;
        options?.signal?.addEventListener('abort', () => r(outcome({ kind: 'aborted' })));
      });
    }),
  } as unknown as CoachClient;
  return { client, answer: (r: SummaryResult) => resolve(outcome(r)), signal: () => signal };
}

const answeringWith = (result: SummaryResult) =>
  ({ weeklySummary: jest.fn(async () => outcome(result)) }) as unknown as CoachClient;

describe('AiSummaryCard', () => {
  describe('when it cannot run', () => {
    it('says the AI is off and offers nothing to press when the switch is off', async () => {
      const client = answeringWith(OK);
      await render(
        <AiSummaryCard context={context} enabled={false} client={client} onFinished={jest.fn()} />,
      );
      expect(screen.getByText(/Funkcje AI są wyłączone/)).toBeTruthy();
      expect(screen.queryByText('Poproś o podsumowanie')).toBeNull();
      expect(client.weeklySummary).not.toHaveBeenCalled();
    });

    it('says the server is not configured when the build has none', async () => {
      await render(
        <AiSummaryCard context={context} enabled client={null} onFinished={jest.fn()} />,
      );
      expect(screen.getByText(/Serwer AI nie jest skonfigurowany/)).toBeTruthy();
      expect(screen.queryByText('Poproś o podsumowanie')).toBeNull();
    });
  });

  describe('a good answer', () => {
    it('shows the summary, the flag by name and the fine print', async () => {
      const onFinished = jest.fn();
      const client = answeringWith(OK);
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={onFinished} />,
      );

      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));

      expect(await screen.findByText('Dziewięć sesji w cztery tygodnie.')).toBeTruthy();
      expect(screen.getByText('• Siła utrzymana przy spadającej wadze.')).toBeTruthy();
      expect(screen.getByText('Krótka przerwa: ')).toBeTruthy(); // the code is shown as a name, never as itself
      expect(screen.queryByText(/LAYOFF_SHORT/)).toBeNull();
      expect(screen.getByText('• Jak spało się w tym tygodniu?')).toBeTruthy();
      expect(screen.getByText(/nie plan ani porada/)).toBeTruthy();
      expect(screen.getByText(/some-model · 1200 tokenów · 3,2 s/)).toBeTruthy();
      expect(screen.queryByText(/nie przeszła kontroli/)).toBeNull();
    });

    it('sends the context it was given, and keeps the exchange', async () => {
      const onFinished = jest.fn();
      const client = answeringWith(OK);
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={onFinished} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await screen.findByText('Dziewięć sesji w cztery tygodnie.');

      expect(client.weeklySummary).toHaveBeenCalledWith(context, {
        signal: expect.any(AbortSignal),
      });
      expect(onFinished).toHaveBeenCalledWith(
        context,
        expect.objectContaining({ requestId: 'req-0001-abcdef' }),
      );
    });

    it('admits when the first answer had to be corrected', async () => {
      const repaired: SummaryResult = {
        ...OK,
        validationOutcome: 'ok_after_repair',
      } as SummaryResult;
      await render(
        <AiSummaryCard
          context={context}
          enabled
          client={answeringWith(repaired)}
          onFinished={jest.fn()}
        />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      expect(await screen.findByText(/nie przeszła kontroli/)).toBeTruthy();
    });

    it('leaves out sections the model left empty', async () => {
      const bare: SummaryResult = {
        ...OK,
        summary: { headline: 'Krótko.', highlights: ['Jedno.'], flags: [], questions: [] },
      } as SummaryResult;
      await render(
        <AiSummaryCard
          context={context}
          enabled
          client={answeringWith(bare)}
          onFinished={jest.fn()}
        />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await screen.findByText('Krótko.');
      expect(screen.queryByText('Na co zwrócić uwagę')).toBeNull();
      expect(screen.queryByText('Pytania na następny raz')).toBeNull();
    });

    it('can ask again', async () => {
      const client = answeringWith(OK);
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await fireEvent.press(await screen.findByText('Poproś ponownie'));
      await screen.findByText('Dziewięć sesji w cztery tygodnie.');
      expect(client.weeklySummary).toHaveBeenCalledTimes(2);
    });

    it('does not let a failure to keep the exchange spoil the summary', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const onFinished = jest.fn(async () => {
        throw new Error('disk full');
      });
      await render(
        <AiSummaryCard
          context={context}
          enabled
          client={answeringWith(OK)}
          onFinished={onFinished}
        />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      expect(await screen.findByText('Dziewięć sesji w cztery tygodnie.')).toBeTruthy();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('a failure', () => {
    it('with no network, says so and keeps the retry', async () => {
      const client = answeringWith({ kind: 'offline' });
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));

      expect(await screen.findByText(/AI niedostępne: brak połączenia/)).toBeTruthy();
      expect(screen.getByText('Spróbuj ponownie')).toBeTruthy();
    });

    it('retries on request', async () => {
      const client = answeringWith({ kind: 'offline' });
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await fireEvent.press(await screen.findByText('Spróbuj ponownie'));
      await screen.findByText(/AI niedostępne/);
      expect(client.weeklySummary).toHaveBeenCalledTimes(2);
    });

    it('with a spent budget, says so and offers no retry', async () => {
      const client = answeringWith({ kind: 'budget_exhausted' });
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));

      expect(await screen.findByText(/Limit na dziś wyczerpany/)).toBeTruthy();
      expect(screen.queryByText('Spróbuj ponownie')).toBeNull();
    });

    it('still keeps the exchange, so the diagnostics show what happened', async () => {
      const onFinished = jest.fn();
      const client = answeringWith({ kind: 'unauthorized' });
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={onFinished} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await screen.findByText(/odrzucił klucz/);
      expect(onFinished).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelling', () => {
    it('shows progress, and Cancel stops the call and returns to the start without an error', async () => {
      const { client, signal } = pendingClient();
      const onFinished = jest.fn();
      await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={onFinished} />,
      );

      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      expect(screen.getByText('Model pisze podsumowanie…')).toBeTruthy();

      await fireEvent.press(screen.getByText('Anuluj'));
      expect(signal()!.aborted).toBe(true);
      expect(await screen.findByText('Poproś o podsumowanie')).toBeTruthy();
      expect(screen.queryByText(/niedostępne|nie udało/i)).toBeNull();
      expect(onFinished).not.toHaveBeenCalled();
    });

    it('leaving the screen aborts a call in flight', async () => {
      const { client, signal } = pendingClient();
      const view = await render(
        <AiSummaryCard context={context} enabled client={client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      expect(signal()!.aborted).toBe(false);

      await view.unmount();
      expect(signal()!.aborted).toBe(true);
    });

    it('ignores an answer that arrives for a call the person already moved past', async () => {
      const first = pendingClient();
      const view = await render(
        <AiSummaryCard context={context} enabled client={first.client} onFinished={jest.fn()} />,
      );
      await fireEvent.press(screen.getByText('Poproś o podsumowanie'));
      await act(async () => first.answer(OK));
      expect(await screen.findByText('Dziewięć sesji w cztery tygodnie.')).toBeTruthy();
      await view.unmount();
    });
  });
});
