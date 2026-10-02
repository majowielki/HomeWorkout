/**
 * Deterministic synthetic training history for tests and evaluation cases.
 *
 * The repository is public, so no real log ever goes into it
 * (AI-INTEGRACJA §4.8). This builds a plausible `CoachSource` instead:
 * the real FBW A/B templates and the real exercise catalogue, with loads,
 * weight and sleep shaped by a handful of knobs. Same spec in, same data
 * out — no clock, no randomness.
 */
import exercisesJson from '@data/exercises.json';
import templatesJson from '@data/templates.json';

import type { MovementPattern, MuscleGroup, KneeProfile } from '@/domain/types';
import { addDays } from '@/domain/time/trainingDate';

import type {
  CoachSource,
  SourceDailyLog,
  SourceExercise,
  SourceSet,
  SourceWorkout,
} from '../context/source';

export interface ScenarioSpec {
  /** Default 2026-10-01. */
  asOf?: string;
  /** Completed sessions inside the 28-day window, evenly spaced. Default 9. */
  sessions?: number;
  /** Days between those sessions. Default 3. */
  cadenceDays?: number;
  /** Days between the last session and `asOf`. Default 2. */
  lastSessionDaysAgo?: number;
  /** Completed sessions older than the window (rows only). Default 20. */
  olderSessions?: number;
  /** How the numbers move across the window. Default 'flat'. */
  progress?: 'improving' | 'flat' | 'declining';
  weight?: { startKg: number; perWeekKg: number; days?: number; lastEntryDaysAgo?: number } | null;
  waist?: { startCm: number; perWeekCm: number } | null;
  /** Hours of sleep per night over the last `days` nights (ending today). */
  sleep?: { hours: number; days: number } | null;
  /** Muscles reported at soreness 4 on the last two days. */
  highSoreness?: MuscleGroup[];
  notes?: { daysAgo: number; source: 'session' | 'daily'; text: string }[];
  knee?: KneeProfile | null;
}

interface CatalogueEntry {
  id: string;
  name: string;
  movementPattern: MovementPattern;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
}

const catalogue = (exercisesJson as { exercises: CatalogueEntry[] }).exercises;

export const SYNTHETIC_EXERCISES: SourceExercise[] = catalogue.map((e) => ({
  id: e.id,
  name: e.name,
  movementPattern: e.movementPattern,
  primaryMuscles: e.primaryMuscles,
  secondaryMuscles: e.secondaryMuscles,
}));

export const DEFAULT_KNEE: KneeProfile = {
  side: 'right',
  missingCollaterals: true,
  aclReconstructed: true,
  varusThrust: false,
  physioApproved: false,
};

type BaseLoad =
  | { kind: 'dumbbell'; mode: 'paired' | 'single'; kg: number }
  | { kind: 'band'; bandId: string; position: number }
  | { kind: 'bodyweight' };

/** Where each template exercise starts. Loads are on the real dumbbell ladders. */
const START_LOAD: Record<string, BaseLoad> = {
  'goblet-squat': { kind: 'dumbbell', mode: 'single', kg: 10 },
  'band-row': { kind: 'band', bandId: 'red', position: 1 },
  'db-romanian-deadlift': { kind: 'dumbbell', mode: 'paired', kg: 8 },
  'db-floor-press': { kind: 'dumbbell', mode: 'paired', kg: 6 },
  'glute-bridge': { kind: 'bodyweight' },
  plank: { kind: 'bodyweight' },
  'band-squat': { kind: 'band', bandId: 'red', position: 1 },
  'one-arm-db-row': { kind: 'dumbbell', mode: 'single', kg: 10 },
  'band-pull-through': { kind: 'band', bandId: 'red', position: 0 },
  'push-up': { kind: 'bodyweight' },
  'lateral-raise': { kind: 'dumbbell', mode: 'paired', kg: 2 },
  'dead-bug': { kind: 'bodyweight' },
};

interface TemplateBlockJson {
  exerciseId: string;
  sets: number;
  repMin?: number;
  repMax?: number;
  timeSec?: number;
  targetRirMin: number;
}
interface TemplateJson {
  name: string;
  blocks: TemplateBlockJson[];
}
const templates = (templatesJson as { templates: TemplateJson[] }).templates;

/** Two ladder steps (2 kg each) every third session, or one band position. */
function progressed(load: BaseLoad, steps: number): BaseLoad {
  if (load.kind === 'dumbbell') return { ...load, kg: load.kg + 2 * steps };
  if (load.kind === 'band') return { ...load, position: Math.min(3, load.position + steps) };
  return load;
}

