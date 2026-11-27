/**
 * Phase 10's performance budgets in CI (docs/business-apps/development-plan.md, "performance
 * budgets in CI"): the limits, in `budgets.json`, and the judgement of a measurement against them,
 * which `pages.mjs` and `bundles.mjs` fail on. The reasoning for each limit is in
 * `docs/business-apps/performance-budgets-ci.md`, whose tables, marked `<!-- table: pages -->` and
 * `<!-- table: bundles -->`, `performance-budgets.selftest.mjs` holds to this file.
 *
 * Pure: no browser, no build. A measure that is missing, or not a finite number, fails its line
 * rather than passing it, so a page that never drew cannot read as within budget. A failure names
 * the measure, the number and the budget, in that order, on one line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUDGETS_FILE = join(import.meta.dirname, 'budgets.json');

/** The browser's measures, each the median of the cold loads, from navigation. */
export const PAGE_MEASURES = Object.freeze([
  {
    id: 'home.firstRenderMs',
    label: "the home page's cards drawn with their figures",
    unit: 'ms',
  },
  {
    id: 'queue.firstPageMs',
    label: "a queue's first page of results drawn",
    unit: 'ms',
  },
  {
    id: 'record.firstRenderMs',
    label: "a record page's first render: its title and first card drawn",
    unit: 'ms',
  },
]);

/**
 * What a lazy chunk is called in the budget, from the source file esbuild made it for: a feature
 * library by its name, with the file for a second entry in it; the app's own by its path below
 * `apps/nuxeo-ui/src/app`; anything else by its path. `.component` and `.ts` are dropped.
 */
export function lazyChunkId(entryPoint) {
  const feature = /^libs\/features\/([^/]+)\/src\/(.+)\.ts$/.exec(entryPoint);
  if (feature) {
    const rest = feature[2];
    if (rest === 'index') return `feature:${feature[1]}`;
    const file = rest
      .split('/')
      .at(-1)
      .replace(/\.component$/, '');
    return `feature:${feature[1]}/${file}`;
  }
  const app = /^apps\/nuxeo-ui\/src\/app\/(.+)\.ts$/.exec(entryPoint);
  if (app) return `app:${app[1].replace(/\.component$/, '')}`;
  return `other:${entryPoint}`;
}

const positive = (value) => typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * The budgets file, read and checked: every page measure has a positive whole limit and nothing
 * else does; the initial bundle has one; each lazy chunk's id is one `lazyChunkId` can make, with a
 * positive whole limit in bytes.
 */
export function readBudgets(path = BUDGETS_FILE) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return checkBudgets(raw, path);
}

export function checkBudgets(raw, path = 'budgets') {
  const pages = raw?.pages;
  const bundles = raw?.bundles;
  if (pages === null || typeof pages !== 'object' || Array.isArray(pages)) {
    throw new Error(`${path}: "pages" is not an object`);
  }
  if (bundles === null || typeof bundles !== 'object' || Array.isArray(bundles)) {
    throw new Error(`${path}: "bundles" is not an object`);
  }
  const known = new Set(PAGE_MEASURES.map((measure) => measure.id));
  for (const id of Object.keys(pages)) {
    if (!known.has(id)) throw new Error(`${path}: "${id}" is not a page measure the check takes`);
  }
  for (const { id } of PAGE_MEASURES) {
    if (!positive(pages[id])) throw new Error(`${path}: "${id}" has no positive whole limit`);
  }
  if (!positive(bundles.initialBytes)) {
    throw new Error(`${path}: "bundles.initialBytes" has no positive whole limit`);
  }
  const lazy = bundles.lazyBytes;
  if (lazy === null || typeof lazy !== 'object' || Array.isArray(lazy)) {
    throw new Error(`${path}: "bundles.lazyBytes" is not an object`);
  }
  for (const [id, limit] of Object.entries(lazy)) {
    if (!/^(feature|app|other):\S+$/.test(id)) {
      throw new Error(`${path}: "${id}" is not a lazy chunk's id`);
    }
    if (!positive(limit)) throw new Error(`${path}: "${id}" has no positive whole limit`);
  }
  return raw;
}

