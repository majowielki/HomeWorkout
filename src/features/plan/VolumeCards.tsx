import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { acceptVolumeCard, readVolumeCards } from '@/db/repositories/volumeLever';
import type { VolumeCard } from '@/domain/volume/lever';
import { pl } from '@/strings/pl';

/** Cards the person said "not now" to, for as long as the app runs: the lever never insists. */
const notNow = new Set<string>();
const keyOf = (c: VolumeCard) => `${c.muscle}:${c.change}:${c.toMax}`;

type Props = {
  /** The plan was read again with the new maximum. */
  onChanged: () => void;
  read?: typeof readVolumeCards;
  accept?: typeof acceptVolumeCard;
};

/**
 * The volume lever (D32): the engine does not raise or lower the weekly sets by itself. It notices — a
 * muscle whose key lifts stand still while it recovers well could take more, one that is often sore
 * should take less — and offers a new weekly maximum. The person takes it or leaves it.
 */
export function VolumeCards({
  onChanged,
  read = readVolumeCards,
  accept = acceptVolumeCard,
}: Props) {
  const [cards, setCards] = useState<VolumeCard[]>([]);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    try {
      setCards(read().filter((c) => !notNow.has(keyOf(c))));
    } catch (e) {
      // A suggestion is a convenience: failing to work it out hides it and nothing else.
      console.warn('could not read the volume lever', e);
      setCards([]);
    }
  }, [read]);
  useEffect(load, [load]);

  if (cards.length === 0 && !error) return null;
  const t = pl.plan.volumeLever;
  return (
    <View className="gap-3">
      {error ? <Text className="text-sm text-destructive">{t.error}</Text> : null}
      {cards.map((c) => (
        <View key={keyOf(c)} className="gap-2 rounded-2xl border border-border p-3">
          <Text className="font-display-semibold text-sm">
            {c.change === 'increase'
              ? t.moreTitle(pl.labels.muscle[c.muscle])
              : t.lessTitle(pl.labels.muscle[c.muscle])}
          </Text>
          <Text variant="muted" className="text-sm">
            {c.reasons.map((r) => t.reason[r]).join(' ')} {t.change(c.fromMax, c.toMax)}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                size="sm"
                label={c.change === 'increase' ? t.raise : t.lower}
                onPress={() => {
                  let done = false;
                  try {
                    done = accept(c);
                  } catch (e) {
                    console.warn('could not apply the volume card', e);
                  }
                  setError(!done);
                  load();
                  if (done) onChanged();
                }}
              />
            </View>
            <View className="flex-1">
              <Button
                size="sm"
                variant="outline"
                label={t.notNow}
                onPress={() => {
                  notNow.add(keyOf(c));
                  load();
                }}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
