import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { HeroGlow } from '@/components/ui/hero-glow';
import { IconBadge } from '@/components/ui/icon-badge';
import { Dumbbell, Sparkles } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { Exercise } from '@/domain/types';
import type { SessionPlanV2 } from '@/domain/plan/planV2';

import { ExercisePreview } from './ExercisePreview';

type Props = {
  eyebrow: string;
  title: string;
  meta?: string;
  /** Status pill top-left, e.g. "Sugerowane" or "w trakcie". */
  badge?: string;
  plan?: SessionPlanV2;
  exerciseMap?: Record<string, Exercise>;
  /** Buttons — use the default (accent) variant for the main one. */
  children?: React.ReactNode;
};

/**
 * The ink card with the lime glow: the one thing on "Dziś" and "Trening"
 * the eye should land on first — the next (or unfinished) session.
 */
export function SessionHero({ eyebrow, title, meta, badge, plan, exerciseMap, children }: Props) {
  return (
    <Card variant="inverse" className="gap-5 p-6">
      <HeroGlow />
      <View className="flex-row items-start justify-between">
        {badge ? (
          <Badge
            variant="onInverse"
            label={badge}
            icon={<Sparkles size={12} className="text-primary" />}
          />
        ) : (
          <View />
        )}
        <IconBadge icon={Dumbbell} tone="glow" />
      </View>

      <View className="gap-1.5">
        <Text variant="eyebrow" className="text-inverse-muted">
          {eyebrow}
        </Text>
        <Text variant="display" className="text-inverse-foreground">
          {title}
        </Text>
        {meta ? <Text className="text-sm text-inverse-muted">{meta}</Text> : null}
      </View>

      {plan && exerciseMap && plan.exposures.length > 0 ? (
        <ExercisePreview plan={plan} exerciseMap={exerciseMap} onInverse />
      ) : null}

      {children ? <View className="gap-2">{children}</View> : null}
    </Card>
  );
}
