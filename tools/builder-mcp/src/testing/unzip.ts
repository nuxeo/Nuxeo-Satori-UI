/**
 * Whether this machine has `unzip`, which the package pipeline reads its zip back with at step 5
 * (docs/business-apps/package-pipeline.md, section 2). The tests that run the pipeline need it; on
 * a machine without it, such as a Windows runner, they are skipped, and vitest lists them as
 * skipped. CI's Linux run, where the pipeline itself runs, has it.
 */
import { spawnSync } from 'node:child_process';

export const HAS_UNZIP = spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;
