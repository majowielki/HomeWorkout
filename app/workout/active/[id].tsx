import type BottomSheetType from '@gorhom/bottom-sheet';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { List } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { getCardioForWorkout, hasWarmupLog, logCardio } from '@/db/repositories/cardioLogs';
import { getExcludedExerciseIds, getProfile, setExerciseExcluded } from '@/db/repositories/profile';
import { getLoggedStepKeys, logSet } from '@/db/repositories/setLogs';
import { getTemplate } from '@/db/repositories/templates';
import { getCurrentBlock, setBlockSelection } from '@/db/repositories/trainingBlocks';
import { getWorkout } from '@/db/repositories/workouts';
import {
  buildSessionSteps,
  findResumeIndex,
  nextUnloggedIndex,
  type SessionStep,
  stepKey,
} from '@/domain/session/steps';
import type { PlannedExercise, SessionPlan } from '@/domain/plan/types';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { planTitle } from '@/features/plan/format';
import { RestTimer } from '@/features/workout/RestTimer';
import { type LoggedSetData, SetLogger } from '@/features/workout/SetLogger';
import { SessionProgressSheet } from '@/features/workout/SessionProgressSheet';
import { SubstituteModal } from '@/features/workout/SubstituteModal';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { WarmupCard, type WarmupResult } from '@/features/workout/WarmupCard';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

type Phase = 'loading' | 'warmup' | 'logging' | 'resting' | 'notFound';

type Loaded = {
  workoutId: string;
  trainingDate: string;
  title: string;
  warmupMinutes: number | null;
  /** The engine's plan the session was started from; null for a template session. */
  plan: SessionPlan | null;
  /** From the profile — shown on the warm-up card as a standing cue (PLAN §4.3). */
  saddleHeightCm: number | null;
};

