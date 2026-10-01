/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 20_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@data/(.*)$': '<rootDir>/data/$1',
    // lucide's "react-native" export condition resolves to an .mjs bundle that
    // jest-expo's transform does not cover; its CJS build is equivalent.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/__tests__/**'],
  // The rules engine decides real training loads; it is the one place
  // where full coverage is a requirement rather than a vanity metric.
  // Component tests (src/features/**/__tests__) run in the same suite but
  // are deliberately not held to a coverage bar.
  coverageThreshold: {
    'src/domain/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
