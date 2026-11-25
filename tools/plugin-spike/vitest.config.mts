import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/plugin-spike',
  test: {
    name: 'plugin-spike',
    watch: false,
    globals: true,
    // Node, not jsdom: the loader needs only WebCrypto, which Node 24 has, and jsdom would neither
    // check a script's integrity nor run a module script, so a browser-shaped environment would
    // look like evidence about the browser without being any.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/plugin-spike',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.mjs', 'dev/**/*.mjs'],
    },
  },
}));
