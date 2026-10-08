import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Mic, MicOff, Undo2 } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { FallbackOutcome } from '@/ai/voice/fallback';
import { matchAlternatives, type VoiceActionId, type VoiceCommand } from '@/domain/voice/commands';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

import { useVoiceInput, type VoiceFailure } from './useVoiceInput';

/** What a command did, as one line, and how to take it back when it can be. */
export interface VoiceFeedback {
  text: string;
  undo?: () => void;
}

type Props = {
  /** What the screen offers right now; nothing else can be chosen. */
  available: readonly VoiceActionId[];
  /** Does it; null when the screen could not (it changed while the person spoke). */
  run: (command: VoiceCommand) => VoiceFeedback | null;
  /**
   * Asks a model when the vocabulary does not know a phrase; absent when the
   * AI switch is off or no server is set up.
   */
  fallback?: (
    alternatives: readonly string[],
    available: readonly VoiceActionId[],
    signal: AbortSignal,
  ) => Promise<FallbackOutcome>;
};

/** Long enough to read and reach "Cofnij"; the bar goes back to the hint after. */
const FEEDBACK_MS = 6000;

const FAILURE_TEXT: Record<VoiceFailure, string> = {
  denied: pl.voice.denied,
  unavailable: pl.voice.unavailable,
  network: pl.voice.network,
  no_speech: pl.voice.noSpeech,
  error: pl.voice.failed,
};

type Shown = VoiceFeedback & { tone: 'done' | 'warn' };

/**
 * The microphone and its one line of text along the bottom of the session.
 * Each phrase is matched on the phone against what the screen offers; a
 * command is done at once and confirmed with a buzz and a line that says
 * what happened, with "Cofnij" next to it. A phrase the vocabulary does not
 * know goes to the model when there is one, which may only pick an action
 * on screen; anything else is said back to the person and nothing happens.
 */
export function VoiceBar({ available, run, fallback }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  // The model is being asked; a tap on the microphone cancels it.
  const [asking, setAsking] = useState<AbortController | null>(null);
  const phrases = available.map((a) => pl.voice.phrase[a]);

  // An answer from the model comes back after the screen may have moved on:
  // it is checked against what the screen offers then, not when it was asked.
  const latest = useRef({ available, run });
  useEffect(() => {
    latest.current = { available, run };
  });
  useEffect(() => () => asking?.abort(), [asking]);

  function done(command: VoiceCommand, byAi: boolean) {
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

  async function askModel(alternatives: string[]) {
    if (!fallback) return warn(pl.voice.notUnderstood(alternatives[0]!));
    const controller = new AbortController();
    setAsking(controller);
    const outcome = await fallback(alternatives, available, controller.signal);
    setAsking((current) => (current === controller ? null : current));
    switch (outcome.kind) {
      case 'command':
        return done(outcome.command, true);
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

  const { state, toggle, clear } = useVoiceInput((alternatives) => {
    const match = matchAlternatives(alternatives, available);
    if (match.kind === 'command') return done(match.command, false);
    if (match.kind === 'ambiguous') {
      return warn(pl.voice.ambiguous(match.actions.map((a) => pl.voice.phrase[a]).join(' albo ')));
    }
    void askModel(alternatives);
  }, phrases);

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [shown]);

  // A failure fades the same way, back to what can be said on the screen now.
  const failed = state.kind === 'failed';
  useEffect(() => {
    if (!failed) return;
    const id = setTimeout(clear, FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [failed, clear]);

  const listening = state.kind === 'listening';
  const line = listening
    ? state.partial || pl.voice.listening
    : asking
      ? pl.voice.asking
      : state.kind === 'failed'
        ? FAILURE_TEXT[state.reason]
        : (shown?.text ?? pl.voice.hint(phrases.join(', ')));
  const undo = !listening && !asking && state.kind !== 'failed' ? shown?.undo : undefined;

  return (
    <View className="flex-row items-center gap-3 border-t border-border px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? pl.voice.micStop : pl.voice.mic}
        accessibilityState={{ selected: listening }}
        hitSlop={8}
        onPress={() => {
          asking?.abort();
          setAsking(null);
          setShown(null);
          clear();
          void toggle();
        }}
        className={cn(
          'h-12 w-12 items-center justify-center rounded-full',
          listening ? 'bg-highlight' : 'bg-secondary',
        )}
      >
        {listening ? (
          <MicOff size={22} className="text-background" />
        ) : (
          <Mic size={22} className="text-foreground" />
        )}
      </Pressable>
      <Text
        className={cn(
          'flex-1 text-sm leading-5',
          shown?.tone === 'done' && !listening ? 'font-display-semibold' : 'text-muted-foreground',
        )}
        numberOfLines={2}
        accessibilityLiveRegion="polite"
      >
        {line}
      </Text>
      {undo ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setShown(null);
            undo();
          }}
          className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-2"
        >
          <Undo2 size={16} className="text-foreground" />
          <Text className="font-display-semibold text-sm">{pl.voice.undo}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
