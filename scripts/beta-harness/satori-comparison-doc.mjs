#!/usr/bin/env node
/**
 * The with-and-without-Satori page has one section per `nxs-` component, and only those.
 *
 * `docs/satori-components/with-and-without-satori.md` is the source of the Confluence page that
 * shows a customer what each component looks like with and without Satori access. A component
 * added to the library barrel without a section there is a component that page silently omits,
 * and a section left behind after a component is removed describes something that no longer
 * ships. Both are easy to miss in review, because the page lives outside the repository.
 *
 * So this reads the barrel, the registrations and the stories, and fails when:
 *   - a component exported from `libs/shared/satori-components/src/index.ts` has no section, or a
 *     section names a component the barrel does not export;
 *   - a Satori variant registered by `provideNxsSatoriComponents()` is not named by a section, or a
 *     section says "Satori's own component" for a component Satori does not re-register;
 *   - a section's registered ID is not the ID something registers *that* component under — every
 *     registration of an exported component is read, `provideNxsComponents()` and the
 *     application's alike, and a component nothing registers must say "—";
 *   - a section's story is not a story *of* that component: either its Storybook meta names the
 *     component, or it renders the component's registered ID through an extension outlet;
 *   - a section says Satori renders an element its wrapper's template does not;
 *   - a section's image file name disagrees with the code;
 *   - the "All components" table and the sections disagree;
 *   - the page text carries a ticket key, a pull-request reference or a branch name.
 *
 * Static, no credentials, no network: it reads files. `satori-comparison-doc.selftest.mjs` holds
 * its negative controls; `scripts/satori-comparison/` holds the capture and publish commands,
 * which read the same sections through `loadComparison`.
 *
 * Usage:  node scripts/beta-harness/satori-comparison-doc.mjs [--json]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyNameFromExport, toId } from 'storybook/internal/csf';

import { parseImageLine } from '../confluence-storage.mjs';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const DOC = 'docs/satori-components/with-and-without-satori.md';
export const BARREL = 'libs/shared/satori-components/src/index.ts';
const BASE_SRC = 'libs/shared/satori-components/src';
const SATORI_SRC = 'libs/shared/satori-components-satori/src';
const BASE_PROVIDER = `${BASE_SRC}/lib/provide-nxs-components.ts`;
const SATORI_PROVIDER = `${SATORI_SRC}/lib/provide-nxs-satori-components.ts`;
const PRIMITIVE_IDS = `${BASE_SRC}/lib/primitives.ts`;
/**
 * The application's own registrations. Read because a library component can be registered by the
 * host rather than by `provideNxsComponents()` — `nxs.components.permissionsPanel` is — and a
 * section claiming an ID has to be checked against every registration there is, not against the
 * IDs the library happens to spell somewhere.
 */
export const APP_PROVIDER = 'apps/nuxeo-ui/src/app/extensions/provide-app-extensions.ts';
const REGISTRARS = [
  [BASE_PROVIDER, 'provideNxsComponents()'],
  [APP_PROVIDER, APP_PROVIDER],
];

/** The section every component lives under, and the table that summarises them. */
export const COMPONENTS_HEADING = 'Side by side';
export const SUMMARY_HEADING = 'All components';
/** Where a generator splices a new section, and a new summary row. */
export const MARKERS = {
  components: '<!-- satori:comparison:components -->',
  summary: '<!-- satori:comparison:summary -->',
};
export const OWN = "Satori's own component";
export const THEME_ONLY = 'Same component; theme only';
/** What the capture does before the screenshot. Absent means "As rendered". */
export const CAPTURE_STATES = ['As rendered', 'Opened from the keyboard'];
const REQUIRED_FIELDS = ['Component', 'Registered ID', 'With Satori', 'Storybook story'];
const OPTIONAL_FIELDS = ['Captured'];

/**
 * The images that are not one component's: the "Primitives/By registered ID" story, whole, in both
 * Storybooks. The capture produces exactly these and one `<name>-side-by-side.png` per section.
 */
