import { Text, View } from 'react-native';

import { pl } from '@/strings/pl';

export default function WorkoutScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-neutral-950">
      <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {pl.workout.title}
      </Text>
    </View>
  );
}
