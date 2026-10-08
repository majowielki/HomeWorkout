/**
 * How long the engine takes to plan (engine v2, P0.5): p50 / p95 / max of
 * planning one day and a rolling week from a history of 4 weeks, one year and
 * three years of daily training, with the whole history and with the last
 * 120 days the app reads.
 *
 *   npx tsx scripts/engine-bench.ts [--runs 30]
 *
 * This is the node number. The same procedure on the phone (Hermes) is a
 * manual check, UWAGI T-2: node on a PC is not a phone, so the figures are
 * for comparing stages with each other, not promises about the device.
 */
import catalogue from '../data/exercises.json';
import { exerciseCatalogueSchema } from '../data/exercises.schema';
import slotCatalogue from '../data/slots.json';
import { slotCatalogueSchema } from '../data/slots.schema';
import { planDay } from '../src/domain/plan/dayPlanner';
import { FOLLOWS_THE_PLAN, perform, simulate } from '../src/domain/plan/simulate';
import { planWeek } from '../src/domain/plan/week';
import type { HistorySession } from '../src/domain/progression/history';
import { addDays } from '../src/domain/time/trainingDate';

const runs = Number(process.argv[process.argv.indexOf('--runs') + 1] || 30);
const exercises = exerciseCatalogueSchema.parse(catalogue).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotCatalogue);
const eligibility = {
  profile: {
    knee: {
      side: 'right' as const,
      missingCollaterals: true,
      aclReconstructed: true,
      varusThrust: true,
      physioApproved: true,
    },
  },
  excludedIds: new Set<string>(),
};
const START = '2026-01-05';

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function time(label: string, task: () => unknown): string {
  task(); // warm-up: the first call pays for the JIT
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    task();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const f = (n: number) => n.toFixed(1).padStart(7);
  return `${label.padEnd(34)} p50 ${f(percentile(samples, 50))} ms  p95 ${f(percentile(samples, 95))} ms  max ${f(samples[samples.length - 1]!)} ms`;
}

console.log(`node ${process.version}, ${runs} runs each\n`);

for (const [name, days] of [
  ['4 weeks', 28],
  ['1 year', 365],
  ['3 years', 1095],
] as const) {
  const simulated = simulate({ start: START, days, catalog, slots, eligibility });
  const all: HistorySession[] = simulated.flatMap((d) =>
    d.plan ? [{ date: d.date, sets: perform(d.plan, FOLLOWS_THE_PLAN, catalog) }] : [],
  );
  const last = simulated[simulated.length - 1]!;
  const today = addDays(last.date, 1);
  console.log(
    `${name}: ${all.length} sessions, ${all.reduce((n, s) => n + s.sets.length, 0)} sets`,
  );

  for (const [scope, sessions] of [
    ['whole history', all],
    ['last 120 days', all.filter((s) => s.date >= addDays(today, -120))],
  ] as const) {
    const input = {
      asOf: today,
      catalog,
      slots,
      eligibility,
      block: last.block,
      sessions,
      rides: [],
      daily: [],
    };
    console.log(time(`  planDay, ${scope}`, () => planDay(input)));
    console.log(
      time(`  planWeek (7 days), ${scope}`, () =>
        planWeek({
          ...input,
          from: today,
          days: 7,
          block: last.block,
          lastSessionDate: sessions[sessions.length - 1]?.date ?? null,
        }),
      ),
    );
  }
  console.log(`  heap ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB\n`);
}
