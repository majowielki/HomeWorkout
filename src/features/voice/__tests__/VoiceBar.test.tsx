import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import type { VoiceActionId } from '@/domain/voice/commands';
import type { FallbackOutcome } from '@/ai/voice/fallback';
import { pl } from '@/strings/pl';

import { FINISH_GRACE_MS, MAX_LISTEN_MS } from '../useVoiceInput';
import { VoiceBar } from '../VoiceBar';

const speech = ExpoSpeechRecognitionModule as unknown as {
  start: jest.Mock;
  abort: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  isRecognitionAvailable: jest.Mock;
  supportsOnDeviceRecognition: jest.Mock;
  getSupportedLocales: jest.Mock;
  __emit: (name: string, event?: unknown) => void;
};

const REST: VoiceActionId[] = ['rest_end', 'rest_extend', 'skip_exercise'];

const final = (...transcripts: string[]) => ({
  isFinal: true,
  results: transcripts.map((transcript) => ({ transcript, confidence: 0.9, segments: [] })),
});

async function listen() {
  await fireEvent.press(screen.getByLabelText(pl.voice.mic));
}

beforeEach(() => {
  jest.clearAllMocks();
  speech.requestPermissionsAsync.mockResolvedValue({ granted: true });
  speech.isRecognitionAvailable.mockReturnValue(true);
  speech.supportsOnDeviceRecognition.mockReturnValue(false);
});

it('shows what can be said, listens on a tap and does the command it hears', async () => {
  const undo = jest.fn();
  const run = jest.fn(() => ({ text: 'Koniec przerwy', undo }));
  await render(<VoiceBar available={REST} run={run} />);
  expect(
    screen.getByText(pl.voice.hint('koniec przerwy, +30 sekund, pomiń ćwiczenie')),
  ).toBeTruthy();

  await listen();
  expect(speech.start).toHaveBeenCalledWith(
    expect.objectContaining({ lang: 'pl-PL', requiresOnDeviceRecognition: false }),
  );
  expect(screen.getByText(pl.voice.listening)).toBeTruthy();

  await act(async () =>
    speech.__emit('result', { isFinal: false, results: [{ transcript: 'koniec' }] }),
  );
  expect(screen.getByText('koniec')).toBeTruthy();

  await act(async () => speech.__emit('result', final('Koniec przerwy')));
  expect(run).toHaveBeenCalledWith({ action: 'rest_end' });
  expect(screen.getByText('Koniec przerwy')).toBeTruthy();

  // A second final result for the same tap is not a second command.
  await act(async () => speech.__emit('result', final('Koniec przerwy')));
  await act(async () => speech.__emit('end'));
  expect(run).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText(pl.voice.undo));
  expect(undo).toHaveBeenCalled();
  expect(screen.queryByText(pl.voice.undo)).toBeNull();
});

it('says back a phrase it does not know and does nothing', async () => {
  const run = jest.fn();
  await render(<VoiceBar available={REST} run={run} />);
  await listen();
  await act(async () => speech.__emit('result', final('zmień obciążenie')));
  expect(run).not.toHaveBeenCalled();
  expect(screen.getByText(pl.voice.notUnderstood('zmień obciążenie'))).toBeTruthy();
});

it('recognises a spoken field edit locally, confirms it and offers undo', async () => {
  const undo = jest.fn();
  const run = jest.fn(() => ({ text: 'Jak było: spokojnie', undo }));
  const fallback = jest.fn();
  await render(
    <VoiceBar available={['set_done', 'set_reps', 'set_effort']} run={run} fallback={fallback} />,
  );
  await listen();
  await act(async () => speech.__emit('result', final('ustaw jak było na spokojnie')));
  expect(run).toHaveBeenCalledWith({ action: 'set_effort', rir: 3 });
  expect(fallback).not.toHaveBeenCalled();
  expect(screen.getByText('Jak było: spokojnie')).toBeTruthy();
  await fireEvent.press(screen.getByText(pl.voice.undo));
  expect(undo).toHaveBeenCalledTimes(1);
});

