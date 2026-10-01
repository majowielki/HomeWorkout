/**
 * The physical colour of each band, for the small swatch next to its name.
 * These are product colours, not theme tokens — a red band is red in
 * dark mode too — so literal values are correct here.
 */
const SWATCH: Record<string, string> = {
  yellow: '#facc15',
  red: '#ef4444',
  black: '#27272a',
  purple: '#a855f7',
  green: '#22c55e',
};

export function bandSwatch(bandId: string): string | undefined {
  return SWATCH[bandId];
}
