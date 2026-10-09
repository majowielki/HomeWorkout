import { View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { BAND_CONFIG } from '@/domain/config/training';
import { BANDS, nextRung, previousRung } from '@/domain/inventory';
import { estimateBandLoad, type LoadEstimate } from '@/domain/progression/calibration';
import {
  isTimed,
  ladderFor,
  type SetFieldValues,
  usesBand,
  usesDumbbell,
} from '@/domain/session/setEntry';
import {
  type AnchorPosition,
  type BandCalibrationMap,
  type Exercise,
  SHORTFALL_REASONS,
} from '@/domain/types';
import { bandSwatch } from '@/features/bands/bandSwatch';
import { pl } from '@/strings/pl';

const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
const POSITIONS: AnchorPosition[] = [0, 1, 2, 3];
const REP_STEP = 1;
const TIME_STEP = 5;

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
