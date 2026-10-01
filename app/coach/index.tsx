import { Link, Stack } from 'expo-router';
import { ScrollView } from 'react-native';

import { Card } from '@/components/ui/card';
import { Eye } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { AiSummarySection } from '@/features/coach/AiSummarySection';
import { CoachBrief } from '@/features/coach/CoachBrief';
import { useCoachBrief } from '@/features/coach/useCoachBrief';
import { pl } from '@/strings/pl';

/**
 * M8 / A0: the manual stage. The app assembles the brief, the person pastes
 * it into a model of their choice and decides whether the answers are worth
 * building an integration for. Nothing leaves the device unless they copy
 * it. See Documents/AI-INTEGRACJA.md §10 (A0).
 */
export default function CoachScreen() {
  const state = useCoachBrief();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 px-5 pb-12 pt-4">
      <Stack.Screen options={{ title: pl.coach.title }} />

      <Text variant="muted">{pl.coach.intro}</Text>

      {state.status === 'loading' ? <Text variant="muted">{pl.coach.loading}</Text> : null}
      {state.status === 'error' ? (
        <Text className="text-destructive">{pl.coach.loadError}</Text>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <CoachBrief built={state.built} />
          <AiSummarySection context={state.built.context} />
          <Card className="py-1">
            <Link href="/coach/payload" asChild>
              <ListRow
                icon={Eye}
                title={pl.coach.viewPayload}
                subtitle={pl.coach.viewPayloadHint}
              />
            </Link>
          </Card>
          <Card variant="muted">
            <Text variant="eyebrow">{pl.coach.howToEyebrow}</Text>
            <Text className="mt-1 text-sm">{pl.coach.howTo}</Text>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
