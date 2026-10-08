import type BottomSheetType from '@gorhom/bottom-sheet';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { List } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { stepKey } from '@/domain/session/steps';
import { warmupMoves } from '@/domain/session/warmup';
import type { PlannedExercise } from '@/domain/plan/types';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { GroupDoneCard } from '@/features/workout/GroupDoneCard';
import { RestTimer } from '@/features/workout/RestTimer';
import { VoiceBar } from '@/features/voice/VoiceBar';
import { SetLogger, type SetLoggerHandle } from '@/features/workout/SetLogger';
import { SessionProgressSheet } from '@/features/workout/SessionProgressSheet';
import { SubstituteModal } from '@/features/workout/SubstituteModal';
import { useActiveSession } from '@/features/workout/useActiveSession';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { useSessionVoice } from '@/features/workout/useSessionVoice';
import { WarmupChecklist } from '@/features/workout/WarmupChecklist';
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
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [voiceEnabled] = useState(getVoiceEnabled);
  const session = useActiveSession(id, exerciseMap);
  const {
    phase,
    loaded,
    steps,
    currentIndex,
    currentStep,
    templateExercise,
    effectiveExercise,
    upcoming,
    restored,
  } = session;

  function confirmFinish() {
    if (session.unloggedCount === 0) {
      session.finish();
      return;
    }
    const t = pl.workout.session;
    Alert.alert(t.finishConfirmTitle, t.finishConfirmBody(session.unloggedCount), [
      { text: pl.common.cancel, style: 'cancel' },
      { text: t.finishConfirm, style: 'destructive', onPress: () => session.finish('resume') },
    ]);
  }

  const voice = useSessionVoice({
    session,
    logger: loggerRef,
    exercise: effectiveExercise,
    stopwatchRunning,
    confirmFinish,
  });

  /** The button asks first; by voice the bar offers "Cofnij" instead. */
  function confirmSkip() {
    const t = pl.workout.session;
    Alert.alert(t.skipConfirmTitle(effectiveExercise?.name ?? ''), t.skipConfirmBody, [
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

  if (phase === 'loading' || (phase !== 'notFound' && !loaded)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (phase === 'notFound' || !loaded) {
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
          title: loaded.title,
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
        <WarmupChecklist moves={warmupMoves(session.profile)} onDone={session.warmupDone} />
      ) : null}

      {phase === 'resting' && currentStep ? (
        // Scrolls when the clip makes the screen taller than a small phone.
        <ScrollView contentContainerClassName="flex-grow justify-center p-4">
          <RestTimer
            nextLabel={upcoming?.label ?? null}
            nextExercise={upcoming?.exercise}
            nextNote={upcoming?.note}
            onDone={session.restDone}
            onUndo={() => void session.undo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'groupDone' && upcoming ? (
        <ScrollView contentContainerClassName="flex-grow">
          <GroupDoneCard
            exercises={session.groupDone}
            nextLabel={upcoming.label}
            onNext={session.restDone}
            onUndo={() => void session.undo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'logging' && currentStep && effectiveExercise ? (
        <SetLogger
          ref={loggerRef}
          onStopwatchChange={setStopwatchRunning}
          key={`${currentIndex}-${effectiveExercise.id}`}
          exercise={effectiveExercise}
          block={currentStep.block}
          planned={loaded.plan ? (currentStep.block as PlannedExercise) : undefined}
          setNumber={currentStep.setNumber}
          round={currentStep.round}
          side={currentStep.side}
          stepOfBlock={currentStep.stepOfBlock}
          stepsInBlock={currentStep.stepsInBlock}
          supersetWith={session.supersetWith || undefined}
          restore={
            restored?.key === stepKey(currentStep.blockIndex, currentStep.setNumber)
              ? restored.prefill
              : undefined
          }
          totalSets={currentStep.block.sets}
          onSave={(data) => void session.saveSet(data)}
          saving={session.saving}
          calibrations={calibrations}
          onShowDetails={() =>
            router.push({ pathname: '/exercises/[id]', params: { id: effectiveExercise.id } })
          }
        />
      ) : null}

      {phase === 'logging' && templateExercise ? (
        <View className="flex-row justify-center gap-5 border-t border-border py-3">
          <Pressable
            className="flex-row items-center gap-1.5"
            onPress={() => sheetRef.current?.snapToIndex(0)}
          >
            <List size={16} className="text-muted-foreground" />
            <Text variant="muted">{pl.workout.session.progressTitle}</Text>
          </Pressable>
          {templateExercise.substituteIds.length > 0 || loaded.plan ? (
            <Pressable onPress={() => setSubstituteModalOpen(true)}>
              <Text variant="muted">{pl.workout.session.substituteTitle}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={confirmSkip} accessibilityLabel={pl.workout.session.skipExercise}>
            <Text variant="muted">{pl.workout.session.skipShort}</Text>
          </Pressable>
        </View>
      ) : null}

      {voiceEnabled && voice.available.length > 0 ? (
        <VoiceBar available={voice.available} run={voice.run} />
      ) : null}

      <SessionProgressSheet
        ref={sheetRef}
        steps={steps}
        currentIndex={currentIndex}
        loggedKeys={session.loggedKeys}
        exerciseMap={exerciseMap}
        onJump={(index) => {
          session.jump(index);
          sheetRef.current?.close();
        }}
      />

      {templateExercise ? (
        <SubstituteModal
          visible={substituteModalOpen}
          current={templateExercise}
          swappedTo={effectiveExercise?.id !== templateExercise.id ? effectiveExercise : null}
          exerciseMap={exerciseMap}
          profile={session.profile}
          excludedIds={session.excludedIds}
          planned={loaded.plan !== null}
          onSelect={(choice) => {
            session.substitute(choice);
            setSubstituteModalOpen(false);
          }}
          onRestore={() => {
            session.restoreSubstitute();
            setSubstituteModalOpen(false);
          }}
          onExclude={session.exclude}
          onClose={() => setSubstituteModalOpen(false)}
        />
      ) : null}
    </View>
  );
}
