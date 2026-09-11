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
