const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'dist/**',
      'src/db/migrations/**',
    ],
  },
  {
    /*
     * Repositories are the only place with SQL. Screens and hooks that need
     * a live query take a builder from a repository instead of reaching for
     * the client and the schema themselves. See IMPLEMENTACJA.md §4.
     *
     * Declared before the domain block on purpose: flat config lets a later
     * object replace an earlier one's setting for the same rule, and the
     * domain block below must keep its own, wider list.
     */
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/client', '@/db/schema', '@/db/migrations/*'],
              message: 'Only src/db may touch the client or the schema. Add a repository function.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * The domain layer holds every rule that decides what load to put on a
     * body with a reconstructed ACL and no collateral ligaments. It must stay
     * pure TypeScript so it can be unit tested exhaustively without a
     * renderer, a device or a database. This rule is what keeps it that way.
     * See Documents/SPEC-silnik-regul.md §1.1.
     */
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-native',
                'react-native/*',
                'expo',
                'expo-*',
                'expo/*',
                'drizzle-orm',
                'drizzle-orm/*',
                '@/db',
                '@/db/*',
                '@/features/*',
                '@/components/*',
                '@/stores/*',
                '@/strings/*',
                '@data/*',
              ],
              message:
                'src/domain must stay framework-free. Pass data in as arguments instead of importing it.',
            },
          ],
        },
      ],
    },
  },
]);
