/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/extensions/acme-claim-escalate',
  plugins: [angular(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'acme-claim-escalate',
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    // Matches the platform libraries: the default Vitest pool hangs under Node 20
    // in Nx/CI once the first spec file completes.
    pool: 'threads',
    // zone.js keeps the event loop alive after TestBed teardown.
    forceExit: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/extensions/acme-claim-escalate',
      provider: 'v8' as const,
      // `lcov` is required for SonarCloud and is NOT in the Vitest v8 defaults; the other four
      // are those defaults, kept because `scripts/beta-harness/coverage-gate.mjs` reads
      // `coverage-final.json`, which only the `json` reporter writes.
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
