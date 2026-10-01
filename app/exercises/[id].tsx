import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { liveExerciseByIdQuery, liveExerciseNamesQuery } from '@/db/repositories/exercises';
import { screenExercise } from '@/domain/exercises/screen';
import { ExerciseThumb } from '@/features/exercises/ExerciseThumb';
import { useMedicalProfile } from '@/features/exercises/useMedicalProfile';
import { pl } from '@/strings/pl';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text variant="muted">{label}</Text>
      <Text className="flex-1 text-right">{value}</Text>
    </View>
  );
}

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useMedicalProfile();

  const { data } = useLiveQuery(liveExerciseByIdQuery(id), [id]);
  const exercise = data?.[0]?.data;

  const substituteIds = exercise?.substituteIds ?? [];
  const { data: substituteRows } = useLiveQuery(liveExerciseNamesQuery(substituteIds), [
    substituteIds.join(','),
  ]);

  const exclusions = useMemo(
    () => (exercise ? screenExercise(exercise, profile) : []),
    [exercise, profile],
  );

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ title: '' }} />
        <Text variant="muted">{pl.common.notFound}</Text>
      </View>
    );
  }

  const s = pl.exercises.sections;
  const b = pl.exercises.biomechanics;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <Stack.Screen options={{ title: exercise.name }} />

      {exercise.media ? (
        <View className="flex-row gap-2">
          <ExerciseThumb mediaKey={exercise.media} frame={0} className="aspect-[4/3] flex-1" />
          <ExerciseThumb mediaKey={exercise.media} frame={1} className="aspect-[4/3] flex-1" />
        </View>
      ) : (
        <Text variant="muted">{s.noMedia}</Text>
      )}

      {exclusions.length > 0 ? (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardTitle className="text-destructive">{s.whyExcluded}</CardTitle>
          <CardContent>
            {exclusions.map((code) => (
              <Text key={code} className="text-sm">
                • {pl.exclusion[code]}
              </Text>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{s.cues}</CardTitle>
        <CardContent>
          {exercise.cues.map((cue, i) => (
            <Text key={i} className="leading-6">
              {i + 1}. {cue}
            </Text>
          ))}
        </CardContent>
      </Card>

      {exercise.kneeCue ? (
        <Card className="border-primary/30">
          <CardTitle>{s.kneeCue}</CardTitle>
          <CardContent>
            <Text className="leading-6">{exercise.kneeCue}</Text>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{s.muscles}</CardTitle>
        <CardContent>
          <Row
            label={s.primary}
            value={exercise.primaryMuscles.map((m) => pl.labels.muscle[m]).join(', ')}
          />
          {exercise.secondaryMuscles.length > 0 ? (
            <Row
              label={s.secondary}
              value={exercise.secondaryMuscles.map((m) => pl.labels.muscle[m]).join(', ')}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{s.equipment}</CardTitle>
        <CardContent>
          <Text>{exercise.equipment.map((e) => pl.labels.equipment[e]).join(', ')}</Text>
          {exercise.dumbbellMode ? (
            <Text variant="muted">{pl.labels.dumbbellMode[exercise.dumbbellMode]}</Text>
          ) : null}
          {exercise.equipment.includes('band') || exercise.bandSuitability !== 'ok' ? (
            <Row label={b.bandFit} value={pl.labels.bandSuitability[exercise.bandSuitability]} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardTitle>{s.biomechanics}</CardTitle>
        <CardContent>
          <Row label={b.pattern} value={pl.labels.pattern[exercise.movementPattern]} />
          <Row
            label={b.planes}
            value={exercise.planesOfMotion.map((p) => pl.labels.plane[p]).join(', ')}
          />
          <Row
            label={b.chain}
            value={exercise.isClosedKineticChain ? b.closedChain : b.openChain}
          />
          <Row label={b.stance} value={pl.labels.stance[exercise.stanceMechanics]} />
        </CardContent>
      </Card>

      {substituteRows && substituteRows.length > 0 ? (
        <Card>
          <CardTitle>{s.substitutes}</CardTitle>
          <CardContent>
            {substituteRows.map((sub) => (
              <Link
                key={sub.id}
                href={{ pathname: '/exercises/[id]', params: { id: sub.id } }}
                className="py-1 text-base text-primary"
              >
                {sub.name}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}
