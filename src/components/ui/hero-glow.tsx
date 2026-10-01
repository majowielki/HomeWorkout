import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

/**
 * Soft accent light bleeding in from one corner of an inverse card. Drop it
 * in as the first child of `<Card variant="inverse">` — the card clips it
 * (`overflow-hidden`), and it ignores touches.
 *
 * The accent is the same lime in both themes (it only lands on the ink
 * surface), so a literal rgba is fine here; it matches --primary.
 */
export function HeroGlow() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(185, 245, 20, 0.28)', 'rgba(185, 245, 20, 0.06)', 'rgba(185, 245, 20, 0)']}
      locations={[0, 0.45, 1]}
      start={{ x: 1, y: 0 }}
      end={{ x: 0.1, y: 0.9 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
