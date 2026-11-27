/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/nuxeo-embedded-panels',
  plugins: [angular({ tsconfig: 'tsconfig.spec.json' }), nxViteTsPaths()],
  test: {
    name: 'nuxeo-embedded-panels',
    watch: false,
    testTimeout: 30_000,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/nuxeo-embedded-panels',
      provider: 'v8' as const,
    },
  },
}));
