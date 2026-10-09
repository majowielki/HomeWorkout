import * as Haptics from 'expo-haptics';
import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { ymoveMedia } from '@/assets/ymove-media';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Info } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { BANDS } from '@/domain/inventory';
import { readBackText } from '@/domain/observations/entry';
import type { SetObservation } from '@/domain/observations/types';
import type { SessionStep } from '@/domain/session/progress';
import {
  entryOf,
  isBelowTarget,
  isTimed,
  ladderFor,
  type SetFieldValues,
  suggestedValues,
  usesBand,
  usesDumbbell,
} from '@/domain/session/setEntry';
import type { ParameterCommand } from '@/domain/voice/parameters';
import type { BandCalibrationMap, Exercise } from '@/domain/types';
import { ExerciseThumb } from '@/features/exercises/ExerciseThumb';
import { ExerciseVideo } from '@/features/exercises/ExerciseVideo';
import { GlossaryButton } from '@/features/glossary/GlossaryButton';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';
import type { VoiceFeedback } from '@/features/voice/useVoiceCommands';

import { effortLabel, SetFields } from './SetFields';
import { Stopwatch, type StopwatchHandle } from './Stopwatch';
import type { LoggedEntry } from './useActiveSession';

/** What a voice command can do on the set screen; each is the same as its button. */
export interface SetLoggerHandle {
  /**
   * "Seria zrobiona": a running stopwatch is stopped first and its time is the one saved. Answers
   * with the line that reads the set back, or null when it could not be saved.
   */
  save(): string | null;
  startStopwatch(): boolean;
  /** The seconds held, or null when it was not running. */
  stopStopwatch(): number | null;
  /** Takes the last stopwatch start or stop back. */
  revertStopwatch(): void;
  /** Edits only fields offered by this exercise; undo belongs to this mounted set. */
  setParameter(command: ParameterCommand): VoiceFeedback | null;
}

type Props = {
  exercise: Exercise;
  /** The set to do, with its place in the exercise and in the superset. */
  step: SessionStep;
  /** The result of the set before this one in the exercise, which the suggestion follows. */
  previous?: SetObservation | null;
  /** The numbers of a set just taken back ("Cofnij serię"): shown again for a correction. */
  restore?: SetFieldValues;
  onSave: (logged: LoggedEntry) => void;
  saving?: boolean;
  calibrations?: BandCalibrationMap;
  /** Opens the exercise's full description; the link only shows next to a clip. */
  onShowDetails?: () => void;
  /** Names of the other exercises in this superset; absent for a lone exercise. */
  supersetWith?: string;
  /** A timed set's stopwatch started or stopped. */
  onStopwatchChange?: (running: boolean) => void;
  ref?: Ref<SetLoggerHandle>;
};

/**
 * The set screen. It starts from what the plan prescribes for the set — or, after a
 * set of the same exercise, from the load and effort the person gave — and hands over
 * an entry that says which of the numbers they changed.
 */