export default function ActiveSessionScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const exerciseMap = useExerciseMap();
  const calibrations = useBandCalibrations();
  const sheetRef = useRef<BottomSheetType>(null);
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profile, setProfile] = useState<MedicalProfile>({ knee: null });
  // blockIndex -> exercise swapped in for the rest of this session.
  const [substitutes, setSubstitutes] = useState<Record<number, string>>({});
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warmupsLogged, setWarmupsLogged] = useState(0);
  // Blocks that had their warm-up set this session, so the toggle defaults off again.
  const [warmedBlocks, setWarmedBlocks] = useState<ReadonlySet<number>>(new Set());

  // Initial load: workout -> template -> steps -> where to resume.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const workout = await getWorkout(id);
      const plan = workout?.plan ?? null;
      const template =
        workout && !plan && workout.templateId ? await getTemplate(workout.templateId) : null;
      if (!workout || (!plan && !template)) {
        if (!cancelled) setPhase('notFound');
        return;
      }

      const builtSteps = buildSessionSteps(plan ? plan.exercises : template!.blocks);
      const keys = await getLoggedStepKeys(id);
      const resumeIndex = findResumeIndex(builtSteps, keys);
      const profileRow = await getProfile();
      const excluded = await getExcludedExerciseIds();
      // A planned session always starts on the bike (SPEC §7 v1.2); a
      // template only when it asks for a warm-up.
      const needsWarmup =
        resumeIndex !== 0
          ? false
          : plan
            ? (await getCardioForWorkout(id)).length === 0
            : template!.warmupMinutes
              ? !(await hasWarmupLog(id))
              : false;

      if (cancelled) return;

      if (resumeIndex >= builtSteps.length) {
        router.replace({ pathname: '/workout/summary/[id]', params: { id } });
        return;
      }

      setLoaded({
        workoutId: id,
        trainingDate: workout.trainingDate,
        title: plan ? planTitle(plan) : template!.name,
        warmupMinutes: plan ? plan.bike.minutes : template!.warmupMinutes,
        plan,
        saddleHeightCm: profileRow?.saddleHeightCm ?? null,
      });
      setSteps(builtSteps);
      setLoggedKeys(keys);
      setProfile({ knee: profileRow?.kneeProfile ?? null });
      setExcludedIds(new Set(excluded));
      setCurrentIndex(resumeIndex);
      setPhase(needsWarmup ? 'warmup' : 'logging');
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const currentStep = steps[currentIndex] ?? null;
  const templateExercise = currentStep ? exerciseMap[currentStep.block.exerciseId] : undefined;
  const effectiveExercise: Exercise | undefined = currentStep
    ? (exerciseMap[substitutes[currentStep.blockIndex] ?? ''] ?? templateExercise)
    : undefined;

  const nextLabel = useMemo(() => {
    const next = currentStep?.next;
    if (!next) return null;
    const nextExercise = exerciseMap[next.block.exerciseId];
    return `${next.block.label} · ${nextExercise?.name ?? next.block.exerciseId}`;
  }, [currentStep, exerciseMap]);

  function goToSummary() {
    if (!loaded) return;
    router.replace({ pathname: '/workout/summary/[id]', params: { id: loaded.workoutId } });
  }

  async function handleLogWarmup(result: WarmupResult) {
    if (!loaded || saving) return;
    setSaving(true);
    try {
      await logCardio({
        workoutId: loaded.workoutId,
        trainingDate: loaded.trainingDate,
        purpose: loaded.plan ? 'cardio' : 'warmup',
        minutes: result.minutes,
        resistanceLevel: result.resistance,
        rpe: result.rpe,
      });
      setPhase('logging');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSet(data: LoggedSetData) {
    if (!loaded || !currentStep || !effectiveExercise || saving) return;

    // The progress sheet only allows jumping onto unlogged steps, but this
    // is the last line of defence against a duplicate (blockIndex, setNumber)
    // row — which would corrupt resume and every future progression read.
    // A warm-up set is not a step: it shares the step's position but never
    // counts as logging it (getLoggedStepKeys ignores warm-ups).
    const key = stepKey(currentStep.blockIndex, currentStep.setNumber);
    if (!data.isWarmup && loggedKeys.has(key)) return;

    setSaving(true);
    let freshKeys = loggedKeys;
    try {
      await logSet({
        workoutId: loaded.workoutId,
        exerciseId: effectiveExercise.id,
        exerciseOrder: currentStep.blockIndex,
        setIndex: currentStep.setNumber,
        isWarmup: data.isWarmup,
        reps: data.reps,
        timeSec: data.timeSec,
        rir: data.rir,
        weightKg: data.weightKg,
        dumbbellMode: data.dumbbellMode,
        bandId: data.bandId,
        anchorPosition: data.anchorPosition,
        estimatedLoadKg: data.estimatedLoadKg,
      });
      if (!data.isWarmup) {
        freshKeys = await getLoggedStepKeys(loaded.workoutId);
        setLoggedKeys(freshKeys);
      }
    } finally {
      setSaving(false);
    }

    // Nothing left anywhere in the session (not just after this index) —
    // the user may have jumped around, so scan the whole list.
    if (nextUnloggedIndex(steps, freshKeys, 0) === null) {
      goToSummary();
      return;
    }

    // After a warm-up the same step comes back once the rest is over;
    // the remount key below includes the warm-up count so the toggle resets.
    if (data.isWarmup) {
      setWarmupsLogged((n) => n + 1);
      setWarmedBlocks((prev) => new Set(prev).add(currentStep.blockIndex));
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
    // Advance to the next step that still needs a log, starting from the
    // current one: after a working set it is logged and the scan moves on,
    // after a warm-up it is not and the same step comes back. "index + 1"
    // would skip that case, and is not safe once the user has jumped around
    // via the sheet anyway.
    const next =
      nextUnloggedIndex(steps, loggedKeys, currentIndex) ?? nextUnloggedIndex(steps, loggedKeys, 0);
    if (next === null) {
      goToSummary();
    } else {
      setCurrentIndex(next);
    }
    void useRestTimerStore.getState().stop();
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
            <Pressable onPress={goToSummary} hitSlop={8}>
              <Text className="font-display-semibold text-highlight">
                {pl.workout.session.finishEarly}
              </Text>
            </Pressable>
          ),
        }}
      />

      {phase === 'warmup' && loaded.warmupMinutes ? (
        <WarmupCard
          defaultMinutes={loaded.warmupMinutes}
          saddleHeightCm={loaded.saddleHeightCm}
          askEffort={loaded.plan !== null}
          defaultResistance={loaded.plan?.bike.resistance ?? null}
          note={loaded.plan?.bike.reasons.map((r) => pl.plan.bike[r]).join(' ')}
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
          key={`${currentIndex}-${effectiveExercise.id}-${warmupsLogged}`}
          exercise={effectiveExercise}
          block={currentStep.block}
          planned={loaded.plan ? (currentStep.block as PlannedExercise) : undefined}
          defaultWarmup={
            loaded.plan !== null &&
            (currentStep.block as PlannedExercise).warmupSet &&
            !warmedBlocks.has(currentStep.blockIndex)
          }
          setNumber={currentStep.setNumber}
          totalSets={currentStep.block.sets}
          onSave={handleSaveSet}
          saving={saving}
          calibrations={calibrations}
        />
      ) : null}

      {phase === 'logging' && templateExercise ? (
        <View
          className="flex-row justify-center gap-6 border-t border-border pt-3"
          style={{ paddingBottom: 12 + insets.bottom }}
        >
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
        </View>
      ) : null}

      <SessionProgressSheet
        ref={sheetRef}
        steps={steps}
        currentIndex={currentIndex}
        loggedKeys={loggedKeys}
        exerciseMap={exerciseMap}
        onJump={(index) => {
          void useRestTimerStore.getState().stop();
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
          excludedIds={excludedIds}
          planned={loaded.plan !== null}
          onSelect={(choice) => {
            if (!currentStep) return;
            setSubstitutes((prev) => ({ ...prev, [currentStep.blockIndex]: choice.exercise.id }));
            setSubstituteModalOpen(false);
            if (choice.forBlock && choice.slotId) {
              const slotId = choice.slotId;
              void getCurrentBlock().then((block) =>
                block ? setBlockSelection(block.id, slotId, choice.exercise.id) : undefined,
              );
            }
          }}
          onExclude={(exercise) => {
            void setExerciseExcluded(exercise.id, true);
            setExcludedIds((prev) => new Set(prev).add(exercise.id));
          }}
          onClose={() => setSubstituteModalOpen(false)}
        />
      ) : null}
    </View>
  );
}
