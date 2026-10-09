import type BottomSheetType from '@gorhom/bottom-sheet';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { List } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { resultValues } from '@/domain/session/setEntry';
import { warmupMoves } from '@/domain/session/warmup';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { GroupDoneCard } from '@/features/workout/GroupDoneCard';
import { RestTimer } from '@/features/workout/RestTimer';
import { createAppVoiceFallback } from '@/features/voice/appFallback';
import { useEffectiveVoiceMode } from '@/features/voice/useEffectiveVoiceMode';
import { VoiceBar } from '@/features/voice/VoiceBar';
import { SetLogger, type SetLoggerHandle } from '@/features/workout/SetLogger';
import { SessionProgressSheet } from '@/features/workout/SessionProgressSheet';
import { SubstituteModal } from '@/features/workout/SubstituteModal';
import { useActiveSession } from '@/features/workout/useActiveSession';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { useSessionVoice } from '@/features/workout/useSessionVoice';
import { WarmupChecklist, type WarmupHandle } from '@/features/workout/WarmupChecklist';
import { useLandscapeAllowed } from '@/lib/useLandscapeAllowed';
import { getVoiceEnabled } from '@/lib/voiceSettings';
import { pl } from '@/strings/pl';

/** The active session. What it does lives in useActiveSession; this draws it. */
export default function ActiveSessionScreen() {
  useKeepAwake();
  // On the floor, a phone on its side shows the clip next to the set.
  useLandscapeAllowed();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const exerciseMap = useExerciseMap();
  const calibrations = useBandCalibrations();
  const sheetRef = useRef<BottomSheetType>(null);
  const loggerRef = useRef<SetLoggerHandle>(null);
  const warmupRef = useRef<WarmupHandle>(null);
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [voiceEnabled] = useState(getVoiceEnabled);
  const voiceMode = useEffectiveVoiceMode();
  // Read once per session: the AI switch lives in Settings, not on this screen.
  const [voiceFallback] = useState(createAppVoiceFallback);
  const session = useActiveSession(id, exerciseMap);
  const { phase, steps, currentIndex, currentStep, exercise, upcoming, restored } = session;

  function confirmFinish() {
    if (session.unfinishedCount === 0) {
      session.finish();
      return;
    }
    const t = pl.workout.session;
    Alert.alert(t.finishConfirmTitle, t.finishConfirmBody(session.unfinishedCount), [
      { text: pl.common.cancel, style: 'cancel' },
      { text: t.finishConfirm, style: 'destructive', onPress: () => session.finish('resume') },
    ]);
  }

  const voice = useSessionVoice({
    session,
    logger: loggerRef,
    warmup: warmupRef,
    exercise,
    stopwatchRunning,
    confirmFinish,
  });

  /** The button asks first; by voice the bar offers "Cofnij" instead. */
  function confirmSkip() {
    const t = pl.workout.session;
    Alert.alert(t.skipConfirmTitle(exercise?.name ?? ''), t.skipConfirmBody, [
      { text: pl.common.cancel, style: 'cancel' },
      {
        text: t.skipExercise,
        style: 'destructive',
        onPress: () => {
          if (session.skipExercise().kind === 'last') confirmFinish();
        },
      },
    ]);
  }

  if (phase === 'loading' || (phase !== 'notFound' && !session.session)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (phase === 'notFound' || !session.session) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.workout.session.notFound}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: session.title,
          headerRight: () => (
            <Pressable onPress={confirmFinish} hitSlop={8}>
              <Text className="font-display-semibold text-highlight">
                {pl.workout.session.finishEarly}
              </Text>
            </Pressable>
          ),
        }}
      />

      {phase === 'warmup' ? (
        <WarmupChecklist
          ref={warmupRef}
          moves={warmupMoves(session.profile)}
          onDone={session.warmupDone}
        />
      ) : null}

      {phase === 'resting' && currentStep ? (
        // Scrolls when the clip makes the screen taller than a small phone.
        <ScrollView contentContainerClassName="flex-grow justify-center p-4">
          <RestTimer
            nextLabel={upcoming?.label ?? null}
            nextExercise={upcoming?.exercise}
            nextNote={upcoming?.note}
            onDone={session.restDone}
            onUndo={() => session.undo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'groupDone' && upcoming ? (
        <ScrollView contentContainerClassName="flex-grow">
          <GroupDoneCard
            exercises={session.groupDone}
            nextLabel={upcoming.label}
            onNext={session.restDone}
            onUndo={() => session.undo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'logging' && currentStep && exercise ? (
        <SetLogger
          ref={loggerRef}
          onStopwatchChange={setStopwatchRunning}
          key={currentStep.set.id}
          exercise={exercise}
          step={currentStep}
          previous={session.previousResult}
          previousPlanned={session.previousPlanned}
          supersetWith={session.supersetWith || undefined}
          restore={
            restored?.plannedSetId === currentStep.set.id
              ? resultValues(exercise, restored.result)
              : undefined
          }
          onSave={(logged) => void session.saveSet(logged)}
          saving={session.saving}
          calibrations={calibrations}
          onShowDetails={() =>
            router.push({ pathname: '/exercises/[id]', params: { id: exercise.id } })
          }
        />
      ) : null}

      {phase === 'logging' && exercise ? (
        <View className="flex-row justify-center gap-5 border-t border-border py-3">
          <Pressable
            className="flex-row items-center gap-1.5"
            onPress={() => sheetRef.current?.snapToIndex(0)}
          >
            <List size={16} className="text-muted-foreground" />
            <Text variant="muted">{pl.workout.session.progressTitle}</Text>
          </Pressable>
          <Pressable onPress={() => setSubstituteModalOpen(true)}>
            <Text variant="muted">{pl.workout.session.substituteTitle}</Text>
          </Pressable>
          <Pressable onPress={confirmSkip} accessibilityLabel={pl.workout.session.skipExercise}>
            <Text variant="muted">{pl.workout.session.skipShort}</Text>
          </Pressable>
        </View>
      ) : null}

      {voiceEnabled && voiceMode && voice.available.length > 0 ? (
        <VoiceBar
          mode={voiceMode}
          available={voice.available}
          run={voice.run}
          target={voice.target}
          fallback={voiceFallback ?? undefined}
        />
      ) : null}

      <SessionProgressSheet
        ref={sheetRef}
        steps={steps}
        currentIndex={currentIndex}
        exerciseMap={exerciseMap}
        onJump={(index) => {
          session.jump(index);
          sheetRef.current?.close();
        }}
      />

      {currentStep && exercise ? (
        <SubstituteModal
          visible={substituteModalOpen}
          sessionId={id}
          exposure={currentStep.exposure}
          current={exercise}
          exerciseMap={exerciseMap}
          excludedIds={session.excludedIds}
          onSwapped={() => {
            setSubstituteModalOpen(false);
            session.planChanged();
          }}
          onExclude={session.exclude}
          onClose={() => setSubstituteModalOpen(false)}
        />
      ) : null}
    </View>
  );
}
