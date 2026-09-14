import type BottomSheetType from '@gorhom/bottom-sheet';
import { List } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hasWarmupLog, logCardio } from '@/db/repositories/cardioLogs';
import { getMedicalProfile } from '@/db/repositories/profile';
import { getLoggedStepKeys, logSet } from '@/db/repositories/setLogs';
import { getWorkout } from '@/db/repositories/workouts';
import { getTemplate } from '@/db/repositories/templates';
import { buildSessionSteps, findResumeIndex } from '@/domain/session/steps';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { RestTimer } from '@/features/workout/RestTimer';
import type { SavedSetData } from '@/features/workout/SetLogger';
import { SetLogger } from '@/features/workout/SetLogger';
import { SessionProgressSheet } from '@/features/workout/SessionProgressSheet';
import { SubstituteModal } from '@/features/workout/SubstituteModal';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { WarmupCard } from '@/features/workout/WarmupCard';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

type Phase = 'loading' | 'warmup' | 'logging' | 'resting' | 'notFound';

type Loaded = {
  workoutId: string;
  templateId: string;
  templateName: string;
  warmupMinutes: number | null;
};

export default function ActiveSessionScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const exerciseMap = useExerciseMap();
  const sheetRef = useRef<BottomSheetType>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [steps, setSteps] = useState<ReturnType<typeof buildSessionSteps>>([]);
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profile, setProfile] = useState<MedicalProfile>({ knee: null });
  const [substitutes, setSubstitutes] = useState<Record<number, string>>({});
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Initial load: workout -> template -> steps -> where to resume.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const workout = await getWorkout(id);
      if (!workout || !workout.templateId) {
        if (!cancelled) setPhase('notFound');
        return;
      }
      const template = await getTemplate(workout.templateId);
      if (!template) {
        if (!cancelled) setPhase('notFound');
        return;
      }

      const builtSteps = buildSessionSteps(template.blocks);
      const keys = await getLoggedStepKeys(id);
      const resumeIndex = findResumeIndex(builtSteps, keys);
      const med = await getMedicalProfile();

      if (cancelled) return;
      setLoaded({
        workoutId: id,
        templateId: template.id,
        templateName: template.name,
        warmupMinutes: template.warmupMinutes,
      });
      setSteps(builtSteps);
      setLoggedKeys(keys);
      setProfile(med);

      if (resumeIndex >= builtSteps.length) {
        router.replace({ pathname: '/workout/summary/[id]', params: { id } });
        return;
      }

      if (resumeIndex === 0 && template.warmupMinutes) {
        const warmedUp = await hasWarmupLog(id);
        if (!cancelled) setPhase(warmedUp ? 'logging' : 'warmup');
      } else if (!cancelled) {
        setPhase('logging');
      }
      if (!cancelled) setCurrentIndex(resumeIndex);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const currentStep = steps[currentIndex] ?? null;
  const templateExercise = currentStep ? exerciseMap[currentStep.block.exerciseId] : undefined;
  const effectiveExercise: Exercise | undefined = currentStep
    ? (exerciseMap[substitutes[currentIndex] ?? ''] ?? templateExercise)
    : undefined;

  const nextLabel = useMemo(() => {
    const next = currentStep?.next;
    if (!next) return null;
    const nextExercise = exerciseMap[next.block.exerciseId];
    return `${next.block.label} · ${nextExercise?.name ?? next.block.exerciseId}`;
  }, [currentStep, exerciseMap]);

  async function handleLogWarmup(minutes: number) {
    if (!loaded) return;
    setSaving(true);
    const workout = await getWorkout(loaded.workoutId);
    await logCardio({
      workoutId: loaded.workoutId,
      trainingDate: workout?.trainingDate ?? new Date().toISOString().slice(0, 10),
      purpose: 'warmup',
      minutes,
    });
    setSaving(false);
    setPhase('logging');
  }

  async function handleSaveSet(data: SavedSetData) {
    if (!loaded || !currentStep || !effectiveExercise) return;
    setSaving(true);
    await logSet({
      workoutId: loaded.workoutId,
      exerciseId: effectiveExercise.id,
      exerciseOrder: currentStep.blockIndex,
      setIndex: currentStep.setNumber,
      reps: data.reps,
      timeSec: data.timeSec,
      rir: data.rir,
      weightKg: data.weightKg,
      dumbbellMode: data.dumbbellMode,
      bandId: data.bandId,
      anchorPosition: data.anchorPosition,
      estimatedLoadKg: null, // band calibration lands in M6
    });
    const freshKeys = await getLoggedStepKeys(loaded.workoutId);
    setLoggedKeys(freshKeys);
    setSaving(false);

    if (currentIndex >= steps.length - 1) {
      router.replace({ pathname: '/workout/summary/[id]', params: { id: loaded.workoutId } });
      return;
    }

    await useRestTimerStore
      .getState()
      .start(currentStep.block.restSec, pl.workout.session.restNotificationBody);
    setPhase('resting');
  }

  function handleRestDone() {
    // Synchronous first so RestTimer unmounts immediately and its own
    // interval stops, before the async store cleanup below resolves.
    setPhase('logging');
    setCurrentIndex((i) => i + 1);
    void useRestTimerStore.getState().stop();
  }

  if (phase === 'loading' || !loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (phase === 'notFound') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text variant="muted">{pl.workout.session.notFound}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: loaded.templateName,
          headerRight: () => (
            <Pressable
              onPress={() =>
                router.replace({
                  pathname: '/workout/summary/[id]',
                  params: { id: loaded.workoutId },
                })
              }
              hitSlop={8}
            >
              <Text className="text-primary">{pl.workout.session.finishEarly}</Text>
            </Pressable>
          ),
        }}
      />

      {phase === 'warmup' && loaded.warmupMinutes ? (
        <WarmupCard
          defaultMinutes={loaded.warmupMinutes}
          onLog={handleLogWarmup}
          onSkip={() => setPhase('logging')}
          saving={saving}
        />
      ) : null}

      {phase === 'resting' && currentStep ? (
        <View className="flex-1 justify-center p-4">
          <RestTimer nextLabel={nextLabel} onDone={handleRestDone} />
        </View>
      ) : null}

      {phase === 'logging' && currentStep && effectiveExercise ? (
        <SetLogger
          key={`${currentIndex}-${effectiveExercise.id}`}
          exercise={effectiveExercise}
          block={currentStep.block}
          setNumber={currentStep.setNumber}
          totalSets={currentStep.block.sets}
          onSave={handleSaveSet}
          saving={saving}
        />
      ) : null}

      {phase === 'logging' && templateExercise ? (
        <View className="flex-row justify-center gap-6 border-t border-border py-3">
          <Pressable
            className="flex-row items-center gap-1.5"
            onPress={() => sheetRef.current?.snapToIndex(0)}
          >
            <List size={16} color="hsl(240 4% 46%)" />
            <Text variant="muted">{pl.workout.session.progressTitle}</Text>
          </Pressable>
          {templateExercise.substituteIds.length > 0 ? (
            <Pressable onPress={() => setSubstituteModalOpen(true)}>
              <Text variant="muted">{pl.workout.session.substituteTitle}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SessionProgressSheet
        ref={sheetRef}
        steps={steps}
        currentIndex={currentIndex}
        loggedKeys={loggedKeys}
        exerciseMap={exerciseMap}
        onJump={(index) => {
          setCurrentIndex(index);
          setPhase('logging');
          sheetRef.current?.close();
        }}
      />

      {templateExercise ? (
        <SubstituteModal
          visible={substituteModalOpen}
          current={templateExercise}
          exerciseMap={exerciseMap}
          profile={profile}
          onSelect={(exercise) => {
            setSubstitutes((prev) => ({ ...prev, [currentIndex]: exercise.id }));
            setSubstituteModalOpen(false);
          }}
          onClose={() => setSubstituteModalOpen(false)}
        />
      ) : null}
    </View>
  );
}