export function SetLogger({
  exercise,
  step,
  previous = null,
  restore,
  onSave,
  saving,
  calibrations,
  onShowDetails,
  supersetWith,
  onStopwatchChange,
  ref,
}: Props) {
  const { set } = step;
  const stopwatch = useRef<StopwatchHandle>(null);
  const [suggested] = useState(() => suggestedValues(exercise, set, previous));
  const [values, setValues] = useState<SetFieldValues>(() => restore ?? suggested);
  const below = isBelowTarget(exercise, values, set.target);
  // A band is stiffer for its first few stretches (Mullins effect, SPEC
  // §5.6): the plan asks for a few stretches first instead of a logged warm-up set.
  const bandPrestretch = step.cues.includes('BAND_WARMUP');

  /** A confirmed form is the suggestion confirmed, with what the person changed noted; a spoken one is read back. */
  const handleSave = (current: SetFieldValues, channel: LoggedEntry['channel']): string => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const entry = entryOf(exercise, set, current, suggested);
    onSave({
      entry,
      channel,
      shown:
        channel === 'voice'
          ? { amount: 'read_back', rir: 'read_back' }
          : { amount: 'visible', resistance: 'visible', rir: 'visible' },
    });
    return readBackText(entry);
  };

  useImperativeHandle(ref, () => ({
    save() {
      if (saving) return null;
      const seconds = stopwatch.current?.stop() ?? null;
      return handleSave(seconds === null ? values : { ...values, timeSec: seconds }, 'voice');
    },
    startStopwatch: () => stopwatch.current?.start() ?? false,
    stopStopwatch: () => stopwatch.current?.stop() ?? null,
    revertStopwatch: () => stopwatch.current?.revert(),
    setParameter(command) {
      if (saving) return null;
      let patch: Partial<SetFieldValues>;
      let text: string;
      switch (command.action) {
        case 'set_reps':
          if (
            isTimed(exercise) ||
            !Number.isInteger(command.reps) ||
            command.reps < 1 ||
            command.reps > 999
          )
            return null;
          patch = { reps: command.reps };
          text = pl.voice.done.reps(command.reps);
          break;
        case 'set_time':
          if (
            !isTimed(exercise) ||
            !Number.isInteger(command.seconds) ||
            command.seconds < 1 ||
            command.seconds > 3600 ||
            stopwatch.current?.isRunning()
          )
            return null;
          patch = { timeSec: command.seconds };
          text = pl.voice.done.time(command.seconds);
          break;
        case 'set_weight':
          if (!usesDumbbell(exercise) || !ladderFor(exercise).includes(command.kg)) return null;
          patch = { weightKg: command.kg };
          text = pl.voice.done.weight(command.kg);
          break;
        case 'set_band': {
          const band = BANDS.find((b) => b.id === command.bandId);
          if (!usesBand(exercise) || !band) return null;
          patch = { bandId: band.id };
          text = pl.voice.done.band(band.label);
          break;
        }
        case 'set_position':
          if (!usesBand(exercise) || ![0, 1, 2, 3].includes(command.position)) return null;
          patch = { position: command.position };
          text = pl.voice.done.position(command.position);
          break;
        case 'set_effort':
          if (!Number.isInteger(command.rir) || command.rir < 0 || command.rir > 4) return null;
          patch = { rir: command.rir };
          text = pl.voice.done.effort(effortLabel(command.rir));
          break;
      }
      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [key, values[key as keyof SetFieldValues]]),
      );
      setValues((v) => ({ ...v, ...patch }));
      return { text, undo: () => setValues((v) => ({ ...v, ...before })) };
    },
  }));

  const hasClip = ymoveMedia[exercise.id] !== undefined;
  const { width, height } = useWindowDimensions();
  const wide = width > height;

  const heading = (
    <View className="flex-1 gap-1">
      <Text variant="eyebrow" className="text-highlight">
        {step.label} · {pl.workout.session.setOf(step.round, step.rounds)}
      </Text>
      {step.side ? (
        <View className="self-start rounded-full bg-foreground px-3 py-1">
          <Text className="font-display-semibold text-sm uppercase tracking-wider text-background">
            {pl.workout.session.side[step.side]}
          </Text>
        </View>
      ) : null}
      <Text variant="title" className="leading-8">
        {exercise.name}
      </Text>
    </View>
  );

  const targets = (
    <View className="flex-row flex-wrap gap-2">
      <Badge variant="outline" label={targetLabel(set.target)} />
      {set.targetRir ? (
        <Badge
          variant="outline"
          label={pl.workout.session.targetEffort(
            effortLabel(set.targetRir.min),
            effortLabel(set.targetRir.max),
          )}
        />
      ) : null}
    </View>
  );

  const details = onShowDetails ? (
    <Pressable onPress={onShowDetails} hitSlop={8} accessibilityRole="link">
      <Text className="font-display-semibold text-highlight">
        {pl.workout.session.exerciseDetails}
      </Text>
    </Pressable>
  ) : null;

  const progress = (
    <View className="flex-row gap-2">
      <SetProgress current={step.stepOfExposure} total={step.stepsInExposure} />
    </View>
  );

  // Notes and controls, the same in both orientations.
  const notes = (
    <>
      {exercise.sides === 'alternating' ? (
        <Text className="text-sm leading-5">{pl.workout.session.alternatingSides}</Text>
      ) : null}
      {supersetWith ? (
        <View className="rounded-2xl border border-border p-4">
          <Text className="text-sm leading-5">{pl.workout.session.supersetWith(supersetWith)}</Text>
        </View>
      ) : null}

      {exercise.kneeCue ? (
        <View className="flex-row gap-3 rounded-2xl bg-secondary p-4">
          <Info size={18} className="mt-0.5 text-highlight" />
          <Text className="flex-1 text-sm leading-5 text-secondary-foreground">
            {exercise.kneeCue}
          </Text>
        </View>
      ) : null}

      {bandPrestretch ? (
        <Text variant="muted" className="text-sm leading-5">
          {pl.workout.session.bandPrestretch}
        </Text>
      ) : null}
    </>
  );

  const controls = (
    <>
      {isTimed(exercise) ? (
        <Stopwatch
          ref={stopwatch}
          targetSec={set.target.kind === 'duration' ? set.target.targetSec : undefined}
          onRunningChange={onStopwatchChange}
          onStop={(seconds) => setValues((v) => ({ ...v, timeSec: seconds }))}
        />
      ) : null}

      <SetFields
        exercise={exercise}
        values={values}
        onChange={setValues}
        calibrations={calibrations}
        shortfall={below ? 'below' : undefined}
      />

      <Button
        label={pl.workout.session.saveSet}
        size="lg"
        onPress={() => handleSave(values, 'touch')}
        disabled={saving}
      />
    </>
  );

  if (wide) {
    // A phone on its side: the clip fills the height on the left, then what
    // to do, then the set itself — no scrolling to reach the button.
    return (
      <View className="flex-1 flex-row gap-5 px-5 py-3">
        {hasClip ? (
          <ExerciseVideo
            exerciseId={exercise.id}
            mediaKey={exercise.media}
            name={exercise.name}
            className="aspect-[9/16] h-full"
            zoomable
          />
        ) : (
          <ExerciseThumb mediaKey={exercise.media} className="h-40 w-40 rounded-2xl" />
        )}
        <ScrollView className="flex-1" contentContainerClassName="gap-4 pb-4">
          <View className="flex-row items-start">
            {heading}
            <GlossaryButton className="-mr-3 -mt-2" />
          </View>
          <View className="flex-row flex-wrap items-center gap-4">
            {targets}
            {details}
          </View>
          {progress}
          {notes}
        </ScrollView>
        <ScrollView className="flex-1" contentContainerClassName="gap-4 pb-4">
          {controls}
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 pb-6 pt-4">
      {hasClip ? (
        // The clip is the point of this screen: big enough to read the movement from a metre away.
        <View className="flex-row items-start gap-4">
          <ExerciseVideo
            exerciseId={exercise.id}
            mediaKey={exercise.media}
            name={exercise.name}
            className="aspect-[9/16] w-36"
            zoomable
          />
          <View className="flex-1 gap-3">
            <View className="flex-row items-start">
              {heading}
              <GlossaryButton className="-mr-3 -mt-2" />
            </View>
            {targets}
            {details}
          </View>
        </View>
      ) : (
        <View className="flex-row items-start gap-4">
          <ExerciseThumb mediaKey={exercise.media} className="h-20 w-20 rounded-2xl" />
          {heading}
          <GlossaryButton className="-mr-3 -mt-2" />
        </View>
      )}

      {progress}

      {hasClip ? null : targets}

      {notes}
      {controls}
    </ScrollView>
  );
}

/**
 * One segment per set of the exercise; only the current one is lit. Done and
 * waiting sets look the same — the eyebrow already says which set this is,
 * and a lit first segment on set 2 read as the current one.
 */
function SetProgress({ current, total }: { current: number; total: number }) {
  return (
    <>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            i === current ? 'bg-foreground' : 'bg-secondary',
          )}
        />
      ))}
    </>
  );
}

function targetLabel(target: SessionStep['set']['target']): string {
  if (target.kind === 'duration') return pl.workout.session.targetTime(target.targetSec);
  if (target.kind === 'reps') return pl.workout.session.targetReps(target.min, target.max);
  return pl.workout.session.targetDistance(target.targetMeters);
}
