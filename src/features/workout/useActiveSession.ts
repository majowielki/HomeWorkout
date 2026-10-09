import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  getExcludedExerciseIds,
  getMedicalProfile,
  setExerciseExcluded,
} from '@/db/repositories/profile';
import {
  logSet,
  readSessionState,
  reopenSets,
  type SessionState,
  skipSets,
  undoSet,
} from '@/db/repositories/sessions';
import { type CommandResult, isDone } from '@/domain/commands/result';
import type { SetObservation } from '@/domain/observations/types';
import type { PlannedSet } from '@/domain/plan/plan';
import { buildObservation, type EntryContext, type SetEntry } from '@/domain/observations/entry';
import {
  buildSessionSteps,
  findResumeIndex,
  groupExposureIndices,
  isGroupComplete,
  latestResult,
  nextPendingFrom,
  nextPendingIndex,
  type SessionStep,
} from '@/domain/session/progress';
import type { Exercise, MedicalProfile } from '@/domain/types';
import { describeResult } from '@/features/history/describeSet';
import { planTitle } from '@/features/plan/format';
import { useRestTimerStore } from '@/stores/restTimerStore';
import { pl } from '@/strings/pl';

import type { GroupDoneExercise } from './GroupDoneCard';
import { takeUndone, type UndoneSet } from './undoneSet';

export type Phase = 'loading' | 'warmup' | 'logging' | 'resting' | 'groupDone' | 'notFound';

/** Where a rest ended early stood, so "Cofnij" can bring it back. */
export interface EndedRest {
  phase: 'resting' | 'groupDone';
  index: number;
  remainingMs: number;
}

/** What skipping an exercise did. */
export type SkipOutcome =
  | { kind: 'skipped'; exposureIndex: number; name: string; plannedSetIds: string[] }
  /** Nothing would be left to do: skipping it ends the workout, which asks first. */
  | { kind: 'last' }
  | { kind: 'none' };

/** What the logger hands over when a set is saved: the entry and how the person gave it. */
export interface LoggedEntry {
  entry: SetEntry;
  channel: EntryContext['channel'];
  shown: EntryContext['shown'];
}

/** Everything the session reads and writes outside React; the defaults are the database. */
export interface ActiveSessionDeps {
  readSession: typeof readSessionState;
  getProfile: typeof getMedicalProfile;
  getExcludedExerciseIds: typeof getExcludedExerciseIds;
  setExerciseExcluded: typeof setExerciseExcluded;
  logSet: typeof logSet;
  skipSets: typeof skipSets;
  reopenSets: typeof reopenSets;
  undoSet: typeof undoSet;
  startRest: (seconds: number, notificationBody: string) => Promise<void>;
  /** Adds to the rest running now; a negative amount takes an extension back. */
  extendRest: (seconds: number, notificationBody: string) => Promise<void>;
  stopRest: () => Promise<void>;
  /** When the rest running now ends, or null. */
  restEndsAt: () => number | null;
  now: () => number;
  newId: () => string;
  alert: (message: string) => void;
}

const defaultDeps: ActiveSessionDeps = {
  readSession: readSessionState,
  getProfile: getMedicalProfile,
  getExcludedExerciseIds,
  setExerciseExcluded,
  logSet: logSet,
  skipSets: skipSets,
  reopenSets,
  undoSet: undoSet,
  startRest: (seconds, body) => useRestTimerStore.getState().start(seconds, body),
  extendRest: (seconds, body) => useRestTimerStore.getState().extend(seconds, body),
  stopRest: () => useRestTimerStore.getState().stop(),
  restEndsAt: () => useRestTimerStore.getState().restEndsAt,
  now: Date.now,
  newId: randomUUID,
  alert: (message) => Alert.alert(message),
};

/**
 * The active session: which set is up, what was done, rest and the done card,
 * taking a set back, skipping an exercise. Everything that happened is read
 * back from the database after each command, never trusted from memory, so a
 * killed app resumes where it was; this hook keeps only where the person is.
 * The route only draws.
 */