it('asks for more when two commands fit, and says so when the screen could not do it', async () => {
  const run = jest.fn(() => null);
  await render(<VoiceBar available={REST} run={run} />);
  await listen();
  await act(async () => speech.__emit('result', final('pomiń')));
  expect(screen.getByText(pl.voice.ambiguous('koniec przerwy albo pomiń ćwiczenie'))).toBeTruthy();

  await listen();
  await act(async () => speech.__emit('result', final('plus 30')));
  expect(run).toHaveBeenCalledWith({ action: 'rest_extend', seconds: 30 });
  expect(screen.getByText(pl.voice.notNow)).toBeTruthy();
});

it('a second tap stops listening', async () => {
  await render(<VoiceBar available={REST} run={jest.fn()} />);
  await listen();
  await fireEvent.press(screen.getByLabelText(pl.voice.micStop));
  expect(speech.abort).toHaveBeenCalled();
  // The recogniser confirms with an "aborted" error, which is not a failure.
  await act(async () => speech.__emit('error', { error: 'aborted', message: '' }));
  expect(
    screen.getByText(pl.voice.hint('koniec przerwy, +30 sekund, pomiń ćwiczenie')),
  ).toBeTruthy();
});

it.each([
  ['not-allowed', pl.voice.denied],
  ['network', pl.voice.network],
  ['no-speech', pl.voice.noSpeech],
  ['language-not-supported', pl.voice.unavailable],
  ['client', pl.voice.failed],
])('explains a recogniser error: %s', async (code, text) => {
  await render(<VoiceBar available={REST} run={jest.fn()} />);
  await listen();
  await act(async () => speech.__emit('error', { error: code, message: '' }));
  expect(screen.getByText(text)).toBeTruthy();
});

it('hearing nothing is said as such', async () => {
  await render(<VoiceBar available={REST} run={jest.fn()} />);
  await listen();
  await act(async () => speech.__emit('nomatch'));
  expect(screen.getByText(pl.voice.noSpeech)).toBeTruthy();

  await listen();
  await act(async () => speech.__emit('end'));
  expect(screen.getByText(pl.voice.noSpeech)).toBeTruthy();
});

it('does not listen without the microphone permission or a speech service', async () => {
  speech.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
  await render(<VoiceBar available={REST} run={jest.fn()} />);
  await listen();
  expect(speech.start).not.toHaveBeenCalled();
  expect(screen.getByText(pl.voice.denied)).toBeTruthy();

  speech.isRecognitionAvailable.mockReturnValue(false);
  await listen();
  expect(speech.start).not.toHaveBeenCalled();
  expect(screen.getByText(pl.voice.unavailable)).toBeTruthy();
});

it('recognises on the phone when the Polish offline pack is installed', async () => {
  speech.supportsOnDeviceRecognition.mockReturnValue(true);
  speech.getSupportedLocales.mockResolvedValueOnce({
    locales: ['pl-PL'],
    installedLocales: ['pl-PL'],
  });
  await render(<VoiceBar available={REST} run={jest.fn()} />);
  await listen();
  expect(speech.start).toHaveBeenCalledWith(
    expect.objectContaining({ requiresOnDeviceRecognition: true }),
  );
});

