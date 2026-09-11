import { Text, View } from 'react-native';

import { pl } from '@/strings/pl';

export default function TodayScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-white p-6 dark:bg-neutral-950">
      <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {pl.today.title}
      </Text>
      <Text className="text-center text-neutral-500 dark:text-neutral-400">
        {pl.today.empty}
      </Text>
    </View>
  );
}
