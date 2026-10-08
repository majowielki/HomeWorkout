import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type RecognitionMode,
  recognitionMode,
  requestMicrophone,
  startListening,
  stopListening,
  finishListening,
} from './recognizer';

/** Long enough for any command; a noisy room otherwise keeps the recogniser listening. */
export const MAX_LISTEN_MS = 8000;
/** How long a stopped recogniser gets to report what it heard before the tap counts as nothing. */
export const FINISH_GRACE_MS = 3000;

export type VoiceFailure = 'denied' | 'unavailable' | 'network' | 'no_speech' | 'error';

export type VoiceInputState =
  | { kind: 'idle' }
  /** What has been heard so far, while the person is still speaking. */
  | { kind: 'listening'; partial: string }
  | { kind: 'failed'; reason: VoiceFailure };

/** The recogniser's error codes, as what the person can do about them. */
function failureOf(code: string): VoiceFailure | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
      return 'denied';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'unavailable';
    case 'network':
      return 'network';
    case 'no-speech':
    case 'speech-timeout':
      return 'no_speech';
    default:
      return 'error';
  }
}

/**
 * Push to talk: a tap listens for one phrase, a second tap stops listening.
 * The microphone is never on without a tap, and it is released when the
 * screen goes away. `onHeard` gets the recogniser's guesses, best first,
 * once per tap.
 */
export function useVoiceInput(
  onHeard: (alternatives: string[]) => void,
  phrases: readonly string[],
) {
  const [state, setState] = useState<VoiceInputState>({ kind: 'idle' });
  const mode = useRef<RecognitionMode | null>(null);
  // One phrase per tap: a recogniser may report a final result more than once.
  const heard = useRef(true);

  useSpeechRecognitionEvent('result', (event) => {
    const alternatives = event.results.map((r) => r.transcript.trim()).filter((t) => t !== '');
    if (!event.isFinal) {
      setState({ kind: 'listening', partial: alternatives[0] ?? '' });
      return;
    }
    if (heard.current || alternatives.length === 0) return;
    heard.current = true;
    setState({ kind: 'idle' });
    onHeard(alternatives);
  });

  useSpeechRecognitionEvent('nomatch', () => {
    if (heard.current) return;
    heard.current = true;
    setState({ kind: 'failed', reason: 'no_speech' });
  });

  useSpeechRecognitionEvent('error', (event) => {
    const reason = failureOf(event.error);
    // The offline pack may have gone, or the service changed: look again next time.
    if (reason) mode.current = null;
    if (heard.current) return;
    heard.current = true;
    setState(reason ? { kind: 'failed', reason } : { kind: 'idle' });
  });

  useSpeechRecognitionEvent('end', () => {
    // Ended without a phrase, a nomatch or an error: nothing was heard.
    if (!heard.current) {
      heard.current = true;
      setState({ kind: 'failed', reason: 'no_speech' });
    }
  });

  // Leaving the screen lets go of the microphone.
  useEffect(() => () => stopListening(), []);

  // Background noise can keep a recogniser hearing "speech" forever: after
  // MAX_LISTEN_MS it is asked for what it has, and given up on soon after.
  const listening = state.kind === 'listening';
  useEffect(() => {
    if (!listening) return;
    const finish = setTimeout(finishListening, MAX_LISTEN_MS);
    const giveUp = setTimeout(() => {
      if (heard.current) return;
      heard.current = true;
      stopListening();
      setState({ kind: 'failed', reason: 'no_speech' });
    }, MAX_LISTEN_MS + FINISH_GRACE_MS);
    return () => {
      clearTimeout(finish);
      clearTimeout(giveUp);
    };
  }, [listening]);

  async function toggle() {
    if (state.kind === 'listening') {
      heard.current = true;
      stopListening();
      setState({ kind: 'idle' });
      return;
    }
    if (!(await requestMicrophone())) {
      setState({ kind: 'failed', reason: 'denied' });
      return;
    }
    mode.current ??= await recognitionMode();
    if (mode.current === 'unavailable') {
      setState({ kind: 'failed', reason: 'unavailable' });
      return;
    }
    heard.current = false;
    setState({ kind: 'listening', partial: '' });
    try {
      startListening(mode.current, phrases);
    } catch {
      heard.current = true;
      setState({ kind: 'failed', reason: 'error' });
    }
  }

  const clear = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, toggle, clear };
}
