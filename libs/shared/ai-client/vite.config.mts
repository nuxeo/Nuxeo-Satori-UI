/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/ai-client',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'ai-client',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Added with the service specs: they use the TestBed, which needs an initialised environment.
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    // Matches the other libraries: the Vitest default pool has crashed under Nx/CI here.
    pool: 'threads',
    // zone.js keeps the event loop alive after TestBed teardown. Needed from the moment this
    // library gained TestBed specs, as in `libs/shared/extensions/vite.config.mts`; without it the
    // worker can hang instead of exiting once the specs finish.
    forceExit: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/ai-client',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
