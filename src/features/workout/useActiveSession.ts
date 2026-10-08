import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

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
import type { SessionPlan } from '@/domain/plan/types';
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
import type { Exercise, MedicalProfile, TemplateBlock } from '@/domain/types';
import { describeSet } from '@/features/history/describeSet';
import { planTitle } from '@/features/plan/format';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

import type { GroupDoneExercise } from './GroupDoneCard';
import type { SavedSetData } from './SetLogger';
import { sessionSides } from './sessionSides';
import type { SubstituteChoice } from './SubstituteModal';
import { takeUndone, type UndoneSet, undoneFromRow } from './undoneSet';

export type Phase = 'loading' | 'warmup' | 'logging' | 'resting' | 'groupDone' | 'notFound';

export type LoadedSession = {
  workoutId: string;
  trainingDate: string;
  title: string;
  /** The engine's plan the session was started from; null for a template session. */
  plan: SessionPlan | null;
  /** What the steps are built from: the plan's exercises or the template's blocks. */
  blocks: readonly TemplateBlock[];
};

/** Everything the session reads and writes outside React; the defaults are the database. */
export interface ActiveSessionDeps {
  getWorkout: typeof getWorkout;
  getTemplate: typeof getTemplate;
  getProfile: typeof getProfile;
  getExcludedExerciseIds: typeof getExcludedExerciseIds;
  setExerciseExcluded: typeof setExerciseExcluded;
  getLoggedStepKeys: typeof getLoggedStepKeys;
  getSetsForWorkout: typeof getSetsForWorkout;
  logSet: typeof logSet;
  takeBackLastSet: typeof takeBackLastSet;
  getCurrentBlock: typeof getCurrentBlock;
  setBlockSelection: typeof setBlockSelection;
  startRest: (seconds: number, notificationBody: string) => Promise<void>;
  stopRest: () => Promise<void>;
  alert: (message: string) => void;
}

const defaultDeps: ActiveSessionDeps = {
  getWorkout,
  getTemplate,
  getProfile,
  getExcludedExerciseIds,
  setExerciseExcluded,
  getLoggedStepKeys,
  getSetsForWorkout,
  logSet,
  takeBackLastSet,
  getCurrentBlock,
  setBlockSelection,
  startRest: (seconds, body) => useRestTimerStore.getState().start(seconds, body),
  stopRest: () => useRestTimerStore.getState().stop(),
  alert: (message) => Alert.alert(message),
};

/**
 * The active session (IMPLEMENTACJA §2.3): which step is up, what was logged,
 * rest and the done card, taking a set back, swaps for the session or the
 * block. Progress is always read back from set_logs, never trusted from
 * memory (SPEC §7.1), so a killed app resumes where it was. The route only draws.
 */
