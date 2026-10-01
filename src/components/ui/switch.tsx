import { Switch as RNSwitch } from 'react-native';

import { useThemeColors } from '@/lib/theme';

type Props = Omit<React.ComponentProps<typeof RNSwitch>, 'trackColor' | 'thumbColor'>;

/**
 * Themed toggle. Android otherwise paints the thumb in the system accent
 * (teal on stock emulators), which clashes with the lime track.
 */
export function Switch({ value, ...props }: Props) {
  const colors = useThemeColors();
  return (
    <RNSwitch
      value={value}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={value ? colors.primaryForeground : colors.mutedForeground}
      {...props}
    />
  );
}
