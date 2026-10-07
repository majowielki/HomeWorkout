import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardDescription } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Check, PersonStanding } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { WarmupMoveId } from '@/domain/session/warmup';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

type Props = {
  moves: readonly WarmupMoveId[];
  onDone: () => void;
};

/**
 * First screen of a session: a general warm-up to tick off at one's own
 * pace. Nothing is stored — ticking is only for the person doing it, and
 * "Gotowe" works with any number of ticks.
 */
export function WarmupChecklist({ moves, onDone }: Props) {
  const [ticked, setTicked] = useState<ReadonlySet<WarmupMoveId>>(new Set());
  const t = pl.workout.warmup;

  const toggle = (id: WarmupMoveId) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ScrollView contentContainerClassName="gap-4 p-5">
      <Card className="gap-2 p-6">
        <IconBadge icon={PersonStanding} tone="accent" size="lg" className="mb-3" />
        <Text variant="title">{t.title}</Text>
        <CardDescription>{t.description}</CardDescription>
        <View className="mt-4 gap-2">
          {moves.map((id) => {
            const done = ticked.has(id);
            return (
              <Pressable
                key={id}
                onPress={() => toggle(id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3 active:opacity-80"
              >
                <View
                  className={cn(
                    'h-6 w-6 items-center justify-center rounded-full border-2',
                    done ? 'border-primary bg-primary' : 'border-muted-foreground',
                  )}
                >
                  {done ? <Check size={14} className="text-primary-foreground" /> : null}
                </View>
                <View className="flex-1">
                  <Text
                    className={cn(
                      'font-display-semibold text-base text-secondary-foreground',
                      done && 'opacity-60',
                    )}
                  >
                    {t.moves[id].name}
                  </Text>
                  <Text variant="muted" className="text-xs">
                    {t.moves[id].dose}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Button label={t.done} size="lg" onPress={onDone} />
      <Button label={t.skip} variant="ghost" onPress={onDone} />
    </ScrollView>
  );
}
