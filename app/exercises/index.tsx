import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack } from 'expo-router';
import { FlatList, View } from 'react-native';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { exercises } from '@/db/schema';
import { pl } from '@/strings/pl';

export default function ExercisesScreen() {
  const { data } = useLiveQuery(db.select().from(exercises));
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: pl.exercises.title }} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        ListHeaderComponent={
          rows.length > 0 ? (
            <Text variant="muted">{pl.exercises.countLabel(rows.length)}</Text>
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text variant="muted">{pl.exercises.empty}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card>
            <CardTitle>{item.name}</CardTitle>
            <CardDescription>
              {item.data.movementPattern} · {item.data.equipment.join(', ')}
            </CardDescription>
            {item.data.loadsKnee ? (
              <Text variant="muted" className="mt-2 text-destructive">
                {pl.exercises.kneeFlag}
              </Text>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}
