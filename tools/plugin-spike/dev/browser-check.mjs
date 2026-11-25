#!/usr/bin/env node
// @ts-check
/**
 * The host page in real browsers, for the report's section 4.3: every scenario's outcome, and what
 * the accepted plugin reached in the page and in the sandboxed frame.
 *
 *   node tools/plugin-spike/dev/browser-check.mjs [chromium,webkit,firefox]
 *
 * **Not a gate, and not in CI.** It needs Playwright and its browsers, which this repository
 * installs only with `--no-save` (CLAUDE.md), so it is not in the lockfile; Playwright is resolved
 * from the current directory's `node_modules`. It exits 1 when a scenario or a load-bearing probe
 * gives another answer than the report records, and 2 when it could not run.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { startSpikeServer } from './serve.mjs';

/** Probes whose answer the report rests on: reached in the page, stopped in the frame. */
const LOAD_BEARING = ['session-storage', 'host-client', 'in-flight-authorization', 'host-dom'];

/** @type {any} */
let playwright;
try {
  playwright = createRequire(join(process.cwd(), 'package.json'))('playwright');
} catch {
  process.stderr.write(
    'browser-check: Playwright is not installed here. Install it with --no-save, as the e2e ' +
      'suite does, or run this from a checkout that has it.\n',
  );
  process.exit(2);
}

const browsers = (process.argv[2] ?? 'chromium,webkit').split(',').filter(Boolean);
const server = await startSpikeServer({ port: 0 });
const problems = [];
try {
  for (const name of browsers) {
    const browser = await playwright[name].launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${server.origin}/`);
      await page.waitForFunction(() => document.body.dataset.spikeDone !== undefined, null, {
        timeout: 30000,
      });
      /** @type {any} */
      const results = await page.evaluate(() => /** @type {any} */ (window).spikeResults);
      process.stdout.write(`\n${name} ${browser.version()}\n`);
      if (!results) {
        problems.push(`${name}: the host page did not finish`);
        continue;
      }
      for (const { name: scenario, expected, result } of results.scenarios) {
        const outcome = result.ok ? 'loaded' : result.reason;
        process.stdout.write(`  ${outcome === expected ? 'ok ' : 'BAD'} ${scenario}: ${outcome}\n`);
        if (outcome !== expected)
          problems.push(`${name}: ${scenario} gave ${outcome}, not ${expected}`);
      }
      for (const [where, report, wanted] of [
        ['page', results.inPage, true],
        ['frame', results.framed, false],
      ]) {
        for (const probe of report ?? []) {
          process.stdout.write(`  ${where} ${probe.probe}: ${probe.reached} (${probe.detail})\n`);
          if (LOAD_BEARING.includes(probe.probe) && probe.reached !== wanted) {
            problems.push(
              `${name}: ${probe.probe} in the ${where} was ${probe.reached}, not ${wanted}`,
            );
          }
        }
        if (!report) problems.push(`${name}: no report from the plugin in the ${where}`);
      }
      for (const entry of results.serverLog) {
        process.stdout.write(`  server saw ${JSON.stringify(entry)}\n`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

if (problems.length > 0) {
  process.stderr.write(`\nbrowser-check: ${problems.length} answer(s) differ from the report:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write(
  '\nbrowser-check: every scenario and load-bearing probe as the report records.\n',
);