export const FULL_IMAGES = {
  without: 'without-satori-full.png',
  with: 'with-satori-full.png',
  sideBySide: 'full-side-by-side.png',
};
export const FULL_STORIES = {
  without: 'primitives-by-registered-id--material-registration',
  with: 'primitives-by-registered-id--satori-registration',
};

/** Ticket keys, pull-request references and branch names. The page is for readers, not history. */
const FORBIDDEN = [
  [/\b(?:NXSAT|NCO|NXENG|WEBUI|ELEMENTS)-\d+/g, 'a ticket key'],
  [/(?:^|[\s(])#\d{1,5}(?![\da-fA-F])/g, 'a pull-request number'],
  [/\bPRs?\b|pull request|\/pull\/\d/gi, 'a pull-request reference'],
  [/\b(?:feature|fix|integration|autopilot|refactor|sync|docs)\/nx[\w.-]*/gi, 'a branch name'],
  [/\b(?:feature|fix|integration|autopilot)\/[\w.-]+/g, 'a branch name'],
];

const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
const isSeparator = (row) => row.every((c) => /^:?-{2,}:?$/.test(c));

/* ------------------------------------------------------------------- the code side ---- */

/**
 * The value exports of the barrel whose names end in `Component`, with the module each comes from.
 * `export *` is refused rather than followed: it would hide components from this check.
 */
export function barrelComponents(source) {
  const problems = [];
  if (/export\s+\*/.test(source)) {
    problems.push(`${BARREL} uses \`export *\`; export components by name so this check sees them`);
  }
  const components = [];
  for (const m of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const spec = raw.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const name = spec
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (/Component$/.test(name)) components.push({ name, from: m[3] });
    }
  }
  return { components, problems };
}

function read(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function walk(root, rel, keep) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(root, child, keep));
    else if (keep(entry.name)) out.push(child);
  }
  return out;
}

const selectorOf = (source) => /selector:\s*['"]([^'"]+)['"]/.exec(source ?? '')?.[1] ?? null;

/** A component's template: its `templateUrl` file, or its inline `template`. */
function templateOf(root, file, source) {
  const url = /templateUrl:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? null;
  if (url) return read(root, join(dirname(file), url)) ?? '';
  return /template:\s*`([\s\S]*?)`/.exec(source)?.[1] ?? '';
}

/**
 * The `nxs.…` IDs the base library names, keyed by the expression a registration writes them with:
 * `NXS_PRIMITIVE_IDS.avatar` for a member of the frozen map, `NXS_PERMISSIONS_PANEL_ID` for an
 * exported constant. A registration file in another project writes the constant, not the string.
 */
