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

// The first render in a suite pays for transforming every imported module;
// on a cold cache (CI) that alone can exceed RNTL's 1 s default and make
// `findBy*` fail spuriously. 5 s is generous but only ever waited when
// something is actually wrong.
configure({ asyncUtilTimeout: 5000 });