it('stops listening after a while in a noisy room, and gives up if nothing comes', async () => {
  jest.useFakeTimers();
  const stop = (ExpoSpeechRecognitionModule as unknown as { stop: jest.Mock }).stop;
  try {
    await render(<VoiceBar available={REST} run={jest.fn()} />);
    await listen();
    await act(async () => jest.advanceTimersByTime(MAX_LISTEN_MS));
    expect(stop).toHaveBeenCalled();
    expect(screen.getByText(pl.voice.listening)).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(FINISH_GRACE_MS));
    expect(speech.abort).toHaveBeenCalled();
    expect(screen.getByText(pl.voice.noSpeech)).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('a failure fades back to the hint', async () => {
  jest.useFakeTimers();
  try {
    await render(<VoiceBar available={REST} run={jest.fn()} />);
    await listen();
    await act(async () => speech.__emit('error', { error: 'no-speech', message: '' }));
    expect(screen.getByText(pl.voice.noSpeech)).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.queryByText(pl.voice.noSpeech)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

describe('the AI fallback', () => {
  it('asks the model about a phrase it does not know, and marks what the model chose', async () => {
    const run = jest.fn(() => ({ text: 'Koniec przerwy', undo: jest.fn() }));
    let answer!: (outcome: FallbackOutcome) => void;
    const fallback = jest.fn(() => new Promise<FallbackOutcome>((resolve) => (answer = resolve)));
    await render(<VoiceBar available={REST} run={run} fallback={fallback} />);
    await listen();
    await act(async () => speech.__emit('result', final('lecę z następną', 'lecę z następnym')));
    expect(fallback).toHaveBeenCalledWith(
      ['lecę z następną', 'lecę z następnym'],
      REST,
      expect.any(AbortSignal),
    );
    expect(screen.getByText(pl.voice.asking)).toBeTruthy();

    await act(async () => answer({ kind: 'command', command: { action: 'rest_end' } }));
    expect(run).toHaveBeenCalledWith({ action: 'rest_end' });
    expect(screen.getByText(pl.voice.byAi('Koniec przerwy'))).toBeTruthy();
    expect(screen.getByText(pl.voice.undo)).toBeTruthy();
  });

  it.each([
    [{ kind: 'unknown' } as const, pl.voice.notUnderstood('coś innego')],
    [{ kind: 'medical' } as const, pl.workout.session.shortfall.painNote],
    [{ kind: 'failed', failure: 'offline' } as const, pl.voice.aiFailed('coś innego')],
  ])('says what came of it: %o', async (outcome, text) => {
    const run = jest.fn();
    await render(<VoiceBar available={REST} run={run} fallback={async () => outcome} />);
    await listen();
    await act(async () => speech.__emit('result', final('coś innego')));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('an answer that comes back after the screen moved to another set is not done (T40)', async () => {
    const run = jest.fn(() => ({ text: 'Zapisano', undo: jest.fn() }));
    let answer!: (outcome: FallbackOutcome) => void;
    const fallback = jest.fn(() => new Promise<FallbackOutcome>((resolve) => (answer = resolve)));
    const target = (plannedSetId: string) => ({ sessionId: 's', planRevision: 1, plannedSetId });
    const view = await render(
      <VoiceBar available={REST} run={run} fallback={fallback} target={target('a')} />,
    );
    await listen();
    await act(async () => speech.__emit('result', final('lecę z następną')));
    // The set was saved by touch while the model was thinking: the screen is on the next one.
    await view.rerender(
      <VoiceBar available={REST} run={run} fallback={fallback} target={target('b')} />,
    );
    await act(async () => answer({ kind: 'command', command: { action: 'rest_end' } }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(pl.voice.screenChanged)).toBeTruthy();
  });

  it('an answer for the set still on screen is done', async () => {
    const run = jest.fn(() => ({ text: 'Zapisano', undo: jest.fn() }));
    const target = { sessionId: 's', planRevision: 1, plannedSetId: 'a' };
    await render(
      <VoiceBar
        available={REST}
        run={run}
        target={target}
        fallback={async () => ({ kind: 'command', command: { action: 'rest_end' } })}
      />,
    );
    await listen();
    await act(async () => speech.__emit('result', final('lecę z następną')));
    expect(run).toHaveBeenCalledWith({ action: 'rest_end' });
  });

  it('a command the screen no longer offers is not done', async () => {
    await render(
      <VoiceBar
        available={REST}
        run={() => null}
        fallback={async () => ({ kind: 'command', command: { action: 'rest_end' } })}
      />,
    );
    await listen();
    await act(async () => speech.__emit('result', final('coś innego')));
    expect(screen.getByText(pl.voice.notNow)).toBeTruthy();
  });

  it('a tap on the microphone cancels the question', async () => {
    let signal!: AbortSignal;
    const fallback = jest.fn((_a: readonly string[], _b: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise<FallbackOutcome>((resolve) =>
        s.addEventListener('abort', () => resolve({ kind: 'aborted' })),
      );
    });
    await render(<VoiceBar available={REST} run={jest.fn()} fallback={fallback} />);
    await listen();
    await act(async () => speech.__emit('result', final('coś innego')));
    await listen();
    expect(signal.aborted).toBe(true);
    expect(screen.getByText(pl.voice.listening)).toBeTruthy();
  });
});
