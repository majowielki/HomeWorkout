import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, Stack } from 'expo-router';
import { useMemo } from 'react';
import { SectionList, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { liveExercisesQuery } from '@/db/repositories/exercises';
import { screenExercise } from '@/domain/exercises/screen';
import type { Exercise, MovementPattern } from '@/domain/types';
import { ExerciseThumb } from '@/features/exercises/ExerciseThumb';
import { useMedicalProfile } from '@/features/exercises/useMedicalProfile';
import { cn } from '@/lib/cn';
import { pl } from '@/strings/pl';

const PATTERN_ORDER: MovementPattern[] = [
  'Squat',
  'Hinge',
  'Lunge',
  'Push',
  'Pull',
  'Isolation',
  'Core',
  'Carry',
  'Cardio',
  'Mobility',
];

type Row = { exercise: Exercise; excluded: boolean; pendingPhysio: boolean };

export default function ExercisesScreen() {
  const { data } = useLiveQuery(liveExercisesQuery());
  const profile = useMedicalProfile();

  const { sections, total, excludedCount } = useMemo(() => {
    const rows: Row[] = (data ?? [])
      .filter((r) => !r.data.archived)
      .map((r) => {
        const codes = screenExercise(r.data, profile);
        return {
          exercise: r.data,
          excluded: codes.length > 0,
          pendingPhysio: codes.length === 1 && codes[0] === 'KNEE_UNILATERAL_PENDING_PHYSIO',
        };
      });

    const byPattern = new Map<MovementPattern, Row[]>();
    for (const row of rows) {
      const list = byPattern.get(row.exercise.movementPattern) ?? [];
      list.push(row);
      byPattern.set(row.exercise.movementPattern, list);
    }

    return {
      sections: PATTERN_ORDER.filter((p) => byPattern.has(p)).map((p) => ({
        title: pl.labels.pattern[p],
        data: (byPattern.get(p) ?? []).sort((a, b) =>
          a.excluded === b.excluded
            ? a.exercise.name.localeCompare(b.exercise.name, 'pl')
            : a.excluded
              ? 1
              : -1,
        ),
      })),
      total: rows.length,
      excludedCount: rows.filter((r) => r.excluded).length,
    };
  }, [data, profile]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: pl.exercises.title }} />
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.exercise.id}
        contentContainerClassName="px-5 pb-12"
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <Text variant="muted" className="py-3">
            {total > 0 ? pl.exercises.countLabel(total, excludedCount) : pl.exercises.empty}
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="eyebrow" className="bg-background pb-3 pt-6">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/exercises/[id]', params: { id: item.exercise.id } }} asChild>
            <View
              className={cn(
                'mb-2.5 flex-row items-center gap-4 rounded-3xl border border-border bg-card p-3 active:opacity-70',
                item.excluded && 'opacity-60',
              )}
            >
              <ExerciseThumb
                mediaKey={item.exercise.media}
                className="h-[72px] w-[72px] rounded-2xl"
              />
              <View className="flex-1 gap-0.5">
                <Text variant="heading" className="text-base leading-5">
                  {item.exercise.name}
                </Text>
                <Text variant="muted">
                  {item.exercise.equipment.map((e) => pl.labels.equipment[e]).join(' · ')}
                </Text>
                {item.excluded ? (
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      item.pendingPhysio ? 'text-muted-foreground' : 'text-destructive',
                    )}
                  >
                    {item.pendingPhysio ? pl.exercises.pendingPhysio : pl.exercises.excluded}
                  </Text>
                ) : item.exercise.loadsKnee ? (
                  <Text className="font-display-medium text-xs text-warning">
                    {pl.exercises.kneeFlag}
                  </Text>
                ) : null}
              </View>
            </View>
          </Link>
        )}
      />
    </View>
  );
}