/** The middle value, the lower of the two middle ones for an even count; `NaN` for none or any not a number. */
export function median(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

const within = (value, limit) =>
  typeof value === 'number' && Number.isFinite(value) && value <= limit;

/** One line of a judgement: its measure, the number, the budget, and whether it is within. */
const line = (id, label, unit, value, limit) => ({
  id,
  label,
  unit,
  value: typeof value === 'number' && Number.isFinite(value) ? value : null,
  limit,
  pass: within(value, limit),
});

/**
 * The browser's measures against the budget: one line per page measure.
 *
 * @param {Record<string, number>} measured by measure id
 */
export function judgePages(measured, budgets) {
  const lines = PAGE_MEASURES.map(({ id, label, unit }) =>
    line(id, label, unit, measured[id], budgets.pages[id]),
  );
  return { lines, pass: lines.every((each) => each.pass) };
}

/**
 * The bundles against the budget: the initial bundle, then each lazy chunk the build made. A lazy
 * chunk with no budget fails, so a new feature cannot ship without one; a budget for a chunk the
 * build no longer makes fails too, so the table cannot keep a line that holds nothing.
 *
 * @param {{ initialBytes: number, lazy: Record<string, number> }} measured
 */
export function judgeBundles(measured, budgets) {
  const lines = [
    line(
      'initialBytes',
      'the initial bundle: main, its static imports and the global styles',
      'bytes',
      measured.initialBytes,
      budgets.bundles.initialBytes,
    ),
  ];
  const limits = budgets.bundles.lazyBytes;
  for (const [id, bytes] of Object.entries(measured.lazy).sort(([a], [b]) => a.localeCompare(b))) {
    const limit = limits[id];
    if (limit === undefined) {
      lines.push({
        id,
        label: 'a lazy chunk with no budget',
        unit: 'bytes',
        value: bytes,
        limit: null,
        pass: false,
        unbudgeted: true,
      });
    } else {
      lines.push(line(id, 'a lazy chunk, beyond the initial bundle', 'bytes', bytes, limit));
    }
  }
  for (const id of Object.keys(limits)) {
    if (!Object.hasOwn(measured.lazy, id)) {
      lines.push({
        id,
        label: 'a budget for a lazy chunk the build no longer makes',
        unit: 'bytes',
        value: null,
        limit: limits[id],
        pass: false,
        stale: true,
      });
    }
  }
  return { lines, pass: lines.every((each) => each.pass) };
}

/**
 * The budgets with one line's limit replaced: the guard's own control, a budget lowered on purpose
 * below what was measured, which the judgement must then fail with both numbers.
 */
export function lowered(budgets, id, limit) {
  const copy = structuredClone(budgets);
  if (Object.hasOwn(copy.pages, id)) copy.pages[id] = limit;
  else if (id === 'initialBytes') copy.bundles.initialBytes = limit;
  else if (Object.hasOwn(copy.bundles.lazyBytes, id)) copy.bundles.lazyBytes[id] = limit;
  else throw new Error(`no budget "${id}" to lower`);
  return copy;
}

/**
 * A number as a failure says it: rounded up, so that a measure just over its budget never reads as
 * the budget itself, "is 2,501 ms, budget 2,500 ms" for 2500.4 ms.
 */
const show = (value, unit) =>
  value === null ? 'not measured' : `${Math.ceil(value).toLocaleString('en')} ${unit}`;

/** The judgement's failures, one line each: the measure, the number and the budget. */
export function failures(judged) {
  return judged.lines
    .filter((each) => !each.pass)
    .map((each) => {
      if (each.unbudgeted) {
        return `over budget: ${each.id} is ${show(each.value, each.unit)} and has no budget; add one to budgets.json, with its reasoning`;
      }
      if (each.stale) {
        return `over budget: ${each.id} has a budget of ${show(each.limit, each.unit)}, but the build makes no such chunk; remove it`;
      }
      return `over budget: ${each.id} is ${show(each.value, each.unit)}, budget ${show(each.limit, each.unit)} (${each.label})`;
    });
}

/** The judgement as a Markdown table, for the report and the job's summary. */
export function table(judged) {
  const rows = ['| Measure | Value | Budget | |', '| --- | ---: | ---: | --- |'];
  for (const each of judged.lines) {
    const verdict = each.pass ? 'within' : '**over**';
    rows.push(
      `| \`${each.id}\` | ${show(each.value, each.unit)} | ${each.limit === null ? 'none' : show(each.limit, each.unit)} | ${verdict} |`,
    );
  }
  return rows.join('\n');
}
