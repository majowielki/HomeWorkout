/**
 * Prints what the rules engine would plan, day by day, for a person who
 * starts today and does exactly what the plan says (SPEC §10.6). Look at
 * this before training on a new version of the engine.
 *
 *   npx tsx scripts/simulate-plan.ts [--weeks 5] [--start 2026-10-05] [--conservative]
 *
 * Uses the shipped catalogue and slots, the documented knee with hard
 * exclusions only (the 2026-10-02 choice) unless --conservative.
 */
import catalogue from '../data/exercises.json';
import { exerciseCatalogueSchema } from '../data/exercises.schema';
import slotCatalogue from '../data/slots.json';
import { slotCatalogueSchema } from '../data/slots.schema';
import { MUSCLE_GROUPS } from '../src/domain/coach/vocabulary';
import { TRAINING_CONFIG } from '../src/domain/config/training';
import { simulate } from '../src/domain/plan/simulate';
import { maxDirectSets } from '../src/domain/volume/weekly';
import type { PlannedLoad } from '../src/domain/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const weeks = Number(arg('weeks') ?? 5);
const start = arg('start') ?? new Date().toISOString().slice(0, 10);
const conservative = process.argv.includes('--conservative');

const exercises = exerciseCatalogueSchema.parse(catalogue).exercises;
const catalog = Object.fromEntries(exercises.map((e) => [e.id, e]));
const { slots } = slotCatalogueSchema.parse(slotCatalogue);

const days = simulate({
  start,
  days: weeks * 7,
  catalog,
  slots,
  eligibility: {
    profile: {
      knee: {
        side: 'right',
        missingCollaterals: true,
        aclReconstructed: true,
        varusThrust: true,
        physioApproved: !conservative,
      },
    },
    excludedIds: new Set(),
  },
});

const load = (l: PlannedLoad) =>
  l.kind === 'dumbbell' ? `${l.kg}kg` : l.kind === 'band' ? `${l.bandId} P${l.position}` : 'bw';

for (const day of days) {
  const plan = day.plan;
  const events = day.events.length > 0 ? `  [${day.events.join(', ')}]` : '';
  console.log(
    `\n${day.date}  blok ${day.block.index}${plan?.phase === 'deload' ? ' DELOAD' : ''}${events}`,
  );
  if (!plan) continue;
  console.log(
    `  ${plan.regions.join(' + ') || '—'} · ${plan.estimatedMinutes} min + rower ${plan.bike.minutes} min` +
      (plan.dayReasons.length > 0 ? ` · ${plan.dayReasons.join(', ')}` : ''),
  );
  for (const e of plan.exercises) {
    const amount = e.unit === 'sec' ? `${e.target}s` : `${e.target} (${e.repMin}-${e.repMax})`;
    console.log(
      `   ${e.label.padEnd(3)} ${e.exerciseId.padEnd(30)} ${e.sets}x ${amount.padEnd(12)} ${load(e.load).padEnd(10)} RIR ${e.targetRirMin}-${e.targetRirMax}  ${e.reasons.join(',')}`,
    );
  }
  const skipped = plan.skipped.map((s) => `${s.slotId}:${s.reason}`).join(' ');
  if (skipped) console.log(`   pominięte: ${skipped}`);
}

// Coverage: on how many days each muscle's direct sets (as a primary —
// what the planner counts) over the last 7 days sat inside 3-6.
const { min } = TRAINING_CONFIG.weeklyWorkingSetsPerMuscle;
const settled = days.slice(7);
console.log(
  `\nPokrycie partii — serie bezpośrednie z 7 dni, od 8. dnia (norma od ${min} do maksimum partii):`,
);
for (const m of MUSCLE_GROUPS) {
  const max = maxDirectSets(m);
  const direct = settled.map((d) => d.primaryVolume[m]);
  const inRange = direct.filter((v) => v >= min && v <= max).length;
  const below = direct.filter((v) => v < min).length;
  const above = direct.filter((v) => v > max).length;
  console.log(
    `  ${m.padEnd(11)} max ${max}  w normie ${String(inRange).padStart(3)}  poniżej ${String(below).padStart(3)}  powyżej ${String(above).padStart(3)}`,
  );
}

const hard = new Map<string, number>();
const light = new Map<string, number>();
for (const d of days) {
  for (const e of d.plan?.exercises ?? []) {
    const tally = e.reasons.includes('LIGHT_FILL') ? light : hard;
    tally.set(e.slotId, (tally.get(e.slotId) ?? 0) + 1);
  }
}
console.log('\nIle razy slot był w planie (ciężko / lekko):');
for (const s of slots) {
  const counts = `${String(hard.get(s.id) ?? 0).padStart(3)} / ${light.get(s.id) ?? 0}`;
  console.log(`  ${s.id.padEnd(16)} ${counts}`);
}

const minutes = days.flatMap((d) => (d.plan ? [d.plan.estimatedMinutes] : []));
console.log(
  `\nMinuty ćwiczeń dziennie: min ${Math.min(...minutes)}, max ${Math.max(...minutes)}, ` +
    `średnio ${Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)}`,
);
