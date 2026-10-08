import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Card, CardDescription } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Check, GalleryHorizontalEnd, List, PersonStanding } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { WarmupMoveId } from '@/domain/session/warmup';
import { cn } from '@/lib/cn';
import { getWarmupView, setWarmupView, type WarmupView } from '@/lib/warmupView';
import { pl } from '@/strings/pl';

/** What "dalej" by voice did, so "Cofnij" can take it back. */
export type WarmupStep =
  | { kind: 'ticked'; id: WarmupMoveId; index: number }
  /** It was the last move: the warm-up is over, like "Gotowe". */
  | { kind: 'finished' };

/** The voice's way in: the same as "Zrobione, dalej" in the cards, the next unticked move in the list. */
export interface WarmupHandle {
  next(): WarmupStep;
  /** Takes a tick back, and in the cards goes back to that move. */
  untick(step: Extract<WarmupStep, { kind: 'ticked' }>): void;
}

type Props = {
  moves: readonly WarmupMoveId[];
  onDone: () => void;
  ref?: Ref<WarmupHandle>;
};

/**
 * First screen of a session: a general warm-up to tick off at one's own
 * pace. Nothing is stored — ticking is only for the person doing it, and
 * "Gotowe" works with any number of ticks.
 *
 * Two views of the same ticks: the checklist, and one big card per move —
 * readable from a couple of metres away when the phone lies on the floor.
 * The chosen view is remembered.
 */
export function WarmupChecklist({ moves, onDone, ref }: Props) {
  const [ticked, setTicked] = useState<ReadonlySet<WarmupMoveId>>(new Set());
  const [view, setView] = useState<WarmupView>(getWarmupView);
  const cards = useRef<CardsHandle>(null);

  const toggle = (id: WarmupMoveId) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const tick = (id: WarmupMoveId) => setTicked((prev) => new Set(prev).add(id));

  useImperativeHandle(ref, () => ({
    next() {
      if (view === 'cards' && cards.current) return cards.current.next();
      const index = moves.findIndex((id) => !ticked.has(id));
      const id = moves[index];
      if (id === undefined) {
        onDone();
        return { kind: 'finished' };
      }
      tick(id);
      return { kind: 'ticked', id, index };
    },
    untick(step) {
      setTicked((prev) => {
        const rest = new Set(prev);
        rest.delete(step.id);
        return rest;
      });
      if (view === 'cards') cards.current?.goTo(step.index);
    },
  }));

  const switchView = () => {
    const next = view === 'list' ? 'cards' : 'list';
    setView(next);
    setWarmupView(next);
  };

  return view === 'cards' ? (
    <WarmupCards
      ref={cards}
      moves={moves}
      ticked={ticked}
      onToggle={toggle}
      onTick={tick}
      onSwitch={switchView}
      onDone={onDone}
    />
  ) : (
    <WarmupList
      moves={moves}
      ticked={ticked}
      onToggle={toggle}
      onSwitch={switchView}
      onDone={onDone}
    />
  );
}

function ViewSwitch({ view, onPress }: { view: WarmupView; onPress: () => void }) {
  const Icon = view === 'list' ? GalleryHorizontalEnd : List;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        view === 'list' ? pl.workout.warmup.showCards : pl.workout.warmup.showList
      }
      className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-70"
    >
      <Icon size={20} className="text-secondary-foreground" />
    </Pressable>
  );
}

