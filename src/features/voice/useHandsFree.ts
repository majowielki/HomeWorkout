import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { splitWake } from '@/domain/voice/commands';

import { requestMicrophone, stopListening, VOICE_LOCALE } from './recognizer';
import type { VoiceFailure } from './useVoiceInput';

export type HandsFreeState =
  | { kind: 'listening' }
  /** "Hej trener" was heard alone: the next phrase is the command. */
  | { kind: 'armed' }
  /** The person tapped the microphone off. */
  | { kind: 'paused' }
  | { kind: 'failed'; reason: VoiceFailure };

/** After "hej trener" on its own, how long the next phrase counts as the command. */
export const ARMED_MS = 6000;
/** Pauses before starting again after the recogniser stops: short, then longer while it keeps failing. */
export const RESTART_MS = 300;
export const MAX_RESTART_MS = 10_000;

/** Codes after which starting again cannot help. */
const FATAL: Record<string, VoiceFailure> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'unavailable',
  'language-not-supported': 'unavailable',
};

/**
 * The microphone left on for the whole session (Documents/GLOS.md §5).
 * Only ever with on-device recognition: the caller checks the Polish
 * offline pack is installed, and this asks the recogniser for on-device
 * recognition, so nothing heard leaves the phone.
 *
 * Android 13+ continuous recognition: each final result is one utterance.
 * The recogniser still stops now and then (silence, an error); it is started
 * again unless it was paused, the app is in the background, or the error says
 * it never will work. With `wakeRequired` only what follows "hej trener" is
 * passed on; otherwise every utterance is, and the caller treats it as
 * overheard (`quiet`).
 */
export function useHandsFree({
  wakeRequired,
  phrases,
  onHeard,
}: {
  wakeRequired: boolean;
  phrases: readonly string[];
  onHeard: (alternatives: string[], woken: boolean) => void;
}) {
  const [state, setState] = useState<HandsFreeState>({ kind: 'listening' });
  // Whether the microphone should be on; the recogniser's own state lags behind it.
  const wanted = useRef(true);
  const foreground = useRef(AppState.currentState !== 'background');
  const failures = useRef(0);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedUntil = useRef(0);
  const latestPhrases = useRef(phrases);
  useEffect(() => {
    latestPhrases.current = phrases;
  });

  async function begin() {
    if (restart.current) clearTimeout(restart.current);
    restart.current = null;
    if (!wanted.current || !foreground.current) return;
    if (!(await requestMicrophone())) {
      wanted.current = false;
      setState({ kind: 'failed', reason: 'denied' });
      return;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: VOICE_LOCALE,
        continuous: true,
        interimResults: false,
        maxAlternatives: 5,
        requiresOnDeviceRecognition: true,
        addsPunctuation: false,
        contextualStrings: ['hej trener', ...latestPhrases.current],
      });
    } catch {
      scheduleRestart();
    }
  }

  function scheduleRestart() {
    if (!wanted.current || !foreground.current || restart.current) return;
    const delay = Math.min(MAX_RESTART_MS, RESTART_MS * 2 ** failures.current);
    restart.current = setTimeout(() => {
      restart.current = null;
      void begin();
    }, delay);
  }

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;
    failures.current = 0;
    const alternatives = event.results.map((r) => r.transcript.trim()).filter((t) => t !== '');
    if (alternatives.length === 0) return;
    if (!wakeRequired) return onHeard(alternatives, false);

    if (Date.now() < armedUntil.current) {
      armedUntil.current = 0;
      setState({ kind: 'listening' });
      return onHeard(alternatives, true);
    }
    const split = alternatives.map(splitWake).filter((s) => s.woke);
    if (split.length === 0) return;
    const rests = split.map((s) => s.rest).filter((r) => r !== '');
    if (rests.length > 0) return onHeard(rests, true);
    armedUntil.current = Date.now() + ARMED_MS;
    setState({ kind: 'armed' });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  });

  useSpeechRecognitionEvent('error', (event) => {
    const fatal = FATAL[event.error];
    if (fatal) {
      wanted.current = false;
      setState({ kind: 'failed', reason: fatal });
      return;
    }
    // "no-speech" and the like: the room was quiet. Anything else: try again, more slowly.
    if (
      event.error !== 'no-speech' &&
      event.error !== 'speech-timeout' &&
      event.error !== 'aborted'
    ) {
      failures.current += 1;
    }
  });

  useSpeechRecognitionEvent('end', () => scheduleRestart());

  // Disarm when the command does not come.
  const armed = state.kind === 'armed';
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setState({ kind: 'listening' }), ARMED_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // On while the screen is on and the app is in front; off in the background and when the screen goes.
  useEffect(() => {
    // After the first render, not inside it: starting can end in a state change.
    const first = setTimeout(() => void begin(), 0);
    const subscription = AppState.addEventListener('change', (next) => {
      foreground.current = next === 'active';
      if (foreground.current) void begin();
      else stopListening();
    });
    return () => {
      wanted.current = false;
      clearTimeout(first);
      subscription.remove();
      if (restart.current) clearTimeout(restart.current);
      stopListening();
    };
    // Started once for the screen's life; begin reads everything else through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The microphone button: pause, or listen again. */
  function toggle() {
    if (wanted.current) {
      wanted.current = false;
      armedUntil.current = 0;
      if (restart.current) clearTimeout(restart.current);
      restart.current = null;
      stopListening();
      setState({ kind: 'paused' });
      return;
    }
    wanted.current = true;
    failures.current = 0;
    setState({ kind: 'listening' });
    void begin();
  }

  return { state, toggle };
}
