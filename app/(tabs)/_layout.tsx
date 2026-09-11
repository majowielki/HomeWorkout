import { Tabs } from 'expo-router';

import { pl } from '@/strings/pl';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: pl.tabs.today }} />
      <Tabs.Screen name="workout" options={{ title: pl.tabs.workout }} />
      <Tabs.Screen name="body" options={{ title: pl.tabs.body }} />
      <Tabs.Screen name="history" options={{ title: pl.tabs.history }} />
      <Tabs.Screen name="more" options={{ title: pl.tabs.more }} />
    </Tabs>
  );
}
