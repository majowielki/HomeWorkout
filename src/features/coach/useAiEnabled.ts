import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getAiEnabled, setAiEnabled } from '@/lib/aiSettings';

/**
 * The AI switch, read again every time the screen comes into focus: it is
 * flipped in Settings and used on another screen.
 */
export function useAiEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(getAiEnabled);

  useFocusEffect(
    useCallback(() => {
      setEnabled(getAiEnabled());
    }, []),
  );

  const update = useCallback((next: boolean) => {
    setAiEnabled(next);
    setEnabled(next);
  }, []);

  return [enabled, update];
}
