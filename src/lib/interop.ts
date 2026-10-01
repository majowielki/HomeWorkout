import { Image } from 'expo-image';
import type { LucideIcon } from 'lucide-react-native';
import { cssInterop, remapProps } from 'nativewind';
import { SectionList } from 'react-native';

/**
 * NativeWind only wires `className` into the core react-native components
 * (View, Text, Pressable, ScrollView, FlatList, ...). Anything else silently
 * ignores it — an `<Image className="h-16 w-16">` from expo-image renders
 * at its intrinsic size, and a `<SectionList contentContainerClassName>`
 * gets no padding. This module registers the third-party components the
 * app styles with classes. Import it once, first thing, in app/_layout.tsx.
 */

cssInterop(Image, { className: 'style' });

remapProps(SectionList, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});

/**
 * Lets a lucide icon take `className="text-foreground"` instead of a
 * hardcoded `color` prop — the only way its colour follows the theme.
 */
export function iconWithClassName(icon: LucideIcon): void {
  cssInterop(icon, {
    className: {
      target: 'style',
      nativeStyleToProp: { color: true, opacity: true },
    },
  });
}
