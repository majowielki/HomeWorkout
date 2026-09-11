/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@data/(.*)$': '<rootDir>/data/$1',
  },
  collectCoverageFrom: ['src/domain/**/*.ts', '!src/domain/**/__tests__/**'],
  // The rules engine decides real training loads; it is the one place
  // where full coverage is a requirement rather than a vanity metric.
  coverageThreshold: {
    'src/domain/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
