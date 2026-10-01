import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The shared contract, prompts and guards sit under ../src, beneath the
  // app's tsconfig.json, which extends expo/tsconfig.base. A Worker-only
  // checkout (CI) has no such package, and Vite would fail looking it up.
  // Passing the options as a string tells esbuild not to search for a file.
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: { target: 'es2024', module: 'es2022', moduleResolution: 'bundler' },
    }),
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { APP_SECRET: 'test-secret' } },
    }),
  ],
});
