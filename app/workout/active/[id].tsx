import type BottomSheetType from '@gorhom/bottom-sheet';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { List } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { getExcludedExerciseIds, getProfile, setExerciseExcluded } from '@/db/repositories/profile';
import {
  getLoggedStepKeys,
  getSetsForWorkout,
  logSet,
  takeBackLastSet,
} from '@/db/repositories/setLogs';
import { getTemplate } from '@/db/repositories/templates';
import { getCurrentBlock, setBlockSelection } from '@/db/repositories/trainingBlocks';
import { getWorkout } from '@/db/repositories/workouts';
import {
  buildSessionSteps,
  findResumeIndex,
  groupBlockIndices,
  groupKey,
  isGroupComplete,
  nextUnloggedIndex,
  type SessionStep,
  stepKey,
} from '@/domain/session/steps';
import { warmupMoves } from '@/domain/session/warmup';
import type { PlannedExercise, SessionPlan } from '@/domain/plan/types';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { useBandCalibrations } from '@/features/bands/useBandCalibrations';
import { describeSet } from '@/features/history/describeSet';
import { planTitle } from '@/features/plan/format';
import { type GroupDoneExercise, GroupDoneCard } from '@/features/workout/GroupDoneCard';
import { RestTimer } from '@/features/workout/RestTimer';
import { type SavedSetData, SetLogger } from '@/features/workout/SetLogger';
import { SessionProgressSheet } from '@/features/workout/SessionProgressSheet';
import { SubstituteModal } from '@/features/workout/SubstituteModal';
import { useExerciseMap } from '@/features/workout/useExerciseMap';
import { takeUndone, type UndoneSet, undoneFromRow } from '@/features/workout/undoneSet';
import { WarmupChecklist } from '@/features/workout/WarmupChecklist';
import { useLandscapeAllowed } from '@/lib/useLandscapeAllowed';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

type Phase = 'loading' | 'warmup' | 'logging' | 'resting' | 'groupDone' | 'notFound';

type Loaded = {
  workoutId: string;
  trainingDate: string;
  title: string;
  /** The engine's plan the session was started from; null for a template session. */
  plan: SessionPlan | null;
};

