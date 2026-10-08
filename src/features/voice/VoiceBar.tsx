import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { Mic, MicOff, Undo2 } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import type { VoiceMode } from '@/lib/voiceSettings';
import { pl } from '@/strings/pl';

import { useHandsFree } from './useHandsFree';
import {
  FEEDBACK_MS,
  type Shown,
  useVoiceCommands,
  type VoiceCommandOptions,
} from './useVoiceCommands';
import { useVoiceInput, type VoiceFailure } from './useVoiceInput';

export type { VoiceFallback, VoiceFeedback } from './useVoiceCommands';

type Props = VoiceCommandOptions & {
  /** How the microphone listens; hands-free modes only reach here with on-device recognition. */
  mode?: VoiceMode;
};

const FAILURE_TEXT: Record<VoiceFailure, string> = {
  denied: pl.voice.denied,
  unavailable: pl.voice.unavailable,
  network: pl.voice.network,
  no_speech: pl.voice.noSpeech,
  error: pl.voice.failed,
};

/**
 * The microphone and its one line of text along the bottom of the session.
 * In `tap` mode a tap listens for one phrase; in `wake` and `continuous`
 * the microphone stays on (a tap pauses it). What is heard goes through
 * `useVoiceCommands`, the same for every mode.
 */
export function VoiceBar({ mode = 'tap', ...options }: Props) {
  return mode === 'tap' ? (
    <TapVoiceBar {...options} />
  ) : (
    <HandsFreeVoiceBar {...options} wakeRequired={mode === 'wake'} />
  );
}

function TapVoiceBar(options: VoiceCommandOptions) {
  const phrases = options.available.map((a) => pl.voice.phrase[a]);
  const commands = useVoiceCommands(options);
  const { state, toggle, clear } = useVoiceInput((alternatives) => {
    commands.handle(alternatives);
  }, phrases);

  // A failure fades like any other line, back to what can be said on the screen now.
  const failed = state.kind === 'failed';
  useEffect(() => {
    if (!failed) return;
    const id = setTimeout(clear, FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [failed, clear]);

  const listening = state.kind === 'listening';
  return (
    <BarLayout
      active={listening}
      micLabel={listening ? pl.voice.micStop : pl.voice.mic}
      onMic={() => {
        commands.reset();
        clear();
        void toggle();
      }}
      line={
        listening
          ? state.partial || pl.voice.listening
          : commands.asking
            ? pl.voice.asking
            : state.kind === 'failed'
              ? FAILURE_TEXT[state.reason]
              : (commands.shown?.text ?? pl.voice.hint(phrases.join(', ')))
      }
      shown={!listening && !commands.asking && state.kind !== 'failed' ? commands.shown : null}
      onUndo={commands.dismiss}
    />
  );
}

function HandsFreeVoiceBar({
  wakeRequired,
  ...options
}: VoiceCommandOptions & { wakeRequired: boolean }) {
  const phrases = options.available.map((a) => pl.voice.phrase[a]);
  const commands = useVoiceCommands(options);
  const { state, toggle } = useHandsFree({
    wakeRequired,
    phrases,
    // Without the wake words everything said in the room arrives here: only a sure command counts.
    onHeard: (alternatives, woken) => commands.handle(alternatives, { quiet: !woken }),
  });

  const on = state.kind === 'listening' || state.kind === 'armed';
  const hint = wakeRequired
    ? pl.voice.wakeHint(phrases.join(', '))
    : pl.voice.continuousHint(phrases.join(', '));
  return (
    <BarLayout
      active={on}
      micLabel={on ? pl.voice.pause : pl.voice.resume}
      onMic={() => {
        commands.reset();
        toggle();
      }}
      line={
        state.kind === 'armed'
          ? pl.voice.listening
          : commands.asking
            ? pl.voice.asking
            : state.kind === 'failed'
              ? FAILURE_TEXT[state.reason]
              : state.kind === 'paused'
                ? pl.voice.paused
                : (commands.shown?.text ?? hint)
      }
      shown={state.kind === 'listening' && !commands.asking ? commands.shown : null}
      onUndo={commands.dismiss}
    />
  );
}

function BarLayout({
  active,
  micLabel,
  onMic,
  line,
  shown,
  onUndo,
}: {
  active: boolean;
  micLabel: string;
  onMic: () => void;
  line: string;
  shown: Shown | null;
  onUndo: () => void;
}) {
  const undo = shown?.undo;
  return (
    <View className="flex-row items-center gap-3 border-t border-border px-4 py-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={micLabel}
        accessibilityState={{ selected: active }}
        hitSlop={8}
        onPress={onMic}
        className={cn(
          'h-12 w-12 items-center justify-center rounded-full',
          active ? 'bg-highlight' : 'bg-secondary',
        )}
      >
        {active ? (
          <MicOff size={22} className="text-background" />
        ) : (
          <Mic size={22} className="text-foreground" />
        )}
      </Pressable>
      <Text
        className={cn(
          'flex-1 text-sm leading-5',
          shown?.tone === 'done' ? 'font-display-semibold' : 'text-muted-foreground',
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
            onUndo();
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
