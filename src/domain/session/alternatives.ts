/** P4b.3, T67/T75: verdict → biomechanics → preference, with no recursive assessment. */
import { equipmentFamilyOf } from '../catalog/attributes';
import { buildVariantGraph } from '../catalog/variants';
import { biomechSimilarity } from '../exercises/substitute';
import { compareCodePoints } from '../fingerprint';
import { slotByExercise } from '../plan/eligibility';
import { preferenceScore } from '../preferences/preferences';
import { evaluateSessionChange } from './evaluate';
import type {
  AlternativeReason,
  AlternativesTarget,
  AssessmentContext,
  RankedAlternative,
  SessionChangeEvaluation,
} from './types';

/** Credit only the deficit actually covered, never sets above the minimum. */
function weekMinHelped(a: SessionChangeEvaluation): number {
  return a.checks.reduce((sum, c) => {
    if (c.code !== 'WEEK_MIN_HELPED') return sum;
    const { before, after, min } = c.data;
    return sum + Math.max(0, Math.min(Number(after), Number(min)) - Number(before));
  }, 0);
}

export function rankAlternatives(
  target: AlternativesTarget,
  ctx: AssessmentContext,
): RankedAlternative[] {
  const limit = ctx.maxAlternatives ?? 3;
  if (!Number.isFinite(limit) || limit < 1) return [];
  const { snap, session, change } = ctx;
  const original = target.exerciseId === undefined ? undefined : snap.catalog[target.exerciseId];
  const slots = slotByExercise(snap.slots);
  const slot =
    target.slotId === undefined
      ? original === undefined
        ? undefined
        : slots.get(original.id)
      : snap.slots.find((s) => s.id === target.slotId);
  const candidates = new Map<string, AlternativeReason[]>();
  const add = (id: string, why: AlternativeReason) => {
    const e = snap.catalog[id];
    if (e === undefined || e.archived || id === target.exerciseId) return;
    const reasons = candidates.get(id) ?? [];
    if (!reasons.includes(why)) candidates.set(id, [...reasons, why]);
  };
  if (original !== undefined) {
    const graph = buildVariantGraph(Object.values(snap.catalog));
    for (const id of graph.easier.get(original.id) ?? []) add(id, 'variant_easier');
    for (const id of graph.harder.get(original.id) ?? []) add(id, 'variant_harder');
    for (const id of original.substituteIds) add(id, 'substitute');
    if (original.comparisonFamily != null)
      for (const e of Object.values(snap.catalog))
        if (e.comparisonFamily === original.comparisonFamily) add(e.id, 'same_family');
  }
  for (const id of slot?.exerciseIds ?? []) add(id, 'same_slot');
  if (original === undefined && target.muscles.length > 0)
    for (const e of Object.values(snap.catalog))
      if (e.primaryMuscles.some((m) => target.muscles.includes(m))) add(e.id, 'substitute');

  const ranked: { alternative: RankedAlternative; key: number[] }[] = [];
  // Audit the complete pool before truncation: a lower biomechanical score can have the best verdict.
  for (const [id, reasons] of candidates) {
    if (ctx.variantDirection !== undefined && !reasons.includes(`variant_${ctx.variantDirection}`))
      continue;
    const e = snap.catalog[id]!;
    if (ctx.equipmentFamily !== undefined && equipmentFamilyOf(e) !== ctx.equipmentFamily) continue;
    const intent = { ...change, exercise: { id } };
    const a = evaluateSessionChange(snap, session, intent);
    // Every hard failure has a null patch. Explicit exercise intents with a patch have a prescription.
    if (a.patch === null) continue;
    const preference = preferenceScore(e, snap.preferences);
    const helped = weekMinHelped(a);
    const why = [...reasons];
    if (preference > 0) why.push('preference');
    if (helped > 0) why.push('week_min_helped');
    const similarity =
      original === undefined
        ? target.muscles.length === 0
          ? 0
          : e.primaryMuscles.filter((m) => target.muscles.includes(m)).length /
            target.muscles.length
        : biomechSimilarity(original, e);
    // No slot recipe is a hard failure, already excluded by the leaf assessment.
    const candidateSlot = slots.get(id)!;
    ranked.push({
      alternative: {
        exerciseId: id,
        why: why.sort(compareCodePoints),
        verdict: a.verdict,
        prescription: a.prescription!,
        patchId: a.patch.patchId,
        change: intent,
        assessment: a,
      },
      key: [
        a.verdict === 'ok' || a.verdict === 'ok_with_changes' ? -1 : 0,
        -similarity,
        -preference,
        -helped,
        a.effects.overlapToday.length,
        a.checks.filter((c) => c.code === 'RECOVERING' || c.code === 'DOMS_HIGH').length,
        candidateSlot.exerciseIds.indexOf(id),
      ],
    });
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < a.key.length; i += 1) {
      if (a.key[i] !== b.key[i]) return a.key[i]! < b.key[i]! ? -1 : 1;
    }
    return compareCodePoints(a.alternative.exerciseId, b.alternative.exerciseId);
  });
  return ranked.slice(0, Math.min(3, Math.floor(limit))).map((r) => r.alternative);
}
