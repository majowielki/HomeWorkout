import { Link } from 'expo-router';
import { ActivityIndicator, Pressable } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, Play } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { Exercise } from '@/domain/types';
import { SessionHero } from '@/features/workout/SessionHero';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

import { DayDoneCard } from './DayDoneCard';
import { planTitle } from './format';
import type { usePlanToday } from './usePlanToday';

type Props = {
  today: ReturnType<typeof usePlanToday>;
  exerciseMap: Record<string, Exercise>;
};

/**
 * Today's plan from the rules engine as the hero of "Dziś" and "Trening":
 * what, roughly how long, start — and the way to "why". Once today's
 * session is done: the recovery, and tomorrow's plan to look at.
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

  const details = (
    <Link href="/plan" asChild>
      <Pressable className="flex-row items-center justify-center gap-1 py-2 active:opacity-70">
        <Text className="font-display-semibold text-sm text-primary">{pl.plan.details}</Text>
        <ArrowRight size={16} className="text-primary" />
      </Pressable>
    </Link>
  );

  // Today is behind: what rests, then tomorrow as it stands — nothing to start.
  if (state.done) {
    const next = state.tomorrow;
    return (
      <>
        <DayDoneCard recovery={state.recovery} />
        {next ? (
          <SessionHero
            eyebrow={pl.plan.tomorrowEyebrow(formatDate(next.date))}
            title={planTitle(next)}
            badge={
              next.phase === 'deload'
                ? pl.plan.deloadBadge(next.blockIndex)
                : pl.plan.blockBadge(next.blockIndex)
            }
            meta={pl.plan.meta(next.estimatedMinutes)}
            blocks={next.exercises}
            exerciseMap={exerciseMap}
          >
            {details}
          </SessionHero>
        ) : null}
      </>
    );
  }

  const { plan } = state;
  return (
    <SessionHero
      eyebrow={pl.plan.eyebrow(formatDate(plan.date))}
      title={planTitle(plan)}
      badge={
        plan.phase === 'deload'
          ? pl.plan.deloadBadge(plan.blockIndex)
          : pl.plan.blockBadge(plan.blockIndex)
      }
      meta={pl.plan.meta(plan.estimatedMinutes)}
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
      {details}
    </SessionHero>
  );
}
