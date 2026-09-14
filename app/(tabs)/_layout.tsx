import { Tabs } from 'expo-router';

import { CalendarCheck, Dumbbell, Ellipsis, History, PersonStanding } from '@/components/ui/icons';
import { pl } from '@/strings/pl';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: pl.tabs.today,
          tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: pl.tabs.workout,
          tabBarIcon: ({ color, size }) => <Dumbbell color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="body"
        options={{
          title: pl.tabs.body,
          tabBarIcon: ({ color, size }) => <PersonStanding color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: pl.tabs.history,
          tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: pl.tabs.more,
          tabBarIcon: ({ color, size }) => <Ellipsis color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
