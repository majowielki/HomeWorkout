/**
 * What an evaluation run leaves behind, and how two runs are compared.
 *
 * A report is plain data (JSON on disk, Markdown for people). The safety
 * scorers are gated at 100% of the cases they apply to: one failure makes
 * `safetyOk` false and the command exits non-zero. Quality scorers are only
 * compared with an earlier report (AI-INTEGRACJA §5.3).
 */
import { z } from 'zod';

import { SAFETY_SCORERS } from './scorers';

const scorerResult = z.strictObject({ pass: z.boolean(), detail: z.string().optional() });

const caseReport = z.strictObject({
  id: z.string(),
  category: z.string(),
  results: z.record(z.string(), scorerResult),
  usage: z.strictObject({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  latencyMs: z.number().optional(),
  attempts: z.number().optional(),
  /** Set when no answer could be produced at all (provider down, key missing). */
  error: z.string().optional(),
});

export const reportSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.string(),
  feature: z.enum(['weekly-summary', 'chat']),
  /** `reference` is the rule-based stand-in; `recorded` and `live` are real model answers. */
  responder: z.enum(['reference', 'recorded', 'live']),
  promptVersion: z.string().nullable(),
  model: z.string().nullable(),
  /** One sentence on what this run does and does not show. */
  note: z.string(),
  scorers: z.record(
    z.string(),
    z.strictObject({ passed: z.number(), total: z.number(), safety: z.boolean() }),
  ),
  safetyOk: z.boolean(),
  cases: z.array(caseReport),
});

export type Report = z.infer<typeof reportSchema>;
export type CaseReport = z.infer<typeof caseReport>;

export const NOTES: Record<Report['responder'], string> = {
  reference:
    'Rule-based stand-in, not a model. Shows that the pipeline and the scorers work; says nothing about any model.',
  recorded: 'Answers recorded earlier from a real model, replayed without a network.',
  live: 'Answers from a real model, called during this run.',
};

export function buildReport(
  meta: Pick<Report, 'responder' | 'promptVersion' | 'model' | 'createdAt'> & {
    /** Default 'weekly-summary'. */
    feature?: Report['feature'];
    /** Which scorer names gate the build for this feature. Default: the weekly summary's. */
    safetyScorers?: readonly string[];
  },
  cases: CaseReport[],
): Report {
  const { feature = 'weekly-summary', safetyScorers = SAFETY_SCORERS, ...rest } = meta;
  const scorers: Report['scorers'] = {};
  for (const c of cases) {
    for (const [name, result] of Object.entries(c.results)) {
      const entry = (scorers[name] ??= {
        passed: 0,
        total: 0,
        safety: safetyScorers.includes(name),
      });
      entry.total += 1;
      if (result.pass) entry.passed += 1;
    }
  }
  const safetyOk =
    cases.every((c) => c.error === undefined) &&
    Object.values(scorers).every((s) => !s.safety || s.passed === s.total);
  return {
    version: 1,
    feature,
    ...rest,
    note: NOTES[meta.responder],
    scorers,
    safetyOk,
    cases,
  };
}

const pct = (passed: number, total: number) => `${Math.round((100 * passed) / total)}%`;

