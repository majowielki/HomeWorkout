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
import { PlanChangeBanner } from './PlanChangeBanner';
import { PlanningFeedback } from './PlanningFeedback';
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

  const banner = state.banner ? (
    <PlanChangeBanner banner={state.banner} onClose={(id) => void today.dismissBanner(id)} />
  ) : null;

  // A day without a session to start: trained already, or a rest day. What
  // rests (after training), then the next planned day to look at.
  if (state.done || !state.plan) {
    const upcoming = state.week.find((d) => d.date > state.asOf && d.forecast)?.forecast ?? null;
    const next = state.done ? (state.tomorrow ?? upcoming) : upcoming;
    const summary = state.week.find((d) => d.date === next?.trainingDate)?.summary;
    return (
      <>
        {banner}
        {!state.done ? <PlanningFeedback result={state.preview.output.result} /> : null}
        {state.done ? (
          <DayDoneCard recovery={state.recovery} />
        ) : state.rest ? (
          <RestDayCard />
        ) : (
          <Card>
            <Text variant="title">{pl.calendar.noPlan}</Text>
          </Card>
        )}
        {state.done ? (
          <Link href="/plan/extra" asChild>
            <Button label={pl.extra.title} variant="outline" />
          </Link>
        ) : null}
        {next ? (
          <SessionHero
            eyebrow={
              state.done && state.tomorrow
                ? pl.plan.tomorrowEyebrow(formatDate(next.trainingDate))
                : pl.plan.restDay.next(formatDate(next.trainingDate))
            }
            title={planTitle(next)}
            badge={
              summary?.phase === 'deload'
                ? pl.plan.deloadBadge(summary?.blockIndex ?? 1)
                : pl.plan.blockBadge(summary?.blockIndex ?? 1)
            }
            meta={pl.plan.meta(Math.ceil(next.time.exerciseTotal / 60))}
            plan={next}
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
    <>
      {banner}
      <PlanningFeedback result={state.preview.output.result} />
      <SessionHero
        eyebrow={pl.plan.eyebrow(formatDate(plan.trainingDate))}
        title={planTitle(plan)}
        badge={
          state.summary.phase === 'deload'
            ? pl.plan.deloadBadge(state.summary.blockIndex ?? 1)
            : pl.plan.blockBadge(state.summary.blockIndex ?? 1)
        }
        meta={pl.plan.meta(Math.ceil(plan.time.exerciseTotal / 60))}
        plan={plan}
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
    </>
  );
}

function RestDayCard() {
  const t = pl.plan.restDay;
  return (
    <Card className="gap-2 p-6">
      <Text variant="eyebrow">{t.eyebrow}</Text>
      <Text variant="title">{t.title}</Text>
      <Text variant="muted">{t.body}</Text>
    </Card>
  );
}
