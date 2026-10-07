import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef } from 'react';
import { Alert } from 'react-native';

import { pl } from '@/strings/pl';

/**
 * Asks before leaving a form with unsaved changes: stay, discard, or save.
 * `onSave` resolves true when it saved and may leave; the screen's own
 * "back after saving" then passes through via `allowLeave()`.
 */
export function useLeaveGuard(dirty: boolean, onSave: () => Promise<boolean>) {
  const navigation = useNavigation();
  const allowed = useRef(false);

  usePreventRemove(dirty, ({ data }) => {
    if (allowed.current) {
      navigation.dispatch(data.action);
      return;
    }
    const t = pl.common.unsaved;
    Alert.alert(t.title, t.body, [
      { text: t.stay, style: 'cancel' },
      {
        text: t.discard,
        style: 'destructive',
        onPress: () => {
          allowed.current = true;
          navigation.dispatch(data.action);
        },
      },
      {
        text: t.save,
        onPress: () => {
          void onSave().then((ok) => {
            if (!ok) return;
            allowed.current = true;
            navigation.dispatch(data.action);
          });
        },
      },
    ]);
  });

  return {
    /** Call right before a navigation the screen itself starts after saving. */
    allowLeave: () => {
      allowed.current = true;
    },
  };
}
