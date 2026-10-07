import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CalendarCheck,
  CalendarDays,
  Ellipsis,
  History,
  type LucideIcon,
  PersonStanding,
} from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { fonts, useThemeColors } from '@/lib/theme';
import { pl } from '@/strings/pl';

/** Material-3-style indicator: the active icon sits in an accent pill. */
function TabIcon({ icon: Icon, focused }: { icon: LucideIcon; focused: boolean }) {
  return (
    <View
      className={cn(
        'h-8 w-14 items-center justify-center rounded-full',
        focused ? 'bg-primary' : 'bg-transparent',
      )}
    >
      <Icon
        size={20}
        strokeWidth={focused ? 2.4 : 2}
        className={focused ? 'text-primary-foreground' : 'text-muted-foreground'}
      />
    </View>
  );
}

export default function TabsLayout() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const tab = (icon: LucideIcon) => ({
    tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon icon={icon} focused={focused} />,
  });

  return (
    <Tabs
      screenOptions={{
        // Tab screens draw their own large <PageHeader> inside the scroll view.
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontFamily: fonts.displayMedium, fontSize: 11, marginTop: 2 },
        tabBarItemStyle: { paddingTop: 8 },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 68 + insets.bottom,
          elevation: 0,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: pl.tabs.today, ...tab(CalendarCheck) }} />
      <Tabs.Screen name="workout" options={{ title: pl.tabs.calendar, ...tab(CalendarDays) }} />
      <Tabs.Screen name="body" options={{ title: pl.tabs.body, ...tab(PersonStanding) }} />
      <Tabs.Screen name="history" options={{ title: pl.tabs.history, ...tab(History) }} />
      <Tabs.Screen name="more" options={{ title: pl.tabs.more, ...tab(Ellipsis) }} />
    </Tabs>
  );
}