function WarmupList({
  moves,
  ticked,
  onToggle,
  onSwitch,
  onDone,
}: {
  moves: readonly WarmupMoveId[];
  ticked: ReadonlySet<WarmupMoveId>;
  onToggle: (id: WarmupMoveId) => void;
  onSwitch: () => void;
  onDone: () => void;
}) {
  const t = pl.workout.warmup;
  return (
    <ScrollView contentContainerClassName="gap-4 p-5">
      <Card className="gap-2 p-6">
        <IconBadge icon={PersonStanding} tone="accent" size="lg" className="mb-3" />
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="title">{t.title}</Text>
          <ViewSwitch view="list" onPress={onSwitch} />
        </View>
        <CardDescription>{t.description}</CardDescription>
        <View className="mt-4 gap-2">
          {moves.map((id) => {
            const done = ticked.has(id);
            return (
              <Pressable
                key={id}
                onPress={() => onToggle(id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3 active:opacity-80"
              >
                <TickMark done={done} size="sm" />
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

interface CardsHandle {
  next(): WarmupStep;
  goTo(index: number): void;
}

function WarmupCards({
  moves,
  ticked,
  onToggle,
  onTick,
  onSwitch,
  onDone,
  ref,
}: {
  moves: readonly WarmupMoveId[];
  ticked: ReadonlySet<WarmupMoveId>;
  onToggle: (id: WarmupMoveId) => void;
  onTick: (id: WarmupMoveId) => void;
  onSwitch: () => void;
  onDone: () => void;
  ref?: Ref<CardsHandle>;
}) {
  const t = pl.workout.warmup;
  const list = useRef<FlatList<WarmupMoveId>>(null);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const last = index === moves.length - 1;
  const current = moves[index];

  const goTo = (i: number) => {
    setIndex(i);
    list.current?.scrollToIndex({ index: i, animated: true });
  };

  const handleDone = (): WarmupStep => {
    if (current) onTick(current);
    if (last || !current) {
      onDone();
      return { kind: 'finished' };
    }
    goTo(index + 1);
    return { kind: 'ticked', id: current, index };
  };

  useImperativeHandle(ref, () => ({ next: handleDone, goTo }));

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width === 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(moves.length - 1, i)));
  };

  return (
    <View className="flex-1 gap-4 py-4">
      <View className="flex-row items-center justify-between px-5">
        <View>
          <Text variant="title">{t.title}</Text>
          <Text variant="muted">{t.cardCounter(index + 1, moves.length)}</Text>
        </View>
        <ViewSwitch view="cards" onPress={onSwitch} />
      </View>

      <View
        className="flex-1"
        testID="warmup-cards"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <FlatList
            ref={list}
            data={moves}
            keyExtractor={(id) => id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            renderItem={({ item }) => {
              const done = ticked.has(item);
              return (
                <View style={{ width }} className="px-5">
                  <Pressable
                    onPress={() => onToggle(item)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={t.moves[item].name}
                    className={cn(
                      'flex-1 items-center justify-center gap-6 rounded-3xl p-8 active:opacity-90',
                      done ? 'bg-primary/15' : 'bg-card',
                    )}
                  >
                    <TickMark done={done} size="lg" />
                    <Text className="text-center font-display-semibold text-5xl leading-[56px] text-card-foreground">
                      {t.moves[item].name}
                    </Text>
                    <Text className="text-center font-display-medium text-3xl leading-10 text-highlight">
                      {t.moves[item].dose}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
          />
        ) : null}
      </View>

      <View className="flex-row justify-center gap-2">
        {moves.map((id, i) => (
          <View
            key={id}
            className={cn(
              'h-2 rounded-full',
              i === index ? 'w-6 bg-foreground' : 'w-2',
              i !== index && (ticked.has(id) ? 'bg-primary' : 'bg-secondary'),
            )}
          />
        ))}
      </View>

      <View className="gap-1 px-5">
        <Button
          size="lg"
          label={last ? t.done : t.cardDone}
          icon={<Check size={20} className="text-primary-foreground" />}
          onPress={() => void handleDone()}
        />
        <Button label={t.skip} variant="ghost" onPress={onDone} />
      </View>
    </View>
  );
}

function TickMark({ done, size }: { done: boolean; size: 'sm' | 'lg' }) {
  return (
    <View
      className={cn(
        'items-center justify-center rounded-full border-2',
        size === 'sm' ? 'h-6 w-6' : 'h-16 w-16 border-4',
        done ? 'border-primary bg-primary' : 'border-muted-foreground',
      )}
    >
      {done ? <Check size={size === 'sm' ? 14 : 36} className="text-primary-foreground" /> : null}
    </View>
  );
}
