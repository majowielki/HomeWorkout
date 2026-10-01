import { useColorScheme } from 'react-native';

/**
 * The semantic palette from global.css, mirrored as plain strings.
 *
 * NativeWind resolves `bg-background` & co. from the CSS variables, so this
 * is only for the handful of props that need a real colour value and never
 * pass through the stylesheet: navigation theme, tab bar, bottom-sheet
 * background, SVG strokes, chart colours, gradients. Keep the two in sync —
 * the CSS file is the source of truth and this is the copy.
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  mutedForeground: string;
  highlight: string;
  inverse: string;
  border: string;
  destructive: string;
}

const light: ThemeColors = {
  background: 'hsl(60 9% 97%)',
  foreground: 'hsl(240 14% 7%)',
  card: 'hsl(0 0% 100%)',
  primary: 'hsl(76 92% 52%)',
  primaryForeground: 'hsl(240 14% 7%)',
  secondary: 'hsl(60 6% 92%)',
  secondaryForeground: 'hsl(240 14% 7%)',
  mutedForeground: 'hsl(240 4% 42%)',
  highlight: 'hsl(82 85% 30%)',
  inverse: 'hsl(240 12% 9%)',
  border: 'hsl(60 5% 88%)',
  destructive: 'hsl(4 80% 54%)',
};

const dark: ThemeColors = {
  background: 'hsl(240 7% 5%)',
  foreground: 'hsl(60 9% 96%)',
  card: 'hsl(240 6% 9%)',
  primary: 'hsl(76 95% 58%)',
  primaryForeground: 'hsl(240 10% 5%)',
  secondary: 'hsl(240 5% 14%)',
  secondaryForeground: 'hsl(60 9% 96%)',
  mutedForeground: 'hsl(240 5% 62%)',
  highlight: 'hsl(76 95% 58%)',
  inverse: 'hsl(240 6% 12%)',
  border: 'hsl(240 5% 15%)',
  destructive: 'hsl(0 72% 58%)',
};

/**
 * Font family names as registered by `useFonts` in app/_layout.tsx — for
 * the props that take a style object instead of a class (navigation
 * header and tab bar labels).
 */
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displaySemibold: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',
} as const;

export function useThemeColors(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
