import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { pl } from '@/strings/pl';

export default function HistoryScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <Text variant="title">{pl.history.title}</Text>
    </View>
  );
}
