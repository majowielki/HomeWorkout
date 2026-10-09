import { z } from 'zod';
import { muscleGroupSchema } from './exercises.schema';
import { normalizeExerciseName } from '../src/domain/catalog/resolve';

const token = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const term = z.strictObject({ canonical: token, forms: z.array(z.string().trim().min(1)).min(1) });

/** Authored vocabulary, not executable patterns or an inferred medical classification. */
export const movementLexiconSchema = z
  .strictObject({
    version: z.number().int().positive(),
    stopWords: z.array(z.string().trim().min(1)),
    terms: z.array(term),
    phrases: z.array(term),
    qualifierGroups: z.array(z.array(token).min(1)),
    movements: z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]+$/),
        allOf: z.array(token).min(1),
        anyOf: z.array(token),
        muscles: z.array(muscleGroupSchema).min(1),
      }),
    ),
  })
  .superRefine((lexicon, ctx) => {
    const known = new Set([...lexicon.terms, ...lexicon.phrases].map((t) => t.canonical));
    const forms = new Map<string, string>();
    for (const field of ['terms', 'phrases'] as const) {
      const canonical = new Set<string>();
      lexicon[field].forEach((entry, i) => {
        if (canonical.has(entry.canonical))
          ctx.addIssue({
            code: 'custom',
            path: [field, i, 'canonical'],
            message: 'Duplicate canonical token',
          });
        canonical.add(entry.canonical);
        for (const form of [entry.canonical, ...entry.forms]) {
          const key = normalizeExerciseName(form);
          if (key === '')
            ctx.addIssue({
              code: 'custom',
              path: [field, i, 'forms'],
              message: 'Empty normalized form',
            });
          const owner = forms.get(key);
          if (owner !== undefined && owner !== entry.canonical)
            ctx.addIssue({
              code: 'custom',
              path: [field, i, 'forms'],
              message: `Form already means ${owner}`,
            });
          forms.set(key, entry.canonical);
        }
      });
    }
    const movementIds = new Set<string>();
    lexicon.movements.forEach((m, i) => {
      if (movementIds.has(m.id))
        ctx.addIssue({
          code: 'custom',
          path: ['movements', i, 'id'],
          message: 'Duplicate movement id',
        });
      movementIds.add(m.id);
      for (const t of [...m.allOf, ...m.anyOf])
        if (!known.has(t))
          ctx.addIssue({ code: 'custom', path: ['movements', i], message: `Unknown token: ${t}` });
    });
    lexicon.qualifierGroups.forEach((g, i) => {
      for (const t of g)
        if (!known.has(t))
          ctx.addIssue({
            code: 'custom',
            path: ['qualifierGroups', i],
            message: `Unknown token: ${t}`,
          });
    });
  });
