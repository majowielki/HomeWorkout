import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';

import type { FallbackOutcome } from '@/ai/voice/fallback';
import { transcriptStillApplies, type VoiceTarget } from '@/domain/observations/entry';
import { matchAlternatives, type VoiceActionId, type VoiceCommand } from '@/domain/voice/commands';
import { pl } from '@/strings/pl';

/** What a command did, as one line, and how to take it back when it can be. */
export interface VoiceFeedback {
  text: string;
  undo?: () => void;
}

export type VoiceFallback = (
  alternatives: readonly string[],
  available: readonly VoiceActionId[],
  signal: AbortSignal,
) => Promise<FallbackOutcome>;

export interface VoiceCommandOptions {
  /** What the screen offers right now; nothing else can be chosen. */
  available: readonly VoiceActionId[];
  /** Does it; null when the screen could not (it changed while the person spoke). */
  run: (command: VoiceCommand) => VoiceFeedback | null;
  /** Asks a model about a phrase the vocabulary does not know; absent when AI is off. */
  fallback?: VoiceFallback;
  /**
   * What the screen is on: the session, its plan and the set. An answer that comes back after
   * this changed is not done on the new screen (T40). Absent: the screen has no such notion.
   */
  target?: VoiceTarget | null;
}

export type Shown = VoiceFeedback & { tone: 'done' | 'warn' };

/** Long enough to read and reach "Cofnij"; the bar goes back to its hint after. */
export const FEEDBACK_MS = 6000;

/**
 * From heard text to a done command, the same whatever is listening (a tap,
 * or the microphone left on). A command is done at once and confirmed with
 * a buzz and a line; a phrase the vocabulary does not know goes to the model
 * when there is one, which may only pick an action on screen.
 *
 * `quiet` is for a microphone that hears everything said in the room: only
 * a phrase the vocabulary is sure of does anything, and nothing else is said
 * back or sent anywhere.
 */
export function useVoiceCommands({ available, run, fallback, target }: VoiceCommandOptions) {
  const [shown, setShown] = useState<Shown | null>(null);
  // The model is being asked; listening again cancels it.
  const [asking, setAsking] = useState<AbortController | null>(null);

  // An answer from the model comes back after the screen may have moved on:
  // it is checked against what the screen offers then, not when it was asked.
  const latest = useRef({ available, run, fallback, target });
  useEffect(() => {
    latest.current = { available, run, fallback, target };
  });
  useEffect(() => () => asking?.abort(), [asking]);

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [shown]);

  /** `started` is where the screen was when the words were heard: a command is for that set, not the one on screen later. */
  function done(command: VoiceCommand, byAi: boolean, started: VoiceTarget | null | undefined) {
    const now = latest.current.target;
    if (started && now && !transcriptStillApplies(started, now))
      return warn(pl.voice.screenChanged);
    const result = latest.current.run(command);
    if (result) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShown({ ...result, text: byAi ? pl.voice.byAi(result.text) : result.text, tone: 'done' });
      return;
    }
    warn(pl.voice.notNow);
  }

  function warn(text: string) {
    setShown({ text, tone: 'warn' });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  async function askModel(alternatives: string[], started: VoiceTarget | null | undefined) {
    const ask = latest.current.fallback;
    if (!ask) return warn(pl.voice.notUnderstood(alternatives[0]!));
    const controller = new AbortController();
    setAsking(controller);
    const outcome = await ask(alternatives, latest.current.available, controller.signal);
    setAsking((current) => (current === controller ? null : current));
    switch (outcome.kind) {
      case 'command':
        return done(outcome.command, true, started);
      case 'medical':
        return warn(pl.workout.session.shortfall.painNote);
      case 'failed':
        return warn(pl.voice.aiFailed(alternatives[0]!));
      case 'unknown':
        return warn(pl.voice.notUnderstood(alternatives[0]!));
      case 'aborted':
        return;
    }
  }

  function handle(alternatives: string[], options: { quiet?: boolean } = {}) {
    const started = latest.current.target;
    const match = matchAlternatives(alternatives, latest.current.available);
    if (match.kind === 'command') return done(match.command, false, started);
    if (options.quiet) return;
    if (match.kind === 'ambiguous') {
      return warn(pl.voice.ambiguous(match.actions.map((a) => pl.voice.phrase[a]).join(' albo ')));
    }
    void askModel(alternatives, started);
  }

  /** Clears the line and cancels a question to the model: the person is about to speak again. */
  function reset() {
    asking?.abort();
    setAsking(null);
    setShown(null);
  }

  return { shown, asking: asking !== null, handle, reset, dismiss: () => setShown(null) };
}