export default function ActiveSessionScreen() {
  useKeepAwake();
  // On the floor, a phone on its side shows the clip next to the set.
  useLandscapeAllowed();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const exerciseMap = useExerciseMap();
  const calibrations = useBandCalibrations();
  const sheetRef = useRef<BottomSheetType>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profile, setProfile] = useState<MedicalProfile>({ knee: null });
  // blockIndex -> exercise swapped in for the rest of this session.
  const [substitutes, setSubstitutes] = useState<Record<number, string>>({});
  // blockIndex -> slot whose block selection the swap also changed, so a restore can undo it.
  const [blockSwaps, setBlockSwaps] = useState<Record<number, string>>({});
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [substituteModalOpen, setSubstituteModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // What the just-finished exercise or superset looked like, for the groupDone card.
  const [groupDone, setGroupDone] = useState<GroupDoneExercise[]>([]);
  // A set taken back with "Cofnij serię": its step shows the logged numbers again.
  const [restored, setRestored] = useState<UndoneSet | null>(null);

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
      // A fresh session opens on the general warm-up; the bike is its own
      // task on 'Dziś', done whenever suits the day.
      const needsWarmup = resumeIndex === 0;

      if (cancelled) return;

      if (resumeIndex >= builtSteps.length) {
        router.replace({ pathname: '/workout/summary/[id]', params: { id, back: 'undo' } });
        return;
      }
      // Back from the summary with the last set taken back: open on that set.
      const undone = takeUndone(id);
      const undoneIndex = undone
        ? builtSteps.findIndex((s) => stepKey(s.blockIndex, s.setNumber) === undone.key)
        : -1;

      setLoaded({
        workoutId: id,
        trainingDate: workout.trainingDate,
        title: plan ? planTitle(plan) : template!.name,
        plan,
      });
      setSteps(builtSteps);
      setLoggedKeys(keys);
      setProfile({ knee: profileRow?.kneeProfile ?? null });
      setExcludedIds(new Set(excluded));
      if (undone && undoneIndex >= 0) {
        setCurrentIndex(undoneIndex);
        setRestored(undone);
        setPhase('logging');
      } else {
        setCurrentIndex(resumeIndex);
        setPhase(needsWarmup ? 'warmup' : 'logging');
      }
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

  // What the rest is for. Mirrors handleRestDone — the first unlogged step from
  // here, wrapping round — so after a warm-up (the same step comes back) and
  // after a jump through the progress sheet it still names the right exercise.
  const upcoming = useMemo(() => {
    if (phase !== 'resting' && phase !== 'groupDone') return null;
    const index =
      nextUnloggedIndex(steps, loggedKeys, currentIndex) ?? nextUnloggedIndex(steps, loggedKeys, 0);
    const step = index === null ? undefined : steps[index];
    if (!step) return null;
    const exercise =
      exerciseMap[substitutes[step.blockIndex] ?? ''] ?? exerciseMap[step.block.exerciseId];
    const current = steps[currentIndex];
    const supersetSwitch =
      current !== undefined &&
      current.blockIndex !== step.blockIndex &&
      groupKey(current.block.label) === groupKey(step.block.label);
    return {
      exercise: exercise ?? null,
      label: `${step.block.label} · ${exercise?.name ?? step.block.exerciseId}`,
      note: supersetSwitch ? pl.workout.session.supersetNext : null,
    };
  }, [phase, steps, loggedKeys, currentIndex, substitutes, exerciseMap]);

  /** The exercise actually done for a block: today's swap, else the plan's. */
  const exerciseFor = (blockIndex: number) => {
    const block = steps.find((s) => s.blockIndex === blockIndex)?.block;
    return exerciseMap[substitutes[blockIndex] ?? ''] ?? (block && exerciseMap[block.exerciseId]);
  };

  // "Superseria z: …" on the set screen, naming the other half of the pair.
  const supersetWith = currentStep
    ? groupBlockIndices(steps, currentStep.blockIndex)
        .filter((i) => i !== currentStep.blockIndex)
        .map((i) => exerciseFor(i)?.name)
        .filter(Boolean)
        .join(', ')
    : '';

  /**
   * `back` tells the summary what "Wróć do treningu" does there: take the
   * last set back when everything is logged (the last tap may have been a
   * mistake), or simply return when the workout was finished early.
   */
  function goToSummary(back: 'undo' | 'resume' = 'undo') {
    if (!loaded) return;
    router.replace({
      pathname: '/workout/summary/[id]',
      params: { id: loaded.workoutId, back },
    });
  }

  function confirmFinish() {
    const left = steps.filter((s) => !loggedKeys.has(stepKey(s.blockIndex, s.setNumber))).length;
    if (left === 0) {
      goToSummary();
      return;
    }
    const t = pl.workout.session;
    Alert.alert(t.finishConfirmTitle, t.finishConfirmBody(left), [
      { text: pl.common.cancel, style: 'cancel' },
      { text: t.finishConfirm, style: 'destructive', onPress: () => goToSummary('resume') },
    ]);
  }

  /** The finished exercise or superset, set by set, for the groupDone card. */
  async function loadGroupDone(workoutId: string, blockIndex: number) {
    const rows = await getSetsForWorkout(workoutId);
    const exercises: GroupDoneExercise[] = groupBlockIndices(steps, blockIndex).map((i) => {
      const done = rows
        .filter((r) => r.exerciseOrder === i && !r.isWarmup)
        .sort((a, b) => a.setIndex - b.setIndex);
      const id = done[0]?.exerciseId ?? exerciseFor(i)?.id ?? '';
      return { name: exerciseMap[id]?.name ?? id, sets: done.map(describeSet) };
    });
    setGroupDone(exercises);
  }

  async function handleSaveSet(data: SavedSetData) {
    if (!loaded || !currentStep || !effectiveExercise || saving) return;

    // The progress sheet only allows jumping onto unlogged steps, but this
    // is the last line of defence against a duplicate (blockIndex, setNumber)
    // row — which would corrupt resume and every future progression read.
    const key = stepKey(currentStep.blockIndex, currentStep.setNumber);
    if (loggedKeys.has(key)) return;

    setSaving(true);
    let freshKeys = loggedKeys;
    try {
      await logSet({
        workoutId: loaded.workoutId,
        exerciseId: effectiveExercise.id,
        exerciseOrder: currentStep.blockIndex,
        setIndex: currentStep.setNumber,
        isWarmup: false,
        reps: data.reps,
        timeSec: data.timeSec,
        rir: data.rir,
        weightKg: data.weightKg,
        dumbbellMode: data.dumbbellMode,
        bandId: data.bandId,
        anchorPosition: data.anchorPosition,
        estimatedLoadKg: data.estimatedLoadKg,
      });
      freshKeys = await getLoggedStepKeys(loaded.workoutId);
      setLoggedKeys(freshKeys);
      setRestored(null);
    } finally {
      setSaving(false);
    }

    // Nothing left anywhere in the session (not just after this index) —
    // the user may have jumped around, so scan the whole list.
    if (nextUnloggedIndex(steps, freshKeys, 0) === null) {
      goToSummary();
      return;
    }

    if (isGroupComplete(steps, freshKeys, currentStep.blockIndex)) {
      // The exercise (or the whole superset) is done: show what was done and
      // let the person move on when ready, instead of a rest countdown.
      await loadGroupDone(loaded.workoutId, currentStep.blockIndex);
      setPhase('groupDone');
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
    // Advance to the next step that still needs a log. "index + 1" is not
    // safe once the user has jumped around via the progress sheet.
    const next =
      nextUnloggedIndex(steps, loggedKeys, currentIndex) ?? nextUnloggedIndex(steps, loggedKeys, 0);
    if (next === null) {
      goToSummary();
    } else {
      setCurrentIndex(next);
    }
    void useRestTimerStore.getState().stop();
  }

  /**
   * "Cofnij serię" on the rest timer or the done card: the set just logged
   * is deleted and its step opens again with the logged numbers in it.
   */
  async function handleUndo() {
    if (!loaded || saving) return;
    setSaving(true);
    try {
      const row = await takeBackLastSet(loaded.workoutId);
      void useRestTimerStore.getState().stop();
      setLoggedKeys(await getLoggedStepKeys(loaded.workoutId));
      if (row) {
        const undone = undoneFromRow(row);
        const index = steps.findIndex((s) => stepKey(s.blockIndex, s.setNumber) === undone.key);
        if (index >= 0) setCurrentIndex(index);
        setRestored(undone);
      }
      setPhase('logging');
    } finally {
      setSaving(false);
    }
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
        <WarmupChecklist moves={warmupMoves(profile)} onDone={() => setPhase('logging')} />
      ) : null}

      {phase === 'resting' && currentStep ? (
        // Scrolls when the clip makes the screen taller than a small phone.
        <ScrollView contentContainerClassName="flex-grow justify-center p-4">
          <RestTimer
            nextLabel={upcoming?.label ?? null}
            nextExercise={upcoming?.exercise}
            nextNote={upcoming?.note}
            onDone={handleRestDone}
            onUndo={() => void handleUndo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'groupDone' && upcoming ? (
        <ScrollView contentContainerClassName="flex-grow">
          <GroupDoneCard
            exercises={groupDone}
            nextLabel={upcoming.label}
            onNext={handleRestDone}
            onUndo={() => void handleUndo()}
          />
        </ScrollView>
      ) : null}

      {phase === 'logging' && currentStep && effectiveExercise ? (
        <SetLogger
          key={`${currentIndex}-${effectiveExercise.id}`}
          exercise={effectiveExercise}
          block={currentStep.block}
          planned={loaded.plan ? (currentStep.block as PlannedExercise) : undefined}
          setNumber={currentStep.setNumber}
          supersetWith={supersetWith || undefined}
          restore={
            restored?.key === stepKey(currentStep.blockIndex, currentStep.setNumber)
              ? restored.prefill
              : undefined
          }
          totalSets={currentStep.block.sets}
          onSave={handleSaveSet}
          saving={saving}
          calibrations={calibrations}
          onShowDetails={() =>
            router.push({ pathname: '/exercises/[id]', params: { id: effectiveExercise.id } })
          }
        />
      ) : null}

      {phase === 'logging' && templateExercise ? (
        <View className="flex-row justify-center gap-6 border-t border-border py-3">
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
          swappedTo={effectiveExercise?.id !== templateExercise.id ? effectiveExercise : null}
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
              setBlockSwaps((prev) => ({ ...prev, [currentStep.blockIndex]: slotId }));
              void getCurrentBlock().then((block) =>
                block ? setBlockSelection(block.id, slotId, choice.exercise.id) : undefined,
              );
            }
          }}
          onRestore={() => {
            if (!currentStep) return;
            const blockIndex = currentStep.blockIndex;
            setSubstitutes(({ [blockIndex]: _, ...rest }) => rest);
            setSubstituteModalOpen(false);
            const slotId = blockSwaps[blockIndex];
            if (slotId) {
              setBlockSwaps(({ [blockIndex]: _, ...rest }) => rest);
              void getCurrentBlock().then((block) =>
                block ? setBlockSelection(block.id, slotId, templateExercise.id) : undefined,
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
