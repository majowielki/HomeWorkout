import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback } from 'react';

/**
 * The app is portrait-only (app.json, AndroidManifest); a screen built for
 * both orientations calls this to follow the phone's own rotation setting
 * while it is in front, and puts portrait back when it leaves.
 */
export function useLandscapeAllowed() {
  useFocusEffect(
    useCallback(() => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
      return () => {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
          () => {},
        );
      };
    }, []),
  );
}
