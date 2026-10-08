import { View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { BAND_CONFIG } from '@/domain/config/training';
import { BANDS, LADDER_PAIRED, LADDER_SINGLE, nextRung, previousRung } from '@/domain/inventory';
import {
  estimateBandLoad,
  estimatedPeakKg,
  type LoadEstimate,
} from '@/domain/progression/calibration';
import {
  type AnchorPosition,
  type BandCalibrationMap,
  type DumbbellMode,
  type Exercise,
  SHORTFALL_REASONS,
  type ShortfallReason,
} from '@/domain/types';
import { bandSwatch } from '@/features/bands/bandSwatch';
import { pl } from '@/strings/pl';

/** What a set log stores about the effort — the shape both the live logger and the history editor save. */
export interface SavedSetData {
  reps: number | null;
  timeSec: number | null;
  rir: number;
  weightKg: number | null;
  dumbbellMode: DumbbellMode | null;
  bandId: string | null;
  anchorPosition: AnchorPosition | null;
  /** Peak of the calibrated range, or null whenever no honest number exists. */
  estimatedLoadKg: number | null;
  /** Why the set fell short of its target, when the person said. */
  shortfall: ShortfallReason | null;
}

/**
 * Every field the form can show, always populated. Which ones are rendered
 * — and which survive into `SavedSetData` — depends on the exercise, so a
 * dumbbell exercise carries a band value it never uses. Simpler than a
 * discriminated union that the steppers would have to narrow on every tap.
 */
export interface SetFieldValues {
  reps: number;
  timeSec: number;
  rir: number;
  weightKg: number;
  bandId: string;
  position: AnchorPosition;
  shortfall: ShortfallReason | null;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
const POSITIONS: AnchorPosition[] = [0, 1, 2, 3];
const REP_STEP = 1;
const TIME_STEP = 5;

export const usesDumbbell = (e: Exercise) => e.equipment.includes('dumbbell');
export const usesBand = (e: Exercise) => e.equipment.includes('band');
export const isTimed = (e: Exercise) => e.forceProfile === 'Isometric';

export function ladderFor(exercise: Exercise): number[] {
  return exercise.dumbbellMode === 'single' ? LADDER_SINGLE : LADDER_PAIRED;
}

/** What the band would deliver at this position over this exercise's range of motion. */
export function bandEstimate(
  exercise: Exercise,
  bandId: string,
  position: AnchorPosition,
  calibrations: BandCalibrationMap | undefined,
): LoadEstimate {
  return estimateBandLoad(
    calibrations?.[bandId] ?? null,
    position,
    BAND_CONFIG.romCm[exercise.movementPattern],
  );
}

/** Drops the fields the exercise does not use, so nothing irrelevant reaches the database. */
export function toSavedSet(
  exercise: Exercise,
  v: SetFieldValues,
  calibrations?: BandCalibrationMap,
): SavedSetData {
  return {
    reps: isTimed(exercise) ? null : v.reps,
    timeSec: isTimed(exercise) ? v.timeSec : null,
    rir: v.rir,
    weightKg: usesDumbbell(exercise) ? v.weightKg : null,
    dumbbellMode: usesDumbbell(exercise) ? (exercise.dumbbellMode ?? null) : null,
    bandId: usesBand(exercise) ? v.bandId : null,
    anchorPosition: usesBand(exercise) ? v.position : null,
    estimatedLoadKg: usesBand(exercise)
      ? estimatedPeakKg(bandEstimate(exercise, v.bandId, v.position, calibrations))
      : null,
    shortfall: v.shortfall,
  };
}

type Props = {
  exercise: Exercise;
  values: SetFieldValues;
  onChange: (values: SetFieldValues) => void;
  /** Without it the band block shows no kilograms at all. */
  calibrations?: BandCalibrationMap;
  /**
   * Asks why the set fell short: 'below' when the logged amount is under the
   * target (the live logger), 'optional' in the history editor, which does
   * not know the target. Absent: not asked.
   */
  shortfall?: 'below' | 'optional';
};

/**
 * The load / reps / RIR controls for one set, laid out for a phone on the
 * floor (IMPLEMENTACJA §2.3). Controlled: the parent owns the values, so
 * the active session can prefill from the last log and the history editor
 * from the row being corrected.
 */
export function SetFields({ exercise, values, onChange, calibrations, shortfall }: Props) {
  const ladder = ladderFor(exercise);
  const set = (patch: Partial<SetFieldValues>) => onChange({ ...values, ...patch });
  const estimate = usesBand(exercise)
    ? bandEstimate(exercise, values.bandId, values.position, calibrations)
    : null;

  return (
    <>
      {exercise.equipment.includes('mini-band') ? (
        <Text variant="muted">{pl.workout.session.miniBandNote}</Text>
      ) : null}
      {usesDumbbell(exercise) ? (
        <Stepper
          label={
            exercise.dumbbellMode === 'single'
              ? pl.workout.session.dumbbellSingle
              : pl.workout.session.dumbbellPaired
          }
          value={`${values.weightKg} kg`}
          onDecrement={() => set({ weightKg: previousRung(ladder, values.weightKg) })}
          onIncrement={() => set({ weightKg: nextRung(ladder, values.weightKg) })}
          decrementDisabled={values.weightKg <= ladder[0]!}
          incrementDisabled={values.weightKg >= ladder[ladder.length - 1]!}
        />
      ) : null}

      {usesBand(exercise) ? (
        <View className="gap-3">
          <View className="gap-1.5">
            <Text variant="eyebrow">{pl.workout.session.band}</Text>
            <View className="flex-row flex-wrap gap-2">
              {BANDS.map((b) => (
                <Chip
                  key={b.id}
                  label={b.label}
                  swatch={bandSwatch(b.id)}
                  selected={values.bandId === b.id}
                  onPress={() => set({ bandId: b.id })}
                />
              ))}
            </View>
          </View>
          <View className="gap-1.5">
            <Text variant="eyebrow">{pl.workout.session.anchorPosition}</Text>
            <View className="flex-row gap-2">
              {POSITIONS.map((p) => (
                <Chip
                  key={p}
                  label={`P${p}`}
                  selected={values.position === p}
                  onPress={() => set({ position: p })}
                />
              ))}
            </View>
            <Text variant="muted" className="text-xs">
              {pl.workout.session.anchorPositionHint(BAND_CONFIG.anchorStepCm)}
            </Text>
          </View>
          {estimate && estimate.kind !== 'none' ? (
            <Text variant="muted" className="text-center">
              {pl.bands.estimate(estimate)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {isTimed(exercise) ? (
        <Stepper
          label={pl.workout.session.time}
          value={`${values.timeSec} s`}
          onDecrement={() => set({ timeSec: Math.max(TIME_STEP, values.timeSec - TIME_STEP) })}
          onIncrement={() => set({ timeSec: values.timeSec + TIME_STEP })}
          decrementDisabled={values.timeSec <= TIME_STEP}
        />
      ) : (
        <Stepper
          label={pl.workout.session.reps}
          value={String(values.reps)}
          onDecrement={() => set({ reps: Math.max(1, values.reps - REP_STEP) })}
          onIncrement={() => set({ reps: values.reps + REP_STEP })}
          decrementDisabled={values.reps <= 1}
        />
      )}

      {/* The felt effort is stored as RIR, which the engine reads (SPEC §5.1). */}
      <View className="gap-1.5">
        <Text variant="eyebrow" className="text-center">
          {pl.workout.session.effort.title}
        </Text>
        <View className="flex-row flex-wrap justify-center gap-2">
          {RIR_OPTIONS.map((r) => (
            <Chip
              key={r}
              label={effortLabel(r)}
              caption={pl.workout.session.effort.caption(r)}
              selected={values.rir === r}
              onPress={() => set({ rir: r })}
            />
          ))}
        </View>
        <Text variant="muted" className="text-center text-xs">
          {pl.workout.session.effort.hint}
        </Text>
      </View>

      {shortfall ? (
        <View className="gap-1.5">
          <Text variant="eyebrow" className="text-center">
            {shortfall === 'below'
              ? pl.workout.session.shortfall.title
              : pl.history.setEdit.shortfallTitle}
          </Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {SHORTFALL_REASONS.map((r) => (
              <Chip
                key={r}
                label={pl.workout.session.shortfall.reason[r]}
                selected={values.shortfall === r}
                // A second tap takes the reason back: it is optional.
                onPress={() => set({ shortfall: values.shortfall === r ? null : r })}
              />
            ))}
          </View>
          <Text variant="muted" className="text-center text-xs">
            {values.shortfall === 'pain'
              ? pl.workout.session.shortfall.painNote
              : pl.workout.session.shortfall.hint}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/** The felt effort for an RIR; 4 and more read as "Lekko". */
export function effortLabel(rir: number): string {
  const levels = pl.workout.session.effort.level;
  return levels[Math.min(Math.max(rir, 0), levels.length - 1)]!;
}

/** Whether a set falls short of its block's target: reps under the range, or time under the goal. */
export function isBelowTarget(
  exercise: Exercise,
  values: Pick<SetFieldValues, 'reps' | 'timeSec'>,
  target: { repMin?: number; timeSec?: number },
): boolean {
  if (isTimed(exercise)) return target.timeSec !== undefined && values.timeSec < target.timeSec;
  return target.repMin !== undefined && values.reps < target.repMin;
}
