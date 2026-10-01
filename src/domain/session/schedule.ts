/**
 * Rolling FBW A/B alternation — not tied to calendar days.
 *
 * The user's training is irregular by design (some weeks one session,
 * some weeks none), so "next template" only ever looks at what was done
 * last, never at how many days ago. See Documents/IMPLEMENTACJA.md §10.1.
 */
export function nextTemplateId(
  templates: readonly { id: string; sortOrder: number }[],
  lastTemplateId: string | null,
): string | null {
  if (templates.length === 0) return null;
  const sorted = [...templates].sort((a, b) => a.sortOrder - b.sortOrder);
  const lastIndex = sorted.findIndex((t) => t.id === lastTemplateId);
  if (lastIndex === -1) return sorted[0]!.id;
  return sorted[(lastIndex + 1) % sorted.length]!.id;
}
