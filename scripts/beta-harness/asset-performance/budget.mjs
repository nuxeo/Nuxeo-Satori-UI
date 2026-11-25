/**
 * The asset library's performance budget, and the judgement of a run against it: what
 * `check.mjs` fails on. The numbers are in `budget.json`, the reasoning in
 * `docs/business-apps/performance-budget.md`; `asset-performance.selftest.mjs` holds the page's
 * table to the file, so the two cannot say different things.
 *
 * Pure: no browser, no server. A measure that is missing, or not a finite number, fails its
 * line rather than passing it, so a scenario that never ran cannot read as within budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUDGET_FILE = join(import.meta.dirname, 'budget.json');

/**
 * Each line of the budget: the measure it holds, and how that measure is read from a run. The
 * order is the report's.
 */
export const MEASURES = Object.freeze([
  {
    id: 'library.firstContentfulPaintMs',
    label: "the library's first contentful paint, from navigation (median of the cold loads)",
    unit: 'ms',
  },
  {
    id: 'library.firstPageMs',
    label: "the library's first page of results drawn, from navigation (median of the cold loads)",
    unit: 'ms',
  },
  {
    id: 'library.openRequests',
    label: 'requests to open the library, cold (most of any load)',
    unit: 'requests',
  },
  { id: 'paging.medianMs', label: 'a page of results, from the click (median)', unit: 'ms' },
  { id: 'paging.p95Ms', label: 'a page of results, from the click (95th percentile)', unit: 'ms' },
  {
    id: 'paging.requestsPerPage',
    label: 'requests per page of results (most of any page)',
    unit: 'requests',
  },
  { id: 'facets.maxMs', label: 'a facet chosen or cleared, from the click (slowest)', unit: 'ms' },
  {
    id: 'facets.requestsPerChoice',
    label: 'requests per facet chosen or cleared (most of any)',
    unit: 'requests',
  },
  {
    id: 'asset.firstViewMs',
    label: "the asset page's first picture view loaded, from the click on its row (slowest)",
    unit: 'ms',
  },
  {
    id: 'asset.requests',
    label: 'requests to open the asset page (most of any open)',
    unit: 'requests',
  },
  {
    id: 'heap.after50PagesMB',
    label: 'JavaScript heap after browsing 50 pages, after garbage collection',
    unit: 'MB',
  },
  {
    id: 'heap.growthMB',
    label: 'JavaScript heap growth from page 1 to page 50, after garbage collection',
    unit: 'MB',
  },
]);

/** The budget file, read and checked: every measure has a positive limit, and nothing else does. */
export function readBudget(path = BUDGET_FILE) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const limits = raw?.limits;
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new Error(`${path}: "limits" is not an object`);
  }
  const known = new Set(MEASURES.map((measure) => measure.id));
  for (const id of Object.keys(limits)) {
    if (!known.has(id)) throw new Error(`${path}: "${id}" is not a measure the check takes`);
  }
  for (const { id } of MEASURES) {
    const limit = limits[id];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      throw new Error(`${path}: "${id}" has no positive limit`);
    }
  }
  return { ...raw, limits };
}

/** The value below which `fraction` of `values` fall, by nearest rank; `NaN` for none. */
export function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length !== values.length) return Number.NaN;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

export const median = (values) => percentile(values, 0.5);

/** The largest of `values`; `NaN` for none, or for any that is not a number. */
export function largest(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return Number.NaN;
  return Math.max(...values);
}

/**
 * The run against the budget: one line per measure, each passing only when its value is a
 * finite number within its limit.
 *
 * @param {Record<string, number>} measured by measure id
 * @param {{ limits: Record<string, number> }} budget
 */
export function judge(measured, budget) {
  const lines = MEASURES.map(({ id, label, unit }) => {
    const value = measured[id];
    const limit = budget.limits[id];
    const pass = typeof value === 'number' && Number.isFinite(value) && value <= limit;
    return { id, label, unit, value: value ?? null, limit, pass };
  });
  return { lines, pass: lines.every((line) => line.pass) };
}
