import { useColorScheme } from 'react-native';

/**
 * The semantic palette from global.css, mirrored as plain strings.
 *
 * NativeWind resolves `bg-background` & co. from the CSS variables, so this
 * is only for the handful of props that need a real colour value and never
 * pass through the stylesheet: navigation theme, bottom-sheet background,
 * `placeholderTextColor`. Keep the two in sync — the CSS file is the source
 * of truth and this is the copy.
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  secondary: string;
  secondaryForeground: string;
  mutedForeground: string;
  border: string;
  destructive: string;
}

const light: ThemeColors = {
  background: 'hsl(0 0% 100%)',
  foreground: 'hsl(240 10% 4%)',
  card: 'hsl(0 0% 100%)',
  primary: 'hsl(240 6% 10%)',
  secondary: 'hsl(240 5% 96%)',
  secondaryForeground: 'hsl(240 6% 10%)',
  mutedForeground: 'hsl(240 4% 46%)',
  border: 'hsl(240 6% 90%)',
  destructive: 'hsl(0 72% 51%)',
};

const dark: ThemeColors = {
  background: 'hsl(240 10% 4%)',
  foreground: 'hsl(0 0% 98%)',
  card: 'hsl(240 6% 10%)',
  primary: 'hsl(0 0% 98%)',
  secondary: 'hsl(240 4% 16%)',
  secondaryForeground: 'hsl(0 0% 98%)',
  mutedForeground: 'hsl(240 5% 65%)',
  border: 'hsl(240 4% 16%)',
  destructive: 'hsl(0 63% 31%)',
};

export function useThemeColors(): ThemeColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