export function useActiveSession(
  id: string,
  exerciseMap: Readonly<Record<string, Exercise>>,
  deps: ActiveSessionDeps = defaultDeps,
) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [steps, setSteps] = useState<SessionStep[]>([]);
  const [loggedKeys, setLoggedKeys] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profile, setProfile] = useState<MedicalProfile>({ knee: null });
  // blockIndex -> exercise swapped in for the rest of this session.
  const [substitutes, setSubstitutes] = useState<Record<number, string>>({});
  // blockIndex -> slot whose block selection the swap also changed, so a restore can undo it.
  const [blockSwaps, setBlockSwaps] = useState<Record<number, string>>({});
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // What the just-finished exercise or superset looked like, for the groupDone card.
  const [groupDone, setGroupDone] = useState<GroupDoneExercise[]>([]);
  // A set taken back with "Cofnij serię": its step shows the logged numbers again.
  const [restored, setRestored] = useState<UndoneSet | null>(null);

  // Initial load: workout -> template -> steps -> where to resume.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const workout = await deps.getWorkout(id);
      const plan = workout?.plan ?? null;
      const template =
        workout && !plan && workout.templateId ? await deps.getTemplate(workout.templateId) : null;
      if (!workout || (!plan && !template)) {
        if (!cancelled) setPhase('notFound');
        return;
      }

      const profileRow = await deps.getProfile();
      const knee: MedicalProfile = { knee: profileRow?.kneeProfile ?? null };
      const blocks = plan ? plan.exercises : template!.blocks;
      const builtSteps = buildSessionSteps(blocks, { sidesOf: sessionSides(knee) });
      const keys = await deps.getLoggedStepKeys(id);
      const resumeIndex = findResumeIndex(builtSteps, keys);
      const excluded = await deps.getExcludedExerciseIds();
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
        blocks,
      });
      setSteps(builtSteps);
      setLoggedKeys(keys);
      setProfile(knee);
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
    // The dependencies are fixed for the screen's life; reading them again would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  const currentStep = steps[currentIndex] ?? null;
  const templateExercise = currentStep ? exerciseMap[currentStep.block.exerciseId] : undefined;
  const effectiveExercise: Exercise | undefined = currentStep
    ? (exerciseMap[substitutes[currentStep.blockIndex] ?? ''] ?? templateExercise)
    : undefined;

  // What the rest is for. Mirrors restDone — the first unlogged step from
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
    const t = pl.workout.session;
    const otherSide = current?.blockIndex === step.blockIndex && step.side !== null;
    const name = exercise?.name ?? step.block.exerciseId;
    return {
      exercise: exercise ?? null,
      label: `${step.block.label} · ${name}${step.side ? ` — ${t.side[step.side]}` : ''}`,
      note: supersetSwitch ? t.supersetNext : otherSide ? t.otherSideNext : null,
    };
  }, [phase, steps, loggedKeys, currentIndex, substitutes, exerciseMap]);

  /**
   * A swap can change whether the exercise is done one side per set, and so
   * how many steps its block has. While nothing of the block is logged its
   * steps are built again for the exercise now done; once a set is logged
   * the layout stays as it is.
   */
  function resplit(blockIndex: number, swaps: Record<number, string>) {
    if (!loaded) return;
    const touched = steps.some(
      (s) => s.blockIndex === blockIndex && loggedKeys.has(stepKey(s.blockIndex, s.setNumber)),
    );
    if (touched) return;
    const next = buildSessionSteps(loaded.blocks, { sidesOf: sessionSides(profile, swaps) });
    setSteps(next);
    const first = next.findIndex((s) => s.blockIndex === blockIndex);
    if (first >= 0) setCurrentIndex(first);
  }

  /** "For the rest of the block": the session already uses the swap; a failed write says so. */
  function saveBlockChoice(slotId: string, exerciseId: string) {
    void deps
      .getCurrentBlock()
      .then((block) => (block ? deps.setBlockSelection(block.id, slotId, exerciseId) : undefined))
      .catch((error: unknown) => {
        console.warn('could not save the swap for the block', error);
        deps.alert(pl.workout.session.blockSwapError);
      });
  }

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

  const unloggedCount = steps.filter(
    (s) => !loggedKeys.has(stepKey(s.blockIndex, s.setNumber)),
  ).length;

  /**
   * `back` tells the summary what "Wróć do treningu" does there: take the
   * last set back when everything is logged (the last tap may have been a
   * mistake), or simply return when the workout was finished early.
   */
  function finish(back: 'undo' | 'resume' = 'undo') {
    if (!loaded) return;
    // A rest still running would ring "back to training" after the workout ended.
    void deps.stopRest();
    router.replace({
      pathname: '/workout/summary/[id]',
      params: { id: loaded.workoutId, back },
    });
  }

  /** The finished exercise or superset, set by set, for the groupDone card. */
  async function loadGroupDone(workoutId: string, blockIndex: number) {
    const rows = await deps.getSetsForWorkout(workoutId);
    const exercises: GroupDoneExercise[] = groupBlockIndices(steps, blockIndex).map((i) => {
      const done = rows
        .filter((r) => r.exerciseOrder === i && !r.isWarmup)
        .sort((a, b) => a.setIndex - b.setIndex);
      const exerciseId = done[0]?.exerciseId ?? exerciseFor(i)?.id ?? '';
      return { name: exerciseMap[exerciseId]?.name ?? exerciseId, sets: done.map(describeSet) };
    });
    setGroupDone(exercises);
  }

  async function saveSet(data: SavedSetData) {
    if (!loaded || !currentStep || !effectiveExercise || saving) return;

    // The progress sheet only allows jumping onto unlogged steps, but this
    // is the last line of defence against a duplicate (blockIndex, setNumber)
    // row — which would corrupt resume and every future progression read.
    const key = stepKey(currentStep.blockIndex, currentStep.setNumber);
    if (loggedKeys.has(key)) return;

    setSaving(true);
    let freshKeys = loggedKeys;
    try {
      await deps.logSet({
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
        side: currentStep.side,
        shortfall: data.shortfall,
      });
      freshKeys = await deps.getLoggedStepKeys(loaded.workoutId);
      setLoggedKeys(freshKeys);
      setRestored(null);
    } catch (error) {
      // The logger keeps its numbers; the person can save again.
      console.warn('could not log the set', error);
      deps.alert(pl.workout.session.saveSetError);
      return;
    } finally {
      setSaving(false);
    }

    // Nothing left anywhere in the session (not just after this index) —
    // the user may have jumped around, so scan the whole list.
    if (nextUnloggedIndex(steps, freshKeys, 0) === null) {
      finish();
      return;
    }

    if (isGroupComplete(steps, freshKeys, currentStep.blockIndex)) {
      // The exercise (or the whole superset) is done: show what was done and
      // let the person move on when ready, instead of a rest countdown.
      await loadGroupDone(loaded.workoutId, currentStep.blockIndex);
      setPhase('groupDone');
      return;
    }
    await deps.startRest(currentStep.block.restSec, pl.workout.session.restNotificationBody);
    setPhase('resting');
  }

  function restDone() {
    // Synchronous first so RestTimer unmounts immediately and its own
    // interval stops, before the async store cleanup below resolves.
    setPhase('logging');
    // Advance to the next step that still needs a log. "index + 1" is not
    // safe once the user has jumped around via the progress sheet.
    const next =
      nextUnloggedIndex(steps, loggedKeys, currentIndex) ?? nextUnloggedIndex(steps, loggedKeys, 0);
    if (next === null) {
      finish();
    } else {
      setCurrentIndex(next);
    }
    void deps.stopRest();
  }

  /**
   * "Cofnij serię" on the rest timer or the done card: the set just logged
   * is deleted and its step opens again with the logged numbers in it.
   */
  async function undo() {
    if (!loaded || saving) return;
    setSaving(true);
    try {
      const row = await deps.takeBackLastSet(loaded.workoutId);
      void deps.stopRest();
      setLoggedKeys(await deps.getLoggedStepKeys(loaded.workoutId));
      if (row) {
        const undone = undoneFromRow(row);
        const index = steps.findIndex((s) => stepKey(s.blockIndex, s.setNumber) === undone.key);
        if (index >= 0) setCurrentIndex(index);
        setRestored(undone);
      }
      setPhase('logging');
    } catch (error) {
      console.warn('could not take the set back', error);
      deps.alert(pl.workout.session.undoError);
    } finally {
      setSaving(false);
    }
  }

  /** From the progress sheet: straight to an unlogged step. */
  function jump(index: number) {
    void deps.stopRest();
    setCurrentIndex(index);
    setPhase('logging');
  }

  function substitute(choice: SubstituteChoice) {
    if (!currentStep) return;
    const swaps = { ...substitutes, [currentStep.blockIndex]: choice.exercise.id };
    setSubstitutes(swaps);
    resplit(currentStep.blockIndex, swaps);
    if (choice.forBlock && choice.slotId) {
      const slotId = choice.slotId;
      setBlockSwaps((prev) => ({ ...prev, [currentStep.blockIndex]: slotId }));
      saveBlockChoice(slotId, choice.exercise.id);
    }
  }

  /** Back to the planned exercise; a swap for the block is undone with it. */
  function restoreSubstitute() {
    if (!currentStep || !templateExercise) return;
    const blockIndex = currentStep.blockIndex;
    const { [blockIndex]: _, ...swaps } = substitutes;
    setSubstitutes(swaps);
    resplit(blockIndex, swaps);
    const slotId = blockSwaps[blockIndex];
    if (slotId) {
      setBlockSwaps(({ [blockIndex]: _, ...rest }) => rest);
      saveBlockChoice(slotId, templateExercise.id);
    }
  }

  function exclude(exercise: Exercise) {
    void deps.setExerciseExcluded(exercise.id, true).catch((error: unknown) => {
      console.warn('could not save the exclusion', error);
      deps.alert(pl.common.error);
    });
    setExcludedIds((prev) => new Set(prev).add(exercise.id));
  }

  return {
    phase,
    loaded,
    steps,
    loggedKeys,
    currentIndex,
    currentStep,
    profile,
    excludedIds,
    saving,
    groupDone,
    restored,
    upcoming,
    templateExercise,
    effectiveExercise,
    supersetWith,
    unloggedCount,
    warmupDone: () => setPhase('logging'),
    saveSet,
    restDone,
    undo,
    jump,
    finish,
    substitute,
    restoreSubstitute,
    exclude,
  };
}
