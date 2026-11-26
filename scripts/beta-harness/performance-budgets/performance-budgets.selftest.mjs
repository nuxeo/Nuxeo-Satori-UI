/**
 * The performance budgets' own selftest, offline: no browser and no build. It holds the
 * judgement to failing when it should, with the number and the budget in what it says; the
 * bundles' reading of esbuild's metafile; the guard's controls; the budgets to the page that
 * reasons them; and the CI job to running all of it on a pull request into `staging/**`.
 *
 *   npm run beta:budgets-selftest
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  PAGE_MEASURES,
  checkBudgets,
  failures,
  judgeBundles,
  judgePages,
  lazyChunkId,
  lowered,
  median,
  readBudgets,
} from './budgets.mjs';
import { measureBundles, parseLowered, staticClosure } from './bundles.mjs';
import { lineControls } from './controls.mjs';
import { HOME } from './pages.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const PAGE = join(ROOT, 'docs/business-apps/performance-budgets-ci.md');
const CI = join(ROOT, '.github/workflows/ci.yml');

const budgets = () => ({
  pages: { 'home.firstRenderMs': 2500, 'queue.firstPageMs': 2500, 'record.firstRenderMs': 3000 },
  bundles: {
    initialBytes: 3_400_000,
    lazyBytes: { 'feature:browse': 240_000, 'app:dashboard/dashboard-page': 40_000 },
  },
});

describe('the judgement', () => {
  it('passes a measure within its budget and fails one over it, naming both numbers', () => {
    const judged = judgePages(
      { 'home.firstRenderMs': 1517, 'queue.firstPageMs': 2600, 'record.firstRenderMs': 3000 },
      budgets(),
    );
    assert.deepEqual(
      judged.lines.map((line) => `${line.id} ${line.pass}`),
      ['home.firstRenderMs true', 'queue.firstPageMs false', 'record.firstRenderMs true'],
    );
    assert.equal(judged.pass, false);
    assert.deepEqual(failures(judged), [
      "over budget: queue.firstPageMs is 2,600 ms, budget 2,500 ms (a queue's first page of results drawn)",
    ]);
  });

  it('fails a page that did not draw rather than passing it', () => {
    const judged = judgePages(
      { 'home.firstRenderMs': 1000, 'queue.firstPageMs': Number.NaN },
      budgets(),
    );
    assert.equal(judged.pass, false);
    assert.match(
      failures(judged).join('\n'),
      /queue\.firstPageMs is not measured, budget 2,500 ms/,
    );
    assert.match(failures(judged).join('\n'), /record\.firstRenderMs is not measured/);
  });

  it('takes the median of the runs, so one slow run does not fail the check and most of them do', () => {
    assert.equal(median([1500, 1510, 9000, 1490, 1520]), 1510);
    assert.equal(median([1500, 9000, 9100, 1490, 9200]), 9000);
    assert.equal(median([3, 1]), 1);
    assert.ok(Number.isNaN(median([])));
    assert.ok(
      Number.isNaN(median([1500, Number.NaN, 1600])),
      'a run that did not draw is not dropped',
    );
  });

  it('fails a lazy chunk with no budget, and a budget for a chunk the build no longer makes', () => {
    const judged = judgeBundles(
      {
        initialBytes: 3_100_000,
        lazy: { 'feature:browse': 186_269, 'feature:letters': 30_000 },
      },
      budgets(),
    );
    assert.equal(judged.pass, false);
    const said = failures(judged);
    assert.ok(
      said.some((line) => /feature:letters is 30,000 bytes and has no budget/.test(line)),
      said.join('\n'),
    );
    assert.ok(
      said.some((line) =>
        /app:dashboard\/dashboard-page has a budget of 40,000 bytes, but the build makes no such chunk/.test(
          line,
        ),
      ),
      said.join('\n'),
    );
    assert.equal(judged.lines.find((line) => line.id === 'feature:browse').pass, true);
    assert.equal(judged.lines.find((line) => line.id === 'initialBytes').pass, true);
  });

  it('fails the initial bundle over its budget with both numbers', () => {
    const judged = judgeBundles(
      { initialBytes: 3_500_001, lazy: { 'feature:browse': 1, 'app:dashboard/dashboard-page': 1 } },
      budgets(),
    );
    assert.deepEqual(failures(judged), [
      'over budget: initialBytes is 3,500,001 bytes, budget 3,400,000 bytes (the initial bundle: main, its static imports and the global styles)',
    ]);
  });
});

describe('the budgets file', () => {
  it('is well formed, a positive whole limit for every page measure and the initial bundle', () => {
    const read = readBudgets();
    for (const { id } of PAGE_MEASURES) assert.ok(read.pages[id] > 0, id);
    assert.ok(read.bundles.initialBytes > 0);
    assert.ok(Object.keys(read.bundles.lazyBytes).length > 0, 'it budgets the lazy chunks');
  });

  it('refuses a limit that is not one, and a measure the check does not take', () => {
    assert.throws(
      () => checkBudgets({ ...budgets(), pages: { ...budgets().pages, 'home.firstRenderMs': 0 } }),
      /no positive whole limit/,
    );
    assert.throws(
      () => checkBudgets({ ...budgets(), pages: { ...budgets().pages, 'search.ms': 1 } }),
      /not a page measure/,
    );
    assert.throws(
      () => checkBudgets({ ...budgets(), bundles: { initialBytes: 1, lazyBytes: { browse: 1 } } }),
      /not a lazy chunk's id/,
    );
    assert.throws(() => checkBudgets({ pages: {}, bundles: null }), /"bundles" is not an object/);
  });

  it('matches the page that reasons each limit, line for line', () => {
    const read = readBudgets();
    const markdown = readFileSync(PAGE, 'utf8');
    assert.deepEqual(
      tableRows(markdown, 'pages'),
      PAGE_MEASURES.map(({ id }) => [id, String(read.pages[id])]),
    );
    const bundles = tableRows(markdown, 'bundles');
    assert.deepEqual(bundles, [
      ['initialBytes', String(read.bundles.initialBytes)],
      ...Object.entries(read.bundles.lazyBytes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, limit]) => [id, String(limit)]),
    ]);
  });
});

/** The first two cells of each row of the page's table marked `<!-- table: name -->`, numbers bare. */
function tableRows(markdown, name) {
  const start = markdown.indexOf(`<!-- table: ${name} -->`);
  assert.ok(start >= 0, `the page has no table marked "${name}"`);
  const rows = [];
  for (const line of markdown.slice(start).split('\n').slice(1)) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (/^-+:?$/.test(cells[0]) || cells[0] === 'Measure' || cells[0] === 'Chunk') continue;
    rows.push([cells[0].replace(/`/g, ''), cells[1].replace(/[ ,]|ms$|bytes$/g, '')]);
  }
  return rows;
}

describe('reading the build', () => {
  /** A metafile as esbuild writes one: main, two shared chunks, a feature and an app route. */
  const outputs = {
    'main-A.js': {
      entryPoint: 'apps/nuxeo-ui/src/main.ts',
      imports: [
        { path: 'chunk-core.js', kind: 'import-statement' },
        { path: 'chunk-browse.js', kind: 'dynamic-import' },
        { path: 'chunk-dash.js', kind: 'dynamic-import' },
      ],
    },
    'chunk-core.js': { imports: [{ path: 'chunk-core2.js', kind: 'import-statement' }] },
    'chunk-core2.js': { imports: [] },
    'chunk-browse.js': {
      entryPoint: 'libs/features/browse/src/index.ts',
      imports: [
        { path: 'chunk-core.js', kind: 'import-statement' },
        { path: 'chunk-tree.js', kind: 'import-statement' },
      ],
    },
    'chunk-tree.js': { imports: [{ path: 'chunk-core2.js', kind: 'import-statement' }] },
    'chunk-dash.js': {
      entryPoint: 'apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.ts',
      imports: [],
    },
    'chunk-drawer.js': {
      entryPoint: 'libs/features/assets/src/lib/assets-drawer/assets-drawer.component.ts',
      imports: [{ path: 'chunk-tree.js', kind: 'import-statement' }],
    },
    'styles-B.css': { entryPoint: 'angular:styles/global:styles', imports: [] },
  };
  const sizes = {
    'main-A.js': 1000,
    'chunk-core.js': 300,
    'chunk-core2.js': 200,
    'chunk-browse.js': 50,
    'chunk-tree.js': 7,
    'chunk-dash.js': 11,
    'chunk-drawer.js': 13,
    'styles-B.css': 400,
  };

  it('counts main, its static imports and the global styles as the initial bundle', () => {
    const measured = measureBundles(outputs, (file) => sizes[file]);
    assert.equal(measured.initialBytes, 1000 + 300 + 200 + 400);
    assert.deepEqual(measured.initialFiles, [
      'chunk-core.js',
      'chunk-core2.js',
      'main-A.js',
      'styles-B.css',
    ]);
  });

  it('counts a lazy chunk with what it imports beyond the initial bundle, and nothing of a dynamic import', () => {
    const measured = measureBundles(outputs, (file) => sizes[file]);
    assert.deepEqual(measured.lazy, {
      'feature:browse': 50 + 7,
      'app:dashboard/dashboard-page': 11,
      'feature:assets/assets-drawer': 13 + 7,
    });
    assert.deepEqual([...staticClosure(outputs, ['main-A.js'])].sort(), [
      'chunk-core.js',
      'chunk-core2.js',
      'main-A.js',
    ]);
  });

  it('names each chunk by the source it was made for', () => {
    assert.equal(lazyChunkId('libs/features/trash/src/index.ts'), 'feature:trash');
    assert.equal(
      lazyChunkId(
        'libs/features/assets/src/lib/asset-search-results/asset-search-results.component.ts',
      ),
      'feature:assets/asset-search-results',
    );
    assert.equal(
      lazyChunkId('apps/nuxeo-ui/src/app/business-apps.menu.ts'),
      'app:business-apps.menu',
    );
    assert.equal(
      lazyChunkId('apps/nuxeo-ui/src/app/settings/themes/themes-page.component.ts'),
      'app:settings/themes/themes-page',
    );
    assert.equal(
      lazyChunkId('node_modules/pdfjs-dist/build/pdf.mjs'),
      'other:node_modules/pdfjs-dist/build/pdf.mjs',
    );
  });

  it('refuses a metafile with no main entry rather than measuring nothing', () => {
    assert.throws(
      () => measureBundles({ 'chunk-x.js': { imports: [] } }, () => 1),
      /no output for apps\/nuxeo-ui\/src\/main.ts/,
    );
  });
});

describe("the guard's own controls", () => {
  it('lowers a budget on purpose and the check fails on it, with the number and the budget', () => {
    const measured = {
      'home.firstRenderMs': 1517.4,
      'queue.firstPageMs': 1707,
      'record.firstRenderMs': 1816,
    };
    const judged = judgePages(measured, budgets());
    assert.equal(judged.pass, true);
    const { lines, shortfalls } = lineControls(judged, budgets(), (b) => judgePages(measured, b));
    assert.equal(lines, 3);
    assert.deepEqual(shortfalls, []);
    assert.deepEqual(
      failures(judgePages(measured, lowered(budgets(), 'queue.firstPageMs', 1706))),
      [
        "over budget: queue.firstPageMs is 1,707 ms, budget 1,706 ms (a queue's first page of results drawn)",
      ],
    );
  });

  it('notices a guard that cannot fail: a judgement that ignores its budget', () => {
    const measured = {
      'home.firstRenderMs': 1517,
      'queue.firstPageMs': 1707,
      'record.firstRenderMs': 1816,
    };
    const judged = judgePages(measured, budgets());
    const blind = () => ({
      ...judged,
      lines: judged.lines.map((line) => ({ ...line, pass: true })),
      pass: true,
    });
    const { shortfalls } = lineControls(judged, budgets(), blind);
    assert.equal(shortfalls.length, 3, shortfalls.join('\n'));
    assert.match(shortfalls[0], /within with its budget lowered to 1516/);
  });

  it('lowers the bundles too, each lazy chunk and the initial bundle', () => {
    const measured = {
      initialBytes: 3_100_000,
      lazy: { 'feature:browse': 186_269, 'app:dashboard/dashboard-page': 26_512 },
    };
    const judged = judgeBundles(measured, budgets());
    assert.equal(judged.pass, true);
    const { lines, shortfalls } = lineControls(judged, budgets(), (b) => judgeBundles(measured, b));
    assert.equal(lines, 3);
    assert.deepEqual(shortfalls, []);
  });

  it('refuses a lowered budget that names nothing', () => {
    assert.throws(() => lowered(budgets(), 'feature:nothing', 1), /no budget "feature:nothing"/);
    assert.deepEqual(parseLowered(['queue.firstPageMs=100']), [
      { id: 'queue.firstPageMs', limit: 100 },
    ]);
    assert.throws(() => parseLowered(['queue.firstPageMs']), /<budget id>=<whole limit>/);
  });
});

describe('the home it measures', () => {
  it('is a valid home of the library, each card over its page provider', () => {
    assert.equal(HOME.version, 2);
    assert.ok(HOME.cards.length >= 1);
    for (const card of HOME.cards) {
      assert.equal(card.kpi.pageProvider, 'acme_asset_library');
      assert.equal(card.queue, 'library');
      assert.ok(card.label);
    }
  });
});

describe('the CI job', () => {
  const workflow = readFileSync(CI, 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  performance-budgets:'));

  it('runs on every pull request into staging/**, in the existing CI workflow', () => {
    assert.match(
      workflow,
      /pull_request:\n\s+branches: \[main, 'integration\/\*\*', 'staging\/\*\*'\]/,
    );
    assert.ok(
      workflow.includes('\n  performance-budgets:'),
      'ci.yml has the performance-budgets job',
    );
  });

  it('builds with the metafile, runs the selftest, both checks and the controls, in that order', () => {
    const order = [
      'nuxeo-ui:build:production --stats-json',
      'npm run beta:budgets-selftest',
      'npm run beta:bundle-budgets',
      'npm run beta:page-budgets',
      'npm run beta:budgets-controls',
    ];
    let at = 0;
    for (const step of order) {
      const found = job.indexOf(step, at);
      assert.ok(found > at, `the job runs ${step}, after the steps before it`);
      at = found;
    }
    assert.match(job, /--run-checks/);
    assert.match(job, /npm install --no-save/);
  });
});
