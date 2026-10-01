import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';

import { weeklySummaryBrief } from '@/ai/prompts/weeklySummary/v1';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { CopyButton } from '@/features/coach/CopyButton';
import { useCoachBrief } from '@/features/coach/useCoachBrief';
import { pl } from '@/strings/pl';

/**
 * "What do I send?" — the exact block a model receives, indented so a
 * person can read it. It is built by the same function as the copy button
 * and the future Worker request, so what is shown cannot drift from what
 * is sent. See Documents/AI-INTEGRACJA I9.
 */
export default function PayloadScreen() {
  const state = useCoachBrief();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: pl.coach.payloadTitle }} />
      <Text variant="muted">{pl.coach.payloadIntro}</Text>

      {state.status === 'loading' ? <Text variant="muted">{pl.coach.loading}</Text> : null}
      {state.status === 'error' ? (
        <Text className="text-destructive">{pl.coach.loadError}</Text>
      ) : null}

      {state.status === 'ready' ? (
        <PayloadBody text={weeklySummaryBrief(state.built.context, { pretty: true })} />
      ) : null}
    </ScrollView>
  );
}

function PayloadBody({ text }: { text: string }) {
  return (
    <Card>
      <CardDescription>{pl.coach.size(text.length)}</CardDescription>
      <CardContent className="mt-3">
        <CopyButton label={pl.coach.copyBrief} text={() => text} />
        <Text selectable className="mt-2 font-mono text-xs leading-5">
          {text}
        </Text>
      </CardContent>
    </Card>
  );
}
