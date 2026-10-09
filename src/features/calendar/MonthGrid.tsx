import { useMemo } from 'react';
import { PanResponder, Pressable, View } from 'react-native';

import { Bike, ChevronLeft, ChevronRight, Dumbbell } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import type { CalendarData } from '@/db/repositories/calendar';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { pl } from '@/strings/pl';

import { monthGrid, monthLabel, shiftMonth } from './dates';

type Props = {
  month: string;
  asOf: string;
  horizon: string;
  data: CalendarData;
  selected: string | null;
  onMonth: (month: string) => void;
  onSelect: (date: string) => void;
};

export function MonthGrid({ month, asOf, horizon, data, selected, onMonth, onSelect }: Props) {
  const dates = monthGrid(month);
  const next = shiftMonth(month, 1);
  const nextEnabled = next <= horizon.slice(0, 7);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2,
        onPanResponderRelease: (_, { dx, dy }) => {
          if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 2) return;
          const offset = dx > 0 ? -1 : 1;
          if (offset < 0 || nextEnabled) onMonth(shiftMonth(month, offset));
        },
      }),
    [month, nextEnabled, onMonth],
  );
  function move(offset: number) {
    if (offset < 0 || nextEnabled) onMonth(shiftMonth(month, offset));
  }
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pl.calendar.previous}
          onPress={() => move(-1)}
          className="h-12 w-12 items-center justify-center"
        >
          <ChevronLeft size={22} className="text-foreground" />
        </Pressable>
        <Text variant="title" className="capitalize">
          {monthLabel(month)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pl.calendar.next}
          disabled={!nextEnabled}
          accessibilityState={{ disabled: !nextEnabled }}
          onPress={() => move(1)}
          className={cn('h-12 w-12 items-center justify-center', !nextEnabled && 'opacity-25')}
        >
          <ChevronRight size={22} className="text-foreground" />
        </Pressable>
      </View>
      <View className="flex-row">
        {pl.calendar.weekdays.map((day) => (
          <Text key={day} variant="muted" className="flex-1 text-center text-xs">
            {day}
          </Text>
        ))}
      </View>
      <View {...pan.panHandlers} className="gap-1">
        {Array.from({ length: 6 }, (_, row) => {
          const week = dates.slice(row * 7, row * 7 + 7);
          const deload =
            data.days.some((d) => week.includes(d.date) && d.summary?.phase === 'deload') ||
            data.sessions.some(
              (s) =>
                week.includes(s.workout.trainingDate) &&
                data.days.find((d) => d.date === s.workout.trainingDate)?.summary?.phase ===
                  'deload',
            );
          return (
            <View key={week[0]} className={cn('flex-row rounded-xl', deload && 'bg-secondary/60')}>
              {week.map((date) => {
                const sessions = data.sessions.filter((s) => s.workout.trainingDate === date);
                const completed = sessions.filter((s) => s.workout.status === 'completed');
                const ride = data.rides.some((r) => r.trainingDate === date);
                const stored = data.days.find((d) => d.date === date);
                const planned =
                  date >= asOf &&
                  completed.length === 0 &&
                  stored?.status === 'planned' &&
                  !!stored.forecast;
                const missed = stored?.status === 'missed' && completed.length === 0;
                const disabled = date > horizon;
                const label = [
                  formatDate(date, 'long'),
                  date === asOf ? pl.tabs.today : '',
                  sessions.length ? pl.calendar.sessions(sessions.length) : '',
                  ride ? pl.workout.quickCardio : '',
                  planned ? pl.calendar.planned : '',
                  missed ? pl.calendar.missed : '',
                  deload ? pl.plan.deloadNote : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Pressable
                    key={date}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ disabled, selected: date === selected }}
                    disabled={disabled}
                    onPress={() => onSelect(date)}
                    className={cn(
                      'min-h-[70px] flex-1 items-center justify-center gap-1 rounded-xl border border-transparent',
                      date.slice(0, 7) !== month && 'opacity-40',
                      disabled && 'opacity-25',
                      date === asOf && 'border-primary',
                      date === selected && 'bg-secondary',
                    )}
                  >
                    <Text
                      className={cn('text-sm tabular-nums', date === asOf && 'font-display-bold')}
                    >
                      {Number(date.slice(8))}
                    </Text>
                    <View className="h-4 flex-row items-center justify-center gap-0.5">
                      {sessions.length > 0 || planned || missed ? (
                        <Dumbbell
                          size={12}
                          className={
                            completed.length ? 'text-foreground' : 'text-muted-foreground/50'
                          }
                        />
                      ) : null}
                      {sessions.length > 1 ? (
                        <Dumbbell size={12} className="text-foreground" />
                      ) : null}
                      {ride || planned ? (
                        <Bike
                          size={12}
                          className={ride ? 'text-foreground' : 'text-muted-foreground/50'}
                        />
                      ) : null}
                    </View>
                    <View
                      className={cn(
                        'h-1 w-1 rounded-full',
                        missed ? 'bg-destructive' : 'bg-transparent',
                      )}
                    />
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
      <Text variant="muted" className="text-xs leading-5">
        {pl.calendar.legend}
      </Text>
    </View>
  );
}
