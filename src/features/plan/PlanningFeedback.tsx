import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { PlanningResult } from '@/domain/plan/repair';
import { checkText } from '@/domain/session/assessmentText';
import { pl } from '@/strings/pl';

/** Shows the audit's reason for a shortened or unavailable day. */
export function PlanningFeedback({ result }: { result: PlanningResult }) {
  const issues = 'notes' in result ? result.notes : result.reasons;
  const lines = [...new Set(issues.filter((i) => i.status !== 'pass').map((i) => checkText(i)))];
  if (result.kind === 'ready' && lines.length === 0) return null;
  if (result.kind === 'adjusted' && lines.length === 0) lines.push(pl.plan.adjustedPlan);
  return (
    <Card className="gap-2">
      {lines.map((line) => (
        <Text key={line} className="text-sm leading-5">
          {line}
        </Text>
      ))}
    </Card>
  );
}
