import { configure } from '@testing-library/react-native';

// Components read insets via useSafeAreaInsets without a <SafeAreaProvider>
// in tests; the library's own mock supplies zeroed insets so that works.
// The mock module is `export default {...}` — unwrap it, since consumers
// import these as named exports (`{ useSafeAreaInsets }`), not `.default`.
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so this must be a require
  const mock: { default?: unknown } = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});

// The YMove clips are licensed and gitignored: a fresh clone and CI have none,
// a dev machine has them. Tests must not depend on which, so they see an empty
// catalogue unless a suite supplies its own with jest.mock.
jest.mock('@/assets/ymove-media', () => ({ ymoveMedia: {} }));

// expo-video is a native view; the suites only care what the app asks of the player.
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((_source: unknown, setup?: (player: unknown) => void) => {
    const player = { loop: false, muted: false, play: jest.fn(), pause: jest.fn() };
    setup?.(player);
    return player;
  }),
  VideoView: 'VideoView',
}));

// The first render in a suite pays for transforming every imported module;
// on a cold cache (CI) that alone can exceed RNTL's 1 s default and make
// `findBy*` fail spuriously. 5 s is generous but only ever waited when
// something is actually wrong.
configure({ asyncUtilTimeout: 5000 });

// Speech recognition is a native module. The mock records what the app asks
// of it and lets a suite play the recogniser's events with `__emit`.
jest.mock('expo-speech-recognition', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
  const { useEffect, useRef } = require('react') as typeof import('react');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const ExpoSpeechRecognitionModule = {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => false),
    getSupportedLocales: jest.fn(async () => ({ locales: [], installedLocales: [] })),
    androidTriggerOfflineModelDownload: jest.fn(async () => ({
      status: 'opened_dialog',
      message: '',
    })),
    __emit(name: string, event: unknown = null) {
      listeners.get(name)?.forEach((listener) => listener(event));
    },
  };
  function useSpeechRecognitionEvent(name: string, listener: (event: unknown) => void) {
    const latest = useRef(listener);
    latest.current = listener;
    useEffect(() => {
      const callback = (event: unknown) => latest.current(event);
      const set = listeners.get(name) ?? new Set();
      set.add(callback);
      listeners.set(name, set);
      return () => {
        set.delete(callback);
      };
    }, [name]);
  }
  return { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent };
});
