import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { AppState, type AppStateStatus } from 'react-native';

import type { VoiceActionId } from '@/domain/voice/commands';
import { pl } from '@/strings/pl';

import { ARMED_MS, RESTART_MS } from '../useHandsFree';
import { VoiceBar } from '../VoiceBar';

const speech = ExpoSpeechRecognitionModule as unknown as {
  start: jest.Mock;
  abort: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  __emit: (name: string, event?: unknown) => void;
};

const SET: VoiceActionId[] = ['set_done', 'skip_exercise'];
const final = (...transcripts: string[]) => ({
  isFinal: true,
  results: transcripts.map((transcript) => ({ transcript, confidence: 0.9, segments: [] })),
});
const tick = (ms = 0) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)));
const hear = (...transcripts: string[]) =>
  act(async () => speech.__emit('result', final(...transcripts)));

let appState: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  speech.requestPermissionsAsync.mockResolvedValue({ granted: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appState = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});
afterEach(() => jest.useRealTimers());

async function open(
  mode: 'wake' | 'continuous',
  extra: Partial<Parameters<typeof VoiceBar>[0]> = {},
) {
  const run = jest.fn(() => ({ text: 'Seria zapisana', undo: jest.fn() }));
  const view = await render(<VoiceBar mode={mode} available={SET} run={run} {...extra} />);
  await tick();
  return { run, ...view };
}

describe('"hej trener"', () => {
  it('listens on the phone only, continuously, and acts only after the wake words', async () => {
    const { run } = await open('wake');
    expect(speech.start).toHaveBeenCalledWith(
      expect.objectContaining({ continuous: true, requiresOnDeviceRecognition: true }),
    );
    expect(screen.getByText(pl.voice.wakeHint('seria zrobiona, pomiń ćwiczenie'))).toBeTruthy();

    await hear('seria zrobiona');
    expect(run).not.toHaveBeenCalled();

    await hear('hej trener, seria zrobiona');
    expect(run).toHaveBeenCalledWith({ action: 'set_done' });
    expect(screen.getByText('Seria zapisana')).toBeTruthy();
  });

  it('"hej trener" alone waits for the command, for a while', async () => {
    const { run } = await open('wake');
    await hear('hej trener');
    expect(screen.getByText(pl.voice.listening)).toBeTruthy();
    await hear('seria zrobiona');
    expect(run).toHaveBeenCalledTimes(1);

    await hear('hej trener');
    await tick(ARMED_MS + 10);
    await hear('seria zrobiona');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('what follows the wake words may go to the model', async () => {
    const fallback = jest.fn(async () => ({ kind: 'unknown' as const }));
    await open('wake', { fallback });
    await hear('hej trener, odhacz mi to');
    expect(fallback).toHaveBeenCalledWith(['odhacz mi to'], SET, expect.any(AbortSignal));
  });
});

describe('listening all the time', () => {
  it('acts on a sure command, and says and sends nothing about anything else', async () => {
    const fallback = jest.fn();
    const { run } = await open('continuous', { fallback });
    expect(
      screen.getByText(pl.voice.continuousHint('seria zrobiona, pomiń ćwiczenie')),
    ).toBeTruthy();

    await hear('a potem poszliśmy do kina');
    await hear('pomiń');
    expect(run).toHaveBeenCalledWith({ action: 'skip_exercise' });
    run.mockClear();
    await hear('no i co teraz');
    expect(run).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nie rozumiem/)).toBeNull();
  });
});

describe('keeping the microphone on', () => {
  it('starts again when the recogniser stops, more slowly while it keeps failing', async () => {
    await open('continuous');
    expect(speech.start).toHaveBeenCalledTimes(1);
    await act(async () => speech.__emit('end'));
    await tick(RESTART_MS);
    expect(speech.start).toHaveBeenCalledTimes(2);

    await act(async () => speech.__emit('error', { error: 'client', message: '' }));
    await act(async () => speech.__emit('end'));
    await tick(RESTART_MS);
    expect(speech.start).toHaveBeenCalledTimes(2);
    await tick(RESTART_MS);
    expect(speech.start).toHaveBeenCalledTimes(3);
  });

  it('a quiet room is not a failure', async () => {
    await open('continuous');
    await act(async () => speech.__emit('error', { error: 'no-speech', message: '' }));
    await act(async () => speech.__emit('end'));
    await tick(RESTART_MS);
    expect(speech.start).toHaveBeenCalledTimes(2);
  });

  it('stops for good when it cannot work, and says why', async () => {
    await open('wake');
    await act(async () => speech.__emit('error', { error: 'language-not-supported', message: '' }));
    await act(async () => speech.__emit('end'));
    await tick(10_000);
    expect(speech.start).toHaveBeenCalledTimes(1);
    expect(screen.getByText(pl.voice.unavailable)).toBeTruthy();
  });

  it('does not start without the microphone permission', async () => {
    speech.requestPermissionsAsync.mockResolvedValue({ granted: false });
    await open('wake');
    expect(speech.start).not.toHaveBeenCalled();
    expect(screen.getByText(pl.voice.denied)).toBeTruthy();
  });

  it('a tap pauses it and another resumes it', async () => {
    await open('continuous');
    await fireEvent.press(screen.getByLabelText(pl.voice.pause));
    expect(speech.abort).toHaveBeenCalled();
    expect(screen.getByText(pl.voice.paused)).toBeTruthy();
    await act(async () => speech.__emit('end'));
    await tick(10_000);
    expect(speech.start).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText(pl.voice.resume));
    await tick();
    expect(speech.start).toHaveBeenCalledTimes(2);
  });

  it('lets go in the background and listens again in front', async () => {
    await open('continuous');
    await act(async () => appState?.('background'));
    expect(speech.abort).toHaveBeenCalled();
    await act(async () => speech.__emit('end'));
    await tick(10_000);
    expect(speech.start).toHaveBeenCalledTimes(1);
    await act(async () => appState?.('active'));
    await tick();
    expect(speech.start).toHaveBeenCalledTimes(2);
  });

  it('lets go when the screen goes', async () => {
    const { unmount } = await open('continuous');
    speech.abort.mockClear();
    await act(async () => unmount());
    expect(speech.abort).toHaveBeenCalled();
  });
});