export function useActiveSession(
  id: string,
  exerciseMap: Readonly<Record<string, Exercise>>,
  deps: ActiveSessionDeps = defaultDeps,
) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionState | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [profile, setProfile] = useState<MedicalProfile>({ knee: null });
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // A set taken back with "Cofnij serię": its step shows the recorded numbers again.
  const [restored, setRestored] = useState<UndoneSet | null>(null);
  // The revision every command is checked against: what the last read of the session said.
  const revision = useRef(0);

  const steps = useMemo(
    () => (session ? buildSessionSteps(session.plan, session.states) : []),
    [session],
  );

  /** Reads the session again; the steps the new state makes are returned for the caller to act on. */
  function reload(): { state: SessionState; steps: SessionStep[] } | null {
    const state = deps.readSession(id);
    if (state === null) {
      setPhase('notFound');
      return null;
    }
    revision.current = state.workout.revision;
    setSession(state);
    return { state, steps: buildSessionSteps(state.plan, state.states) };
  }

  // Initial load: the session, then where to resume.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const state = deps.readSession(id);
      if (state === null || state.workout.status !== 'in_progress') {
        if (!cancelled) setPhase('notFound');
        return;
      }
      const built = buildSessionSteps(state.plan, state.states);
      const resumeIndex = findResumeIndex(built);
      const [medical, excluded] = await Promise.all([
        deps.getProfile(),
        deps.getExcludedExerciseIds(),
      ]);

      if (cancelled) return;

      if (resumeIndex >= built.length) {
        router.replace({ pathname: '/workout/summary/[id]', params: { id, back: 'undo' } });
        return;
      }
      revision.current = state.workout.revision;
      setSession(state);
      setProfile(medical);
      setExcludedIds(new Set(excluded));
      // Back from the summary with the last set taken back: open on that set.
      const undone = takeUndone(id);
      const undoneIndex = undone ? built.findIndex((s) => s.set.id === undone.plannedSetId) : -1;
      if (undone && undoneIndex >= 0) {
        setCurrentIndex(undoneIndex);
        setRestored(undone);
        setPhase('logging');
      } else {
        setCurrentIndex(resumeIndex);
        // A fresh session opens on the general warm-up; the bike is its own task on 'Dziś'.
        setPhase(resumeIndex === 0 && state.states.size === 0 ? 'warmup' : 'logging');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // The dependencies are fixed for the screen's life; reading them again would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  const currentStep: SessionStep | null = steps[currentIndex] ?? null;
  const exerciseOf = (step: SessionStep): Exercise | undefined =>
    exerciseMap[step.exposure.exercise.id];
  const exercise = currentStep ? exerciseOf(currentStep) : undefined;
  const title = session ? planTitle(session.plan) : '';

  /** What the rest is for: the next step to do from here, wrapping round. */
  function upcomingStep() {
    if ((phase !== 'resting' && phase !== 'groupDone') || !session) return null;
    const index = nextPendingFrom(steps, currentIndex);
    const step = index === null ? undefined : steps[index];
    if (!step) return null;
    const next = exerciseOf(step);
    const current = steps[currentIndex];
    const t = pl.workout.session;
    const sameGroup =
      current !== undefined &&
      current.exposureIndex !== step.exposureIndex &&
      groupExposureIndices(session.plan, step.exposureIndex).includes(current.exposureIndex);
    const otherSide = current?.exposureIndex === step.exposureIndex && step.side !== null;
    const name = next?.name ?? step.exposure.exercise.displayName;
    return {
      exposureIndex: step.exposureIndex,
      exercise: next ?? null,
      label: `${step.label} · ${name}${step.side ? ` — ${t.side[step.side]}` : ''}`,
      note: sameGroup ? t.supersetNext : otherSide ? t.otherSideNext : null,
    };
  }
  const upcoming = upcomingStep();

  // "Superseria z: …" on the set screen, naming the other halves of the group.
  const supersetWith =
    currentStep && session
      ? groupExposureIndices(session.plan, currentStep.exposureIndex)
          .filter(
            (i) =>
              i !== currentStep.exposureIndex &&
              steps.some((s) => s.exposureIndex === i && s.state !== 'skipped'),
          )
          .map((i) => session.plan.exposures[i]!)
          .map((e) => exerciseMap[e.exercise.id]?.name ?? e.exercise.displayName)
          .join(', ')
      : '';

  /** What was done in the exercise or superset the person is on, set by set, for the done card. */
  function doneInGroup(): GroupDoneExercise[] {
    if (phase !== 'groupDone' || !currentStep || !session) return [];
    return groupExposureIndices(session.plan, currentStep.exposureIndex).map((i) => {
      const exposure = session.plan.exposures[i]!;
      const sets = steps
        .filter((s) => s.exposureIndex === i)
        .flatMap((s) => {
          const result = session.results.get(s.set.id);
          return result ? [describeResult(result.observation)] : [];
        });
      return {
        name: exerciseMap[exposure.exercise.id]?.name ?? exposure.exercise.displayName,
        sets,
      };
    });
  }

  const unfinishedCount = steps.filter((s) => s.state === 'pending').length;

  /** The result of the set before this one in the same exercise: what the next set starts from. */
  function previousInExposure(): { observation: SetObservation; planned: PlannedSet } | null {
    if (!currentStep || !session) return null;
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
      const step = steps[i]!;
      const result =
        step.exposureIndex === currentStep.exposureIndex
          ? session.results.get(step.set.id)
          : undefined;
      if (result) return { observation: result.observation, planned: step.set };
    }
    return null;
  }
  const previous = previousInExposure();

  /**
   * Sends a command made from the revision the session had when it was read. When the session moved on
   * under it (the voice and the touch screen are both writing), it is read again and sent once more.
   */
  function send<T>(
    command: (expectedSessionRevision: number) => CommandResult<T>,
  ): CommandResult<T> {
    let result = command(revision.current);
    if (result.kind === 'conflict' && result.code === 'SESSION_CHANGED') {
      reload();
      result = command(revision.current);
    }
    return result;
  }

  /**
   * `back` tells the summary what "Wróć do treningu" does there: take the
   * last set back when everything is done (the last tap may have been a
   * mistake), or simply return when the workout was finished early.
   */
  function finish(back: 'undo' | 'resume' = 'undo') {
    // A rest still running would ring "back to training" after the workout ended.
    void deps.stopRest();
    router.replace({ pathname: '/workout/summary/[id]', params: { id, back } });
  }

  async function saveSet({ entry, channel, shown }: LoggedEntry) {
    if (!session || !currentStep || saving) return;
    if (currentStep.state === 'performed' || currentStep.state === 'interrupted') return;

    setSaving(true);
    let after: NonNullable<ReturnType<typeof reload>>;
    try {
      const at = new Date(deps.now()).toISOString();
      const observation = buildObservation(entry, { channel, shown, at });
      const commandId = deps.newId();
      const result = send((expectedSessionRevision) =>
        deps.logSet({
          commandId,
          sessionId: id,
          plannedSetId: currentStep.set.id,
          expectedSessionRevision,
          observation,
        }),
      );
      if (!isDone(result)) {
        // The logger keeps its numbers; the person can save again.
        console.warn('could not log the set', result);
        deps.alert(pl.workout.session.saveSetError);
        return;
      }
      const fresh = reload();
      if (fresh === null) return;
      after = fresh;
      setRestored(null);
    } finally {
      setSaving(false);
    }

    // Nothing left anywhere in the session (not just after this index) —
    // the person may have jumped around, so scan the whole list.
    if (nextPendingIndex(after.steps, 0) === null) {
      finish();
      return;
    }

    if (
      isGroupComplete(
        after.steps,
        groupExposureIndices(after.state.plan, currentStep.exposureIndex),
      )
    ) {
      // The exercise (or the whole superset) is done: show what was done and
      // let the person move on when ready, instead of a rest countdown.
      setPhase('groupDone');
      return;
    }
    const rest = currentStep.set.restAfterSec;
    if (rest <= 0) {
      setCurrentIndex(nextPendingFrom(after.steps, currentIndex) ?? currentIndex);
      return;
    }
    await deps.startRest(rest, pl.workout.session.restNotificationBody);
    setPhase('resting');
  }

  function restDone() {
    // Synchronous first so RestTimer unmounts immediately and its own
    // interval stops, before the async store cleanup below resolves.
    setPhase('logging');
    // Advance to the next step that still needs doing. "index + 1" is not
    // safe once the person has jumped around via the progress sheet.
    const next = nextPendingFrom(steps, currentIndex);
    if (next === null) {
      finish();
    } else {
      setCurrentIndex(next);
    }
    void deps.stopRest();
  }

  /**
   * "Koniec przerwy" by voice: the same as the button, but it remembers the
   * rest it cut short, so "Cofnij" can put it back.
   */
  function endRest(): EndedRest | null {
    if (phase !== 'resting' && phase !== 'groupDone') return null;
    const endsAt = deps.restEndsAt();
    const ended: EndedRest = {
      phase,
      index: currentIndex,
      remainingMs: phase === 'resting' && endsAt !== null ? Math.max(0, endsAt - deps.now()) : 0,
    };
    restDone();
    return ended;
  }

  /** Back to the rest "Koniec przerwy" cut short, with the time it still had. */
  function resumeRest(ended: EndedRest) {
    setCurrentIndex(ended.index);
    if (ended.phase === 'groupDone') {
      setPhase('groupDone');
    } else if (ended.remainingMs >= 1000) {
      void deps.startRest(
        Math.round(ended.remainingMs / 1000),
        pl.workout.session.restNotificationBody,
      );
      setPhase('resting');
    } else {
      // The rest had run out anyway; the next set is where it would have led.
      setPhase('logging');
      const next = nextPendingFrom(steps, ended.index);
      if (next !== null) setCurrentIndex(next);
    }
  }

  /** "+30 s", or any other amount; a negative one takes an extension back. */
  function extendRest(seconds: number): boolean {
    if (phase !== 'resting') return false;
    void deps.extendRest(seconds, pl.workout.session.restNotificationBody);
    return true;
  }

  /**
   * "Pomiń ćwiczenie": during a set, the exercise on screen; during a rest
   * or on the done card, the one coming up. Its sets still to do are passed
   * over, and the next exercise opens at once, without a rest. Skipping the
   * last thing left would end the workout, so that is only reported; the
   * screen asks before finishing.
   */
  function skipExercise(): SkipOutcome {
    const exposureIndex =
      phase === 'logging'
        ? currentStep?.exposureIndex
        : phase === 'resting' || phase === 'groupDone'
          ? upcoming?.exposureIndex
          : undefined;
    if (exposureIndex === undefined) return { kind: 'none' };
    const skipped = steps.filter((s) => s.exposureIndex === exposureIndex && s.state === 'pending');
    const left = steps.filter((s) => s.exposureIndex !== exposureIndex);
    if (nextPendingIndex(left, 0) === null) return { kind: 'last' };
    const commandId = deps.newId();
    const result = send((expectedSessionRevision) =>
      deps.skipSets({
        commandId,
        sessionId: id,
        plannedSetIds: skipped.map((s) => s.set.id),
        reason: 'user_skipped',
        expectedSessionRevision,
      }),
    );
    if (!isDone(result)) {
      console.warn('could not skip the exercise', result);
      deps.alert(pl.common.error);
      return { kind: 'none' };
    }
    const fresh = reload();
    if (fresh === null) return { kind: 'none' };
    setRestored(null);
    setCurrentIndex(nextPendingFrom(fresh.steps, currentIndex) ?? currentIndex);
    setPhase('logging');
    void deps.stopRest();
    const name =
      exerciseMap[steps.find((s) => s.exposureIndex === exposureIndex)!.exposure.exercise.id]
        ?.name ??
      steps.find((s) => s.exposureIndex === exposureIndex)!.exposure.exercise.displayName;
    return { kind: 'skipped', exposureIndex, name, plannedSetIds: skipped.map((s) => s.set.id) };
  }

  /** Takes a skip back: the exercise opens again on its first set still to do. */
  function unskip(outcome: Extract<SkipOutcome, { kind: 'skipped' }>) {
    const commandId = deps.newId();
    const result = deps.reopenSets({
      commandId,
      sessionId: id,
      plannedSetIds: outcome.plannedSetIds,
    });
    if (!isDone(result)) {
      console.warn('could not take the skip back', result);
      deps.alert(pl.common.error);
      return;
    }
    const fresh = reload();
    if (fresh === null) return;
    const first = fresh.steps.findIndex(
      (s) => s.exposureIndex === outcome.exposureIndex && s.state === 'pending',
    );
    if (first >= 0) setCurrentIndex(first);
    void deps.stopRest();
    setPhase('logging');
  }

  /**
   * "Cofnij serię" on the rest timer or the done card: the set just done is
   * taken back and its step opens again with the recorded numbers in it.
   */
  function undo(plannedSetId?: string) {
    if (!session || saving) return;
    const last = latestResult(session.results.values());
    if (last === null) return;
    // "Cofnij" offered for a set that is no longer the last one would take back another set.
    if (plannedSetId !== undefined && last.observation.plannedSetId !== plannedSetId) {
      deps.alert(pl.workout.session.undoStale);
      return;
    }
    setSaving(true);
    try {
      const commandId = deps.newId();
      const result = deps.undoSet({ commandId, sessionId: id, observationId: last.id });
      if (!isDone(result)) {
        console.warn('could not take the set back', result);
        deps.alert(pl.workout.session.undoError);
        return;
      }
      void deps.stopRest();
      const fresh = reload();
      if (fresh === null) return;
      const index = fresh.steps.findIndex((s) => s.set.id === last.observation.plannedSetId);
      if (index >= 0) setCurrentIndex(index);
      setRestored({ plannedSetId: last.observation.plannedSetId!, result: last.observation });
      setPhase('logging');
    } finally {
      setSaving(false);
    }
  }

  /** From the progress sheet: straight to a step not done yet. */
  function jump(index: number) {
    void deps.stopRest();
    const target = steps[index];
    // Going to a skipped exercise is changing one's mind about it.
    if (target?.state === 'skipped') {
      const skipped = steps.filter(
        (s) => s.exposureIndex === target.exposureIndex && s.state === 'skipped',
      );
      const reopened = deps.reopenSets({
        commandId: deps.newId(),
        sessionId: id,
        plannedSetIds: skipped.map((s) => s.set.id),
      });
      if (!isDone(reopened)) {
        // The exercise stays skipped: opening it would show a set that cannot be saved.
        console.warn('could not reopen the exercise', reopened);
        deps.alert(pl.common.error);
        return;
      }
      reload();
    }
    setCurrentIndex(index);
    setPhase('logging');
  }

  /** The plan changed under the session (a swap, an added exercise): read it again and open on what is next. */
  function planChanged() {
    const fresh = reload();
    if (fresh === null) return;
    void deps.stopRest();
    setCurrentIndex(nextPendingFrom(fresh.steps, 0) ?? 0);
    setRestored(null);
    setPhase('logging');
  }

  function exclude(excluded: Exercise) {
    void deps.setExerciseExcluded(excluded.id, true).catch((error: unknown) => {
      console.warn('could not save the exclusion', error);
      deps.alert(pl.common.error);
    });
    setExcludedIds((prev) => new Set(prev).add(excluded.id));
  }

  return {
    phase,
    session,
    title,
    steps,
    currentIndex,
    currentStep,
    profile,
    excludedIds,
    saving,
    groupDone: doneInGroup(),
    upcoming,
    exercise,
    previousResult: previous?.observation ?? null,
    /** What the plan asked of that set: the logger keeps its load only for a set that asks the same. */
    previousPlanned: previous?.planned ?? null,
    supersetWith,
    unfinishedCount,
    /** A set taken back, until it is saved again. */
    restored,
    warmupDone: () => setPhase('logging'),
    /** "Cofnij" after the warm-up was ended by voice. */
    backToWarmup: () => setPhase('warmup'),
    saveSet,
    restDone,
    endRest,
    resumeRest,
    extendRest,
    skipExercise,
    unskip,
    undo,
    jump,
    finish,
    planChanged,
    exclude,
  };
}
