/** Synthetic logged work uses the same exposure index and planner as the phone. */
import exercisesJson from '@data/exercises.json';
import slotsJson from '@data/slots.json';
import { slotCatalogueSchema } from '@data/slots.schema';
import { buildObservation } from '@/domain/observations/entry';
import type { ExposureRecord } from '@/domain/observations/exposure';
import { specFromLoad } from '@/domain/resistance/legacy';
import { loadOfSet } from '@/domain/progression/load';
import { defaultPreferences } from '@/domain/preferences/preferences';
import { fingerprint } from '@/domain/fingerprint';
import { planVersions } from '@/domain/plan/versions';
import { syncWeekV2 } from '@/domain/plan/weekV2';
import type { Exercise } from '@/domain/types';
import { describePlan, type WeekContext } from '../tools/planPreviewV2';
import type { CoachSource } from '../context/source';
import type { ToolError, ToolOutput } from '../contract/chatTools';

/** Raw synthetic logs carry no frozen prescription: they count as work, not progression evidence. */
export function syntheticWeekContext(source: CoachSource): WeekContext {
  const catalog: Record<string, Exercise> = Object.fromEntries(
    (exercisesJson.exercises as Exercise[]).map((e) => [
      e.id,
      { ...e, name: source.exercises.find((row) => row.id === e.id)?.name ?? e.name },
    ]),
  );
  const slots = slotCatalogueSchema.parse(slotsJson).slots;
  const dates = new Map(
    source.completedWorkouts
      .filter((w) => w.trainingDate <= source.asOf)
      .map((w) => [w.id, w.trainingDate]),
  );
  const records: ExposureRecord[] = source.sets.flatMap((set) => {
    const date = dates.get(set.workoutId);
    if (date === undefined || set.isWarmup || (set.reps === null && set.timeSec === null))
      return [];
    const resistance = specFromLoad(loadOfSet(set), { variantId: set.exerciseId });
    const result = buildObservation(
      {
        status: 'performed',
        amount: {
          edited: true,
          value:
            set.timeSec !== null
              ? { kind: 'duration', seconds: set.timeSec }
              : { kind: 'reps', reps: set.reps! },
        },
        resistance: { edited: true, value: resistance },
        rir: { edited: true, value: set.rir },
        shortfall: set.shortfall,
      },
      { channel: 'touch', at: set.loggedAt, shown: {} },
    );
    return [
      {
        exposureId: `synthetic-${set.id}`,
        sessionId: set.workoutId,
        trainingDate: date,
        exerciseId: set.exerciseId,
        slotId: slots.find((s) => s.exerciseIds.includes(set.exerciseId))?.id ?? null,
        comparisonKey: set.exerciseId,
        progressionScope: 'supplemental',
        sets: [],
        extra: [
          {
            ...result,
            id: set.id,
            commandId: set.id,
            revision: 1,
            sessionId: set.workoutId,
            exposureId: null,
            plannedSetId: null,
            logicalSetId: null,
            side: set.side ?? null,
            recordedAt: set.loggedAt,
          },
        ],
        context: { abandoned: false, userReduced: false, feel: null, deload: false },
      },
    ];
  });
  const context: WeekContext = {
    asOf: source.asOf,
    catalog,
    slots,
    eligibility: { profile: { knee: source.knee }, excludedIds: new Set() },
    records,
    block: null,
    endedBlocks: [],
    rides: [],
    daily: source.dailyLogs,
    preferences: defaultPreferences(),
    constraints: [],
    week: { restWeekdays: [] },
    versions: planVersions(String(exercisesJson.version)),
    snapshotFingerprint: fingerprint(source),
    stored: [],
    trainedDates: new Set(dates.values()),
  };
  context.stored = syncWeekV2(context).rows;
  return context;
}
export function syntheticPlan(
  source: CoachSource,
  daysAgo: number,
): ToolOutput<'getPlanExplanation'> | ToolError {
  return describePlan(syntheticWeekContext(source), daysAgo, null);
}
