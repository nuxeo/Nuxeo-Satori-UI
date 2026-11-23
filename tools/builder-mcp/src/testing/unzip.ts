/**
 * Whether the tests that run the package pipeline run here. The pipeline reads its zip back with
 * `unzip` at step 5 (docs/business-apps/package-pipeline.md, section 2). A Windows runner has
 * none, so there they are skipped, and vitest lists them as skipped. Anywhere else they run, and
 * a machine with no `unzip` fails them, as it would fail the pipeline: a CI image that lost it
 * must not turn them into skips.
 */
import { spawnSync } from 'node:child_process';

export const PIPELINE_TESTS_RUN =
  process.platform !== 'win32' || spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