export function renderMarkdown(report: Report): string {
  const lines = [
    `# Evaluation: ${report.feature}`,
    '',
    `- Responder: **${report.responder}**${report.model ? ` (${report.model})` : ''}`,
    `- Prompt: ${report.promptVersion ?? 'n/a'}`,
    `- Run: ${report.createdAt}`,
    `- Safety: **${report.safetyOk ? 'all clear' : 'FAILED'}**`,
    '',
    `> ${report.note}`,
    '',
    '| Scorer | Kind | Passed | Rate |',
    '|---|---|---|---|',
  ];
  const names = Object.keys(report.scorers).sort();
  for (const name of names) {
    const s = report.scorers[name]!;
    lines.push(
      `| ${name} | ${s.safety ? 'safety' : 'quality'} | ${s.passed}/${s.total} | ${pct(s.passed, s.total)} |`,
    );
  }

  const failing = report.cases.filter(
    (c) => c.error !== undefined || Object.values(c.results).some((r) => !r.pass),
  );
  if (failing.length > 0) {
    lines.push('', '## Failures', '');
    for (const c of failing) {
      lines.push(`- **${c.id}** (${c.category})${c.error ? `: no answer (${c.error})` : ''}`);
      for (const [name, r] of Object.entries(c.results)) {
        if (!r.pass) lines.push(`  - ${name}${r.detail ? `: ${r.detail}` : ''}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

// --- comparing two reports --------------------------------------------------

export interface Comparison {
  /** Scorers whose pass rate moved, as percentage points (after minus before). */
  deltas: { scorer: string; before: number; after: number; delta: number; safety: boolean }[];
  /** Cases that passed a scorer before and fail it now. */
  regressions: { caseId: string; scorer: string; safety: boolean }[];
  fixes: { caseId: string; scorer: string }[];
  /** Safety got worse than it was: see compareReports. */
  safetyRegressed: boolean;
}

const rate = (s: { passed: number; total: number }) => (s.total === 0 ? 1 : s.passed / s.total);

export function compareReports(before: Report, after: Report): Comparison {
  const deltas: Comparison['deltas'] = [];
  for (const scorer of new Set([...Object.keys(before.scorers), ...Object.keys(after.scorers)])) {
    const b = before.scorers[scorer];
    const a = after.scorers[scorer];
    if (!a) continue; // dropped from the new run: nothing to compare against
    const beforeRate = b ? rate(b) : 1;
    const afterRate = rate(a);
    if (beforeRate !== afterRate) {
      deltas.push({
        scorer,
        before: Math.round(beforeRate * 100),
        after: Math.round(afterRate * 100),
        delta: Math.round((afterRate - beforeRate) * 100),
        safety: a.safety,
      });
    }
  }

  const regressions: Comparison['regressions'] = [];
  const fixes: Comparison['fixes'] = [];
  const earlier = new Map(before.cases.map((c) => [c.id, c]));
  for (const c of after.cases) {
    const old = earlier.get(c.id);
    if (!old) continue;
    for (const [scorer, result] of Object.entries(c.results)) {
      const was = old.results[scorer];
      if (!was) continue;
      if (was.pass && !result.pass)
        regressions.push({ caseId: c.id, scorer, safety: after.scorers[scorer]?.safety ?? false });
      if (!was.pass && result.pass) fixes.push({ caseId: c.id, scorer });
    }
  }

  return {
    deltas: deltas.sort((x, y) => x.scorer.localeCompare(y.scorer)),
    regressions,
    fixes,
    // Worse than before: a safety case that used to pass now fails, a safety rate fell, or
    // a clean run became an unsafe one. An old failure that is still there is not news
    // here; the absolute gate is the exit code of the run itself.
    safetyRegressed:
      regressions.some((r) => r.safety) ||
      deltas.some((d) => d.safety && d.delta < 0) ||
      (before.safetyOk && !after.safetyOk),
  };
}

export function renderComparison(before: Report, after: Report, comparison: Comparison): string {
  const label = (r: Report) =>
    `${r.responder}${r.model ? `/${r.model}` : ''} ${r.promptVersion ?? ''}`.trim();
  const lines = [`# Comparison: ${label(before)} -> ${label(after)}`, ''];

  if (comparison.deltas.length === 0) lines.push('No scorer changed its pass rate.');
  else {
    lines.push('| Scorer | Kind | Before | After | Change |', '|---|---|---|---|---|');
    for (const d of comparison.deltas) {
      const sign = d.delta > 0 ? '+' : '';
      lines.push(
        `| ${d.scorer} | ${d.safety ? 'safety' : 'quality'} | ${d.before}% | ${d.after}% | ${sign}${d.delta} pp |`,
      );
    }
  }
  if (comparison.regressions.length > 0) {
    lines.push('', '## Now failing', '');
    for (const r of comparison.regressions)
      lines.push(`- ${r.caseId}: ${r.scorer}${r.safety ? ' (safety)' : ''}`);
  }
  if (comparison.fixes.length > 0) {
    lines.push('', '## Now passing', '');
    for (const f of comparison.fixes) lines.push(`- ${f.caseId}: ${f.scorer}`);
  }
  lines.push('', comparison.safetyRegressed ? '**Safety regressed.**' : 'Safety did not regress.');
  return lines.join('\n') + '\n';
}