function idConstants(root) {
  const byExpression = new Map();
  const primitives = read(root, PRIMITIVE_IDS) ?? '';
  for (const m of primitives.matchAll(/^\s*(\w+):\s*['"](nxs\.[\w.]+)['"]/gm)) {
    byExpression.set(`NXS_PRIMITIVE_IDS.${m[1]}`, m[2]);
  }
  for (const file of walk(root, BASE_SRC, (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))) {
    for (const m of read(root, file).matchAll(/export const (\w+)\s*=\s*['"](nxs\.[\w.]+)['"]/g)) {
      byExpression.set(m[1], m[2]);
    }
  }
  return byExpression;
}

/**
 * The components a registration file registers, as class → ID.
 *
 * Both forms a registration takes: a computed key — `[NXS_PRIMITIVE_IDS.avatar]`, or any other ID
 * constant the base library exports — and a string literal.
 */
function registrations(source, ids) {
  const byClass = new Map();
  if (!source) return byClass;
  for (const m of source.matchAll(/\[([\w.]+)\]\s*:\s*(\w+Component)\b/g)) {
    if (ids.has(m[1])) byClass.set(m[2], ids.get(m[1]));
  }
  for (const m of source.matchAll(/['"](nxs\.[\w.]+)['"]\s*:\s*(\w+Component)\b/g)) {
    byClass.set(m[2], m[1]);
  }
  return byClass;
}

/**
 * The registered IDs a story renders through `lib-extension-outlet`, for the stories that name no
 * component of their own: `[componentId]="ids.avatar"` with `ids: NXS_PRIMITIVE_IDS` among its
 * props, or a literal ID.
 */
function renderedIds(source, ids) {
  const found = new Set();
  const prop = /(\w+):\s*NXS_PRIMITIVE_IDS\b/.exec(source)?.[1] ?? null;
  for (const m of source.matchAll(/\[componentId\]="([^"]*)"/g)) {
    const expression = m[1].trim();
    const literal = /^'(nxs\.[\w.]+)'$/.exec(expression)?.[1] ?? null;
    if (literal) {
      found.add(literal);
      continue;
    }
    const member = prop ? new RegExp(`^${prop}\\.(\\w+)$`).exec(expression)?.[1] : null;
    if (member && ids.has(`NXS_PRIMITIVE_IDS.${member}`)) {
      found.add(ids.get(`NXS_PRIMITIVE_IDS.${member}`));
    }
  }
  return found;
}

/**
 * Every story a library's Storybook serves, by the ID Storybook computes, with what the story is
 * *of*: the component its meta names, and the registered IDs it renders through an outlet. A story
 * ID that merely exists says nothing about which component a section's screenshot will show.
 */
function stories(root, src, ids) {
  const found = new Map();
  for (const file of walk(root, src, (n) => n.endsWith('.stories.ts'))) {
    const source = read(root, file);
    // The meta's title and component, not the first `title:` in the file: fixtures have titles too.
    const start = source.search(/\bconst meta\b|export default\s*\{/);
    if (start === -1) continue;
    const end = source.indexOf('\n};', start);
    const meta = source.slice(start, end === -1 ? undefined : end);
    const title = /\btitle:\s*['"]([^'"]+)['"]/.exec(meta)?.[1] ?? null;
    if (!title) continue;
    const of = {
      component: /\bcomponent:\s*(\w+Component)\b/.exec(meta)?.[1] ?? null,
      renders: renderedIds(source, ids),
      file,
    };
    for (const m of source.matchAll(/^export const (\w+)\s*[:=]/gm)) {
      found.set(toId(title, storyNameFromExport(m[1])), of);
    }
  }
  return found;
}

/**
 * Everything the check compares the page against, read from the repository.
 *
 * @param {string} root
 * @param {{ doc?: string, barrel?: string }} [overrides] replace the page or barrel text, for the
 *   selftest's controls; nothing on disk changes.
 */
export function readInputs(root = ROOT, overrides = {}) {
  const barrel = overrides.barrel ?? read(root, BARREL) ?? '';
  const doc = overrides.doc ?? read(root, DOC);
  const ids = idConstants(root);
  const { components, problems: barrelProblems } = barrelComponents(barrel);
  const selectors = new Map();
  for (const c of components) {
    const file = resolve(root, dirname(BARREL), `${c.from}.ts`);
    selectors.set(c.name, existsSync(file) ? selectorOf(readFileSync(file, 'utf8')) : null);
  }
  const satoriVariants = new Map();
  for (const file of walk(root, `${SATORI_SRC}/lib`, (n) => n.endsWith('.component.ts'))) {
    const source = read(root, file);
    const elements = [
      ...new Set([...templateOf(root, file, source).matchAll(/<(sat-[\w-]+)/g)].map((m) => m[1])),
    ];
    for (const m of source.matchAll(/export class (\w+Component)\b/g)) {
      satoriVariants.set(m[1], { selector: selectorOf(source), elements, file });
    }
  }
  /** Every registration of a component, as class → the ID and the file that registers it. */
  const registeredBy = new Map();
  for (const [file, label] of REGISTRARS) {
    for (const [cls, id] of registrations(read(root, file), ids)) {
      registeredBy.set(cls, [...(registeredBy.get(cls) ?? []), { id, by: label }]);
    }
  }
  return {
    doc,
    components,
    barrelProblems,
    selectors,
    satoriVariants,
    registeredBy,
    satoriRegistrations: registrations(read(root, SATORI_PROVIDER), ids),
    baseStories: stories(root, BASE_SRC, ids),
    satoriStories: stories(root, SATORI_SRC, ids),
  };
}

/* ------------------------------------------------------------------- the page side ---- */

/**
 * The page's `##` headings, its component sections and its summary table.
 *
 * A component section is a `###` under `## Side by side`: a field table, then one image.
 */
export function parseDoc(md) {
  const lines = md.split('\n');
  const h2 = [];
  const sections = [];
  const summaryRows = [];
  let summaryTables = 0;
  let previousWasTable = false;
  const markerLines = { components: [], summary: [] };
  let inComments = false;
  let current = null;
  let h2Title = null;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const [key, marker] of Object.entries(MARKERS)) {
      if (line.trim() === marker) markerLines[key].push({ lineNo, h2: h2Title, after: current });
    }
    if (/^<!--/.test(line.trim())) inComments = !line.includes('-->');
    else if (inComments) {
      if (line.includes('-->')) inComments = false;
      return;
    }
    const isTable = /^\s*\|/.test(line);
    const startsTable = isTable && !previousWasTable;
    previousWasTable = isTable;
    const heading = /^(#{2,3})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (heading[1] === '##') {
        h2Title = heading[2];
        h2.push(h2Title);
        current = null;
      } else if (h2Title === COMPONENTS_HEADING) {
        current = { heading: heading[2], lineNo, fields: new Map(), images: [], tables: 0 };
        sections.push(current);
      } else {
        current = null;
      }
      return;
    }
    if (/^\s*\|/.test(line)) {
      const row = cells(line);
      if (isSeparator(row)) return;
      if (current) {
        if (row[0] === 'Field' && row[1] === 'Value') current.tables += 1;
        else if (current.tables === 1)
          current.fields.set(row[0].replace(/\*\*/g, ''), row[1] ?? '');
      } else if (h2Title === SUMMARY_HEADING) {
        if (startsTable) summaryTables += 1;
        if (summaryTables === 1) summaryRows.push({ lineNo, cells: row });
      }
      return;
    }
    const img = parseImageLine(line);
    if (img && current) current.images.push(img);
  });

  // The summary table's first row is its header.
  return {
    h2,
    sections,
    summaryRows: summaryRows.slice(1),
    summaryHeaderLine: summaryRows[0]?.lineNo ?? null,
    summaryTables,
    markerLines,
  };
}

/** Every image the page references, in order, with the line it is on. */
export function imageReferences(md) {
  return md
    .split('\n')
    .map((line, i) => ({ img: parseImageLine(line), lineNo: i + 1 }))
    .filter(({ img }) => img)
    .map(({ img, lineNo }) => ({ ...img, lineNo }));
}

/** The image a component's section must reference: its selector without `nxs-`. */
export const imageNameFor = (selector) => `${selector.replace(/^nxs-/, '')}-side-by-side.png`;

/**
 * Forbidden references in text a reader sees, i.e. outside HTML comments. Matches are made on the
 * whole text and those inside a comment skipped, rather than deleting comments first: nothing here
 * is rendered, and a scan that edits its input is one more thing that can hide a match.
 */
export function forbiddenReferences(text) {
  const comments = [...text.matchAll(/<!--[\s\S]*?-->/g)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const inComment = (at) => comments.some(([start, end]) => at >= start && at < end);
  const found = [];
  for (const [re, what] of FORBIDDEN) {
    for (const m of text.matchAll(re)) {
      if (!inComment(m.index)) found.push({ what, match: m[0].trim() });
    }
  }
  return found;
}

/* ------------------------------------------------------------------------ the check ---- */

/**
 * Compare the page with the code. Returns the problems and the component list the capture uses.
 *
 * @param {ReturnType<typeof readInputs>} inputs
 */
export function checkComparison(inputs) {
  const problems = [...inputs.barrelProblems];
  const fail = (msg) => problems.push(msg);
  if (typeof inputs.doc !== 'string') {
    fail(`${DOC} does not exist`);
    return { problems, components: [] };
  }
  const { h2, sections, summaryRows, summaryHeaderLine, summaryTables, markerLines } = parseDoc(
    inputs.doc,
  );
  if (h2.includes(SUMMARY_HEADING) && summaryTables !== 1) {
    fail(`${DOC} "## ${SUMMARY_HEADING}" must hold exactly one table (found ${summaryTables})`);
  }
  for (const heading of [COMPONENTS_HEADING, SUMMARY_HEADING]) {
    if (!h2.includes(heading)) fail(`${DOC} has no "## ${heading}" section`);
  }

  const lastSection = sections.at(-1) ?? null;
  for (const [key, found] of Object.entries(markerLines)) {
    if (found.length !== 1) {
      fail(`${DOC} must hold \`${MARKERS[key]}\` exactly once (found ${found.length})`);
      continue;
    }
    const [{ lineNo, h2: under, after }] = found;
    const want = key === 'components' ? COMPONENTS_HEADING : SUMMARY_HEADING;
    // The generator appends the summary row to the first table after the marker, so a marker below
    // the table would send it past the end of the document.
    const misplaced =
      under !== want ||
      (key === 'components' && after !== lastSection) ||
      (key === 'summary' && summaryHeaderLine !== null && lineNo > summaryHeaderLine);
    if (misplaced) {
      fail(
        `${DOC}:${lineNo} \`${MARKERS[key]}\` must sit ` +
          (key === 'components'
            ? `after the last component section under "## ${COMPONENTS_HEADING}"`
            : `under "## ${SUMMARY_HEADING}", before its table`),
      );
    }
  }

  const exported = new Map(inputs.components.map((c) => [c.name, c]));
  const satoriIdByClass = inputs.satoriRegistrations;
  const satoriClassById = new Map([...satoriIdByClass].map(([cls, id]) => [id, cls]));
  const documented = new Map();
  const namedVariants = new Map();
  const images = new Map();
  const result = [];

  for (const s of sections) {
    const where = `${DOC}:${s.lineNo} "### ${s.heading}"`;
    if (s.tables !== 1) {
      fail(`${where} needs exactly one "| Field | Value |" table (found ${s.tables})`);
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!s.fields.has(field)) fail(`${where} has no "${field}" row`);
    }
    for (const field of s.fields.keys()) {
      if (!REQUIRED_FIELDS.includes(field) && !OPTIONAL_FIELDS.includes(field)) {
        fail(`${where} has an unknown row "${field}"`);
      }
    }

    const [component, ...extraComponents] = ticks(s.fields.get('Component') ?? '');
    if (!component || extraComponents.length || !/^Nxs\w+Component$/.test(component)) {
      fail(`${where} "Component" must name one \`Nxs…Component\` class`);
      continue;
    }
    if (!exported.has(component)) {
      fail(`${where} names ${component}, which ${BARREL} does not export — remove the section`);
      continue;
    }
    if (documented.has(component)) {
      fail(`${where} names ${component}, already documented at line ${documented.get(component)}`);
      continue;
    }
    documented.set(component, s.lineNo);

    const idCell = s.fields.get('Registered ID') ?? '';
    const [registeredId = null] = ticks(idCell);
    if (!registeredId && idCell !== '—') {
      fail(`${where} "Registered ID" must be one \`nxs.…\` ID or "—"`);
    }
    // Against every registration of *this* component, not against the IDs the library spells
    // somewhere: an ID that exists is not an ID this component answers to.
    const registeredAs = inputs.registeredBy.get(component) ?? [];
    if (registeredAs.length && !registeredAs.some((r) => r.id === registeredId)) {
      fail(
        `${where} ${registeredAs.map((r) => `${r.by} registers ${component} as ${r.id}`).join(', ')}` +
          `, not ${registeredId ?? '—'}`,
      );
    }
    if (!registeredAs.length && registeredId) {
      fail(
        `${where} names ID ${registeredId}, but nothing registers ${component} — not ` +
          `${REGISTRARS.map(([, by]) => by).join(', not ')}. Its "Registered ID" must be "—"`,
      );
    }

    const withSatori = s.fields.get('With Satori') ?? '';
    const own = withSatori.startsWith(OWN);
    if (!own && withSatori !== THEME_ONLY) {
      fail(`${where} "With Satori" must start with "${OWN}" or be "${THEME_ONLY}"`);
    }
    const variant = ticks(withSatori).find((t) => /^Nxs\w*Component$/.test(t)) ?? null;
    // `<sat-category-tag>`: the element the capture then requires inside the rendered wrapper, so
    // a wrapper rendering something else cannot pass a check named after Satori's component.
    const satElement =
      ticks(withSatori)
        .find((t) => /^<sat-[\w-]+>$/.test(t))
        ?.slice(1, -1) ?? null;
    const reRegistered = registeredId ? (satoriClassById.get(registeredId) ?? null) : null;
    if (own) {
      const renders = variant ? (inputs.satoriVariants.get(variant)?.elements ?? []) : [];
      if (!variant || !inputs.satoriVariants.has(variant)) {
        fail(`${where} says "${OWN}" but names no Satori variant class from ${SATORI_SRC}`);
      } else if (satoriIdByClass.get(variant) !== registeredId) {
        fail(
          `${where} provideNxsSatoriComponents() registers ${variant} as ` +
            `${satoriIdByClass.get(variant) ?? 'nothing'}, not ${registeredId ?? '—'}`,
        );
      } else if (satElement !== renders[0]) {
        fail(
          `${where} must name the element ${variant} renders, as \`<${renders[0] ?? 'sat-…'}>\`` +
            (satElement ? `, not \`<${satElement}>\`` : ''),
        );
      } else {
        namedVariants.set(variant, s.lineNo);
      }
    } else if (reRegistered) {
      fail(
        `${where} says "${THEME_ONLY}", but ${reRegistered} re-registers ${registeredId} on Satori`,
      );
    }

    const [story = null, satoriStory = null, ...extraStories] = ticks(
      s.fields.get('Storybook story') ?? '',
    );
    // A story *of* this component: its Storybook meta names it, or it renders the ID the component
    // is registered under. A story ID that merely exists would picture some other component.
    const storyProblem = (id, src, served, wanted) => {
      const of = served.get(id);
      if (!of) return `story ${id} is not a story in ${src}`;
      if (of.component) {
        return of.component === wanted
          ? null
          : `story ${id} renders ${of.component}, not ${wanted}`;
      }
      if (registeredId && of.renders.has(registeredId)) return null;
      return (
        `story ${id} names no component of its own and renders ` +
        (registeredId ? `no ${registeredId}` : 'by registered ID, which this section has none of')
      );
    };
    const storyFault = story
      ? storyProblem(story, BASE_SRC, inputs.baseStories, component)
      : `story (none) is not a story in ${BASE_SRC}`;
    if (storyFault) fail(`${where} ${storyFault}`);
    if (own) {
      const satoriFault = satoriStory
        ? storyProblem(satoriStory, SATORI_SRC, inputs.satoriStories, variant)
        : `needs a second story from ${SATORI_SRC}; (none) is not one`;
      if (satoriFault) fail(`${where} ${satoriFault}`);
    }
    if ((!own && satoriStory) || extraStories.length) {
      fail(`${where} "Storybook story" names more stories than it can use`);
    }

    const captured = s.fields.get('Captured') ?? CAPTURE_STATES[0];
    if (!CAPTURE_STATES.includes(captured)) {
      fail(`${where} "Captured" must be one of: ${CAPTURE_STATES.join(', ')}`);
    }

    const selector = inputs.selectors.get(component);
    const satoriSelector =
      own && variant ? (inputs.satoriVariants.get(variant)?.selector ?? null) : null;
    if (s.images.length !== 1) {
      fail(`${where} needs exactly one image (found ${s.images.length})`);
    } else if (!selector) {
      fail(`${where} cannot read ${component}'s selector, so cannot name its image`);
    } else {
      const want = imageNameFor(selector);
      const [image] = s.images;
      if (image.src !== want) fail(`${where} image must be ${want}, not ${image.src}`);
      if (!image.alt.trim()) fail(`${where} image has no alt text`);
      if (images.has(image.src))
        fail(`${where} image ${image.src} is also used at line ${images.get(image.src)}`);
      images.set(image.src, s.lineNo);
    }

    result.push({
      heading: s.heading,
      component,
      selector,
      own,
      variant: own ? variant : null,
      satoriSelector,
      satElement: own ? satElement : null,
      registeredId,
      story,
      satoriStory: own ? satoriStory : null,
      captured,
      image: s.images[0]?.src ?? null,
    });
  }

  for (const c of inputs.components) {
    if (!documented.has(c.name)) {
      fail(
        `${c.name} is exported from ${BARREL} but has no section in ${DOC}. Add one under ` +
          `"## ${COMPONENTS_HEADING}" and a row under "## ${SUMMARY_HEADING}", then run ` +
          '`npm run docs:satori-comparison:capture` and `npm run docs:satori-comparison:publish`.',
      );
    }
  }
  for (const [variant, { file }] of inputs.satoriVariants) {
    if (!namedVariants.has(variant)) {
      fail(`Satori variant ${variant} (${file}) is not named by any section's "With Satori" row`);
    }
  }

  const byHeading = new Map(result.map((r) => [r.heading, r]));
  const rowNames = new Set();
  for (const { lineNo, cells: row } of summaryRows) {
    const [name, idCell = '', differs = ''] = row;
    const where = `${DOC}:${lineNo} "${SUMMARY_HEADING}" row "${name}"`;
    rowNames.add(name);
    const section = byHeading.get(name);
    if (!section) {
      fail(`${where} has no "### ${name}" section under "## ${COMPONENTS_HEADING}"`);
      continue;
    }
    const [rowId = null] = ticks(idCell);
    if (rowId !== section.registeredId) {
      fail(`${where} says ${rowId ?? '—'}, its section says ${section.registeredId ?? '—'}`);
    }
    if (differs.startsWith('Yes') !== section.own) {
      fail(`${where} "Differs with Satori?" disagrees with its section's "With Satori" row`);
    }
  }
  for (const r of result) {
    if (!rowNames.has(r.heading))
      fail(`"### ${r.heading}" has no row under "## ${SUMMARY_HEADING}"`);
  }

  const known = new Set([...images.keys(), ...Object.values(FULL_IMAGES)]);
  for (const ref of imageReferences(inputs.doc)) {
    if (!known.has(ref.src)) {
      fail(
        `${DOC}:${ref.lineNo} image ${ref.src} is neither a component's nor one the capture produces`,
      );
    }
  }
  for (const { what, match } of forbiddenReferences(inputs.doc)) {
    fail(
      `${DOC} contains ${what} ("${match}"); the page describes the components, not their history`,
    );
  }

  return { problems, components: result };
}

/**
 * The page's component sections, checked, for the capture and publish commands. Throws if the
 * page fails the check: neither command should run against a page CI would reject.
 */
export function loadComparison(root = ROOT) {
  const inputs = readInputs(root);
  const { problems, components } = checkComparison(inputs);
  if (problems.length) {
    throw new Error(
      `${DOC} fails its check — run \`npm run docs:satori-comparison:check\`:\n  ` +
        problems.join('\n  '),
    );
  }
  return { doc: inputs.doc, components };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = readInputs(ROOT);
  const { problems, components } = checkComparison(inputs);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, components }, null, 2));
  } else {
    const own = components.filter((c) => c.own).length;
    console.log(
      `satori-comparison-doc: ${inputs.components.length} component(s) exported, ` +
        `${components.length} section(s) in ${relative(ROOT, join(ROOT, DOC))} ` +
        `(${own} with a Satori variant, ${components.length - own} theme only)`,
    );
    for (const p of problems) console.error(`  FAIL ${p}`);
    console.log(problems.length ? `\nFAIL — ${problems.length} problem(s)` : 'pass');
  }
  process.exitCode = problems.length ? 1 : 0;
}
