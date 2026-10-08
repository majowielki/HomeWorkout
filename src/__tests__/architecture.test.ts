/**
 * Architecture tests for ADR 0001 (the model never computes a load) and
 * ADR 0006 (the model may compose days from the engine's options). They pin
 * properties of the code's shape that no single unit test can: what a model
 * is able to write, and which code may store a plan.
 */
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CHAT_TOOLS, TOOL_NAMES } from '@/ai/contract/chatTools';
import { weeklySummarySchema } from '@/ai/contract/weeklySummary';

const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const FILES = [...sourceFiles('app'), ...sourceFiles('src')];
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Every property name anywhere in a JSON Schema, nested objects and arrays included. */
function propertyNames(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(propertyNames);
  if (schema === null || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const own = node.properties ? Object.keys(node.properties as object) : [];
  return [...own, ...Object.values(node).flatMap(propertyNames)];
}

/** Words of a field a load, a band setting or a repetition target could be written into. */
const LOAD_FIELD = /kg|weight|load|band|position|anchor|rep|rir|target|time|resist|second/i;

describe('ADR 0001: what a model writes has no field for a load', () => {
  const written: [string, z.ZodType][] = [
    ...TOOL_NAMES.map((name): [string, z.ZodType] => [`${name} input`, CHAT_TOOLS[name].input]),
    ['weekly summary', weeklySummarySchema],
  ];

  it.each(written)('%s', (_, schema) => {
    const names = propertyNames(z.toJSONSchema(schema));
    expect(names.filter((n) => LOAD_FIELD.test(n))).toEqual([]);
  });

  it('would notice one', () => {
    const leaky = z.strictObject({ days: z.array(z.strictObject({ weightKg: z.number() })) });
    expect(propertyNames(z.toJSONSchema(leaky)).filter((n) => LOAD_FIELD.test(n))).toEqual([
      'weightKg',
    ]);
  });
});

/** The repository functions that store a plan or start a session from one. */
const PLAN_WRITERS = [
  'saveWeek',
  'saveCoachWeek',
  'refreshForecasts',
  'startExtraWorkout',
  'startPlannedWorkout',
];

/**
 * The only modules that may call them. Each takes its plans from the engine
 * (syncWeek, planCustom) on a fresh snapshot; none receives a plan from outside.
 */
const PLAN_ORCHESTRATORS = [
  'src/features/plan/computeToday.ts',
  'src/features/plan/usePlanToday.ts',
  'src/features/extra/actions.ts',
  'src/features/coach/chat/proposals.ts',
];

describe('ADR 0001/0006: only the engine’s orchestration stores a plan', () => {
  it.each(PLAN_WRITERS)('%s is called only from the planning orchestration', (writer) => {
    const callers = FILES.filter(
      (f) => !f.startsWith('src/db/') && new RegExp(`\\b${writer}\\b`).test(read(f)),
    );
    expect(callers.filter((f) => !PLAN_ORCHESTRATORS.includes(f))).toEqual([]);
  });

  it.each(PLAN_ORCHESTRATORS)(
    '%s never reads what a model wrote, only validated tool input',
    (file) => {
      const source = read(file);
      // The client and the chat loop carry a model's text; the contract carries checked shapes.
      expect(source).not.toMatch(/from '@\/ai\/(client|chat)\//);
      expect(source).not.toMatch(/from '@\/features\/coach\/chat\/(useCoachChat|state|ChatView)'/);
    },
  );

  it('keeps every plan writer behind the repository layer', () => {
    for (const writer of PLAN_WRITERS) {
      const defined = FILES.filter((f) =>
        new RegExp(`export (async )?function ${writer}\\b`).test(read(f)),
      );
      expect(defined.every((f) => f.startsWith('src/db/repositories/'))).toBe(true);
      expect(defined).toHaveLength(1);
    }
  });
});
