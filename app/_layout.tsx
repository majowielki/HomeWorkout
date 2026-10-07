import '../global.css';
import '@/lib/interop';

import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatabaseProvider } from '@/db/provider';
import { fonts, useIsDark, useThemeColors } from '@/lib/theme';

export default function RootLayout() {
  const isDark = useIsDark();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // Bundled with the app, so this resolves in a frame or two; a font that
  // fails to load must not brick the app, hence `|| fontError`.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Navigation chrome (headers, tab bar) does not read NativeWind tokens;
  // it takes a React Navigation theme. Feed it the same palette so the
  // header does not stay white when the rest of the app goes dark.
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,
      text: colors.foreground,
      border: colors.border,
      primary: colors.highlight,
    },
  };

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

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
          {/*
           * The app draws edge to edge, so the phone's own navigation (the
           * gesture pill or the back/home/recent buttons) sits over the
           * bottom of every screen. Stack screens end above it; the tab
           * group pads its own tab bar instead.
           */}
          <Stack
            screenOptions={({ route }) => ({
              headerBackButtonDisplayMode: 'minimal',
              headerShadowVisible: false,
              headerTitleStyle: { fontFamily: fonts.displaySemibold, fontSize: 19 },
              contentStyle: {
                backgroundColor: colors.background,
                paddingBottom: route.name === '(tabs)' ? 0 : insets.bottom,
              },
            })}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </DatabaseProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
