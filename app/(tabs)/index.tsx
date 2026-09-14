import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

export default function TodayScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-background p-6">
      <Text variant="title">{pl.today.title}</Text>
      <Text variant="muted" className="text-center">
        {pl.today.empty}
      </Text>
    </View>
  );
}
