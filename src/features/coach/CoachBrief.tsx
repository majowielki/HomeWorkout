import { View } from 'react-native';

import type { BuiltCoachContext } from '@/ai/context/buildCoachContext';
import {
  buildWeeklySummaryPrompt,
  MEDICAL_REFERRAL,
  weeklySummaryBrief,
} from '@/ai/prompts/weeklySummary/v3';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

import { CopyButton } from './CopyButton';

/**
 * The brief card: what it contains, three ways to copy it, and a plain
 * statement of what was held back. The prompt asked for here is the
 * `readable` variant of the very text the Worker will later send, so the
 * manual stage tests the real thing.
 */
export function CoachBrief({ built }: { built: BuiltCoachContext }) {
  const { context, omissions } = built;
  const readable = buildWeeklySummaryPrompt(context, { format: 'readable' });
  const sparse = context.signals.includes('SPARSE_HISTORY');

  return (
    <>
      <Card>
        <Text variant="eyebrow">{pl.coach.briefEyebrow}</Text>
        <CardTitle className="mt-1">
          {pl.coach.summary(
            context.sessions.length,
            context.weight?.entries ?? 0,
            context.notes.length,
          )}
        </CardTitle>
        <CardDescription>
          {pl.coach.size(readable.instructions.length + readable.prompt.length)}
        </CardDescription>
        {sparse ? <Text className="mt-2 text-sm">{pl.coach.sparse}</Text> : null}
        <CardContent className="mt-4">
          <CopyButton
            variant="default"
            label={pl.coach.copyAll}
            text={() => `${readable.instructions}\n\n${readable.prompt}`}
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <CopyButton label={pl.coach.copyPrompt} text={() => readable.instructions} />
            </View>
            <View className="flex-1">
              <CopyButton label={pl.coach.copyBrief} text={() => weeklySummaryBrief(context)} />
            </View>
          </View>
        </CardContent>
      </Card>

      {omissions.medicalNotes > 0 ? (
        <Card variant="muted">
          <Text className="text-sm">{pl.coach.omittedMedical(omissions.medicalNotes)}</Text>
          <Text className="mt-1 text-sm font-semibold">{MEDICAL_REFERRAL}</Text>
        </Card>
      ) : null}
      {omissions.outOfScopeNotes > 0 ? (
        <Card variant="muted">
          <Text className="text-sm">{pl.coach.omittedScope(omissions.outOfScopeNotes)}</Text>
        </Card>
      ) : null}
    </>
  );
}
