import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/studio-migration',
  // Resolves `@agentic-ui/shared/app-definition`, the one library this tool imports: the converter
  // writes app definition files and harness check 10 validates them with it.
  plugins: [nxViteTsPaths()],
  test: {
    name: 'studio-migration',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Many tests run the tool whole over a package, and check 9's spec runs Vitest on plugins beside
    // them: on CI, a single migrate run that takes half a second here took 5.5 seconds and failed on
    // Vitest's default of 5. A test that hangs still fails, after 30.
    testTimeout: 30_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/studio-migration',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
}));
