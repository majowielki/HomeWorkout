import '../global.css';
import '@/lib/interop';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DatabaseProvider } from '@/db/provider';
import { useIsDark, useThemeColors } from '@/lib/theme';

export default function RootLayout() {
  const isDark = useIsDark();
  const colors = useThemeColors();

  // Navigation chrome (headers, tab bar) does not read NativeWind tokens;
  // it takes a React Navigation theme. Feed it the same palette so the
  // header does not stay white when the rest of the app goes dark.
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.card,
      text: colors.foreground,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style="auto" />
        <DatabaseProvider>
          {/*
           * Only the tab group hides the stack header — the tabs draw their
           * own. Every other route (settings, history detail, the active
           * session with its "Zakończ" action) needs the header for its
           * title, back arrow and header buttons. A blanket
           * `headerShown: false` here would silently hide all of that.
           */}
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </DatabaseProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
