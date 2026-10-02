import { Link } from 'expo-router';
import { ActivityIndicator, Pressable } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, Play } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { Exercise } from '@/domain/types';
import { SessionHero } from '@/features/workout/SessionHero';
import { pl } from '@/strings/pl';

import { planTitle } from './format';
import type { usePlanToday } from './usePlanToday';

type Props = {
  today: ReturnType<typeof usePlanToday>;
  exerciseMap: Record<string, Exercise>;
};

/**
 * Today's plan from the rules engine as the hero of "Dziś" and "Trening":
 * what, roughly how long, start — and the way to "why".
 */
export function PlanHero({ today, exerciseMap }: Props) {
  const { state } = today;

  if (state.status === 'loading') {
    return (
      <Card className="items-center p-8">
        <ActivityIndicator />
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card className="gap-3 p-6">
        <Text>{pl.plan.loadError}</Text>
        <Button label={pl.plan.retry} variant="inverse" onPress={() => void today.reload()} />
      </Card>
    );
  }

  const { plan } = state;
  return (
    <SessionHero
      eyebrow={pl.plan.eyebrow}
      title={planTitle(plan)}
      badge={
        plan.phase === 'deload'
          ? pl.plan.deloadBadge(plan.blockIndex)
          : pl.plan.blockBadge(plan.blockIndex)
      }
      meta={pl.plan.meta(plan.estimatedMinutes, plan.bike.minutes)}
      blocks={plan.exercises}
      exerciseMap={exerciseMap}
    >
      <Button
        size="lg"
        label={pl.plan.start}
        icon={<Play size={18} className="text-primary-foreground" />}
        onPress={() => void today.start()}
        disabled={today.starting}
      />
      <Link href="/plan" asChild>
        <Pressable className="flex-row items-center justify-center gap-1 py-2 active:opacity-70">
          <Text className="font-display-semibold text-sm text-primary">{pl.plan.details}</Text>
          <ArrowRight size={16} className="text-primary" />
        </Pressable>
      </Link>
    </SessionHero>
  );
}
