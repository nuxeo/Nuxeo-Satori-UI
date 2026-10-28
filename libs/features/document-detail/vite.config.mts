/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/features/document-detail',
  plugins: [angular(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  // Uncomment this if you are using workers.
  // worker: {
  //   plugins: () => [ nxViteTsPaths() ],
  // },
  test: {
    name: 'document-detail',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    // Pin the worker pool explicitly: the Vitest default pool crashes under
    // Node 20 in Nx/CI for this project before any test output is emitted.
    pool: 'threads',
    // Keep warnings/errors on the worker's native streams: Vitest 4's intercepted
    // console can leave onUserConsoleLog RPCs pending when a Windows worker closes.
    // This preserves console output and does not ignore unhandled test errors.
    disableConsoleIntercept: true,
    // zone.js keeps the Node.js event loop alive after Angular TestBed teardown;
    // forceExit ensures Vitest can always exit cleanly in CI.
    forceExit: true,
    coverage: {
      reportsDirectory: '../../../coverage/libs/features/document-detail',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
    },
  },
}));