function setsOfSession(
  workoutId: string,
  index: number,
  startedAt: string,
  progress: NonNullable<ScenarioSpec['progress']>,
): SourceSet[] {
  const template = templates[index % templates.length]!;
  const steps = progress === 'improving' ? Math.floor(index / 3) : 0;
  const repShift =
    progress === 'improving' ? index % 3 : progress === 'declining' ? -Math.floor(index / 2) : 0;

  return template.blocks.flatMap((block, blockIndex) =>
    Array.from({ length: block.sets }, (_, n) => {
      const load = progressed(START_LOAD[block.exerciseId] ?? { kind: 'bodyweight' }, steps);
      const base = block.repMin !== undefined ? block.repMin + 2 : null;
      return {
        id: `${workoutId}-s${blockIndex}-${n}`,
        workoutId,
        exerciseId: block.exerciseId,
        exerciseOrder: blockIndex,
        setIndex: n,
        isWarmup: false,
        reps: base === null ? null : Math.max(5, base + repShift),
        timeSec: block.timeSec ?? null,
        rir: block.targetRirMin + 1,
        weightKg: load.kind === 'dumbbell' ? load.kg : null,
        dumbbellMode: load.kind === 'dumbbell' ? load.mode : null,
        bandId: load.kind === 'band' ? load.bandId : null,
        anchorPosition: load.kind === 'band' ? load.position : null,
        loggedAt: startedAt,
      };
    }),
  );
}

export function scenario(spec: ScenarioSpec = {}): CoachSource {
  const asOf = spec.asOf ?? '2026-10-01';
  const sessionCount = spec.sessions ?? 9;
  const cadence = spec.cadenceDays ?? 3;
  const lastAgo = spec.lastSessionDaysAgo ?? 2;
  const older = spec.olderSessions ?? 20;
  const progress = spec.progress ?? 'flat';

  const completedWorkouts: SourceWorkout[] = [];
  const sets: SourceSet[] = [];

  for (let i = 0; i < older; i += 1) {
    const date = addDays(asOf, -(40 + (older - i) * 3));
    completedWorkouts.push({
      id: `old-${i}`,
      trainingDate: date,
      startedAt: `${date}T17:00:00.000Z`,
      finishedAt: `${date}T17:40:00.000Z`,
      templateName: templates[i % templates.length]!.name,
      sessionRpe: 7,
      notes: null,
    });
  }

  for (let i = 0; i < sessionCount; i += 1) {
    const date = addDays(asOf, -(lastAgo + cadence * (sessionCount - 1 - i)));
    const id = `w-${i}`;
    const startedAt = `${date}T17:00:00.000Z`;
    const notes = (spec.notes ?? []).find(
      (n) => n.source === 'session' && addDays(asOf, -n.daysAgo) === date,
    );
    completedWorkouts.push({
      id,
      trainingDate: date,
      startedAt,
      finishedAt: `${date}T17:42:00.000Z`,
      templateName: templates[i % templates.length]!.name,
      sessionRpe: 7,
      notes: notes?.text ?? null,
    });
    sets.push(...setsOfSession(id, i, startedAt, progress));
  }

  const weights =
    spec.weight === null
      ? []
      : Array.from({ length: spec.weight?.days ?? 28 }, (_, d) => {
          const w = spec.weight ?? { startKg: 96, perWeekKg: -0.6 };
          const last = spec.weight?.lastEntryDaysAgo ?? 0;
          const day = (spec.weight?.days ?? 28) - 1 - d;
          // A small deterministic wobble: water and glycogen, not noise from a RNG.
          const kg = w.startKg + (w.perWeekKg * (27 - day)) / 7 + 0.4 * Math.sin(day * 1.7);
          return { date: addDays(asOf, -(day + last)), value: Math.round(kg * 10) / 10 };
        });

  const waists =
    spec.waist === null
      ? []
      : [0, 1, 2, 3].map((week) => {
          const w = spec.waist ?? { startCm: 104, perWeekCm: -0.5 };
          return {
            date: addDays(asOf, -(3 - week) * 7),
            value: Math.round((w.startCm + w.perWeekCm * week) * 10) / 10,
          };
        });

  const dailyLogs: SourceDailyLog[] = [];
  const logDays = Math.max(spec.sleep?.days ?? 0, spec.highSoreness?.length ? 2 : 0);
  for (let d = 0; d < logDays; d += 1) {
    const date = addDays(asOf, -d);
    dailyLogs.push({
      date,
      sleepHours: d < (spec.sleep?.days ?? 0) ? (spec.sleep?.hours ?? null) : null,
      energy: 3,
      stress: 2,
      soreness:
        d < 2 && spec.highSoreness?.length
          ? Object.fromEntries(spec.highSoreness.map((m) => [m, 4]))
          : null,
      note: null,
    });
  }
  for (const n of spec.notes ?? []) {
    if (n.source !== 'daily') continue;
    const date = addDays(asOf, -n.daysAgo);
    const existing = dailyLogs.find((l) => l.date === date);
    if (existing) existing.note = n.text;
    else {
      dailyLogs.push({
        date,
        sleepHours: null,
        energy: null,
        stress: null,
        soreness: null,
        note: n.text,
      });
    }
  }

  return {
    asOf,
    knee: spec.knee === undefined ? DEFAULT_KNEE : spec.knee,
    exercises: SYNTHETIC_EXERCISES,
    completedWorkouts,
    sets,
    weights,
    waists,
    dailyLogs,
  };
}
