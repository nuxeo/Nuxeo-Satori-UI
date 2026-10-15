import { formatFiles, generateFiles, names, readProjectConfiguration, type Tree } from '@nx/devkit';
import { join } from 'node:path';

import { assertIdAbsent, insertAboveMarker } from '../util/splice';

export type SatoriComponentSlot = 'sidebar' | 'tabs' | 'documentView' | 'routes';

export interface SatoriComponentSchema {
  name: string;
  slot: SatoriComponentSlot;
  project?: string;
}

/**
 * Append `row` to the Markdown table that follows `marker`.
 *
 * Not `insertAboveMarker`: a row above a comment that ends a table lands after the blank line
 * Prettier keeps there, outside the table. So the marker precedes the table, and the row goes
 * after its last line. Throws if either is missing, for the same reason the splice does.
 */
function appendRowToTableAfterMarker(tree: Tree, file: string, marker: string, row: string): void {
  const lines = (tree.read(file, 'utf-8') ?? '').split('\n');
  const at = lines.findIndex((line) => line.includes(marker));
  if (at === -1) {
    throw new Error(`${file} has no \`${marker}\` marker, so the ID cannot be documented there.`);
  }
  let start = at + 1;
  while (start < lines.length && lines[start].trim() === '') start += 1;
  let end = start;
  while (end < lines.length && lines[end].trimStart().startsWith('|')) end += 1;
  if (end - start < 2) {
    throw new Error(
      `${file} has no table after \`${marker}\`, so the ID cannot be documented there.`,
    );
  }
  lines.splice(end, 0, row);
  tree.write(file, lines.join('\n'));
}

/**
 * Insert a Markdown section on the lines above `marker`, followed by a blank line.
 *
 * Its own function rather than `insertAboveMarker`, whose error tells you to restore a `//`
 * comment inside a code block; this marker is an HTML comment in a page.
 */
function insertSectionAboveMarker(tree: Tree, file: string, marker: string, section: string): void {
  const lines = (tree.read(file, 'utf-8') ?? '').split('\n');
  const at = lines.findIndex((line) => line.trim() === marker);
  if (at === -1) {
    throw new Error(
      `${file} has no \`${marker}\` line, so the component's section cannot be added there. ` +
        'Restore it on a line of its own after the last component section.',
    );
  }
  lines.splice(at, 0, ...section.split('\n'), '');
  tree.write(file, lines.join('\n'));
}

/** The slots whose descriptors name a component by `componentId`. */
const SLOTS: readonly SatoriComponentSlot[] = ['sidebar', 'tabs', 'documentView', 'routes'];

const REFERENCE = 'docs/extension-reference.md';
/** The with-and-without-Satori page, and where `satori-comparison-doc.mjs` expects a generator to splice. */
const COMPARISON = 'docs/satori-components/with-and-without-satori.md';
const COMPARISON_MARKERS = {
  components: '<!-- satori:comparison:components -->',
  summary: '<!-- satori:comparison:summary -->',
};
const THEME_ONLY = 'Same component; theme only';

/** What each slot's host does with a placed component, as the Overview and the spec state it. */
const HOSTS: Record<
  SatoriComponentSlot,
  { passesInputs: boolean; whenToUse: string; placement: string; data: string }
> = {
  documentView: {
    passesInputs: true,
    whenToUse: "as the body of a document's View tab, for the documents a manifest entry chooses",
    placement:
      'A `documentView` entry makes it the View tab of the documents its `rule` passes (a type ' +
      'check is the usual one; with no rule, every document) and sets its `inputs` on it:',
    data:
      'Its inputs, and nothing else. The `documentView` host sets `document` to the focused ' +
      'document each time it changes, overwriting any `inputs.document` in the manifest, and sets ' +
      "the entry's other `inputs` as they are.",
  },
  routes: {
    passesInputs: true,
    whenToUse: 'as a page at a path a manifest adds, inside the application shell',
    placement: "A `routes` entry serves it at a path, and sets the entry's `inputs` on it:",
    data: "Its inputs, and nothing else: the route entry's `inputs`, set from the route's data.",
  },
  tabs: {
    passesInputs: false,
    whenToUse: 'as the body of a tab a manifest adds to the document page',
    placement:
      'A `tabs` entry adds a tab to the document page with it as the body. The tab host sets no ' +
      'inputs, so in a tab it renders without a heading:',
    data:
      'Nothing yet. The `tabs` host sets no inputs, so whatever it shows in a tab it has to read ' +
      'itself.',
  },
  sidebar: {
    passesInputs: false,
    whenToUse: 'as the drawer a manifest-added navigation entry opens',
    placement:
      'A navigation entry with `hasDrawer` opens a drawer, and a `sidebar` entry with the same ' +
      '`id` fills it with this component. The drawer sets no inputs, so there it renders without ' +
      'a heading:',
    data: 'Nothing yet. The drawer sets no inputs, so whatever it shows there it has to read itself.',
  },
};

/** The manifest fragment that places `componentId` in `slot`. */
function placementFor(
  slot: SatoriComponentSlot,
  componentId: string,
  fileName: string,
  propertyName: string,
  title: string,
): string {
  const slots =
    slot === 'documentView'
      ? { documentView: [{ id: componentId, componentId, inputs: { heading: title } }] }
      : slot === 'routes'
        ? { routes: [{ id: componentId, path: fileName, inputs: { heading: title } }] }
        : slot === 'tabs'
          ? { tabs: [{ id: componentId, label: title, componentId }] }
          : {
              // A path of its own: the shell tells drawers apart by `path`, and a packaged one
              // (`/browse`) would toggle that entry's drawer and navigate to its page.
              navbar: [
                {
                  id: `acme.navbar.${propertyName}`,
                  label: title,
                  path: `/${fileName}`,
                  icon: 'view_sidebar',
                  hasDrawer: true,
                },
              ],
              sidebar: [{ id: `acme.navbar.${propertyName}`, componentId }],
            };
  return JSON.stringify({ extensions: { slots } }, null, 2);
}

/**
 * Add an `nxs-` component to the platform's own library, registered by ID for one slot.
 *
 * This is the platform's generator, not a customer's: `nxs-` and `nxs.` are our prefixes, so a
 * customer contributes with `extension-component` under their own. It is marked internal in
 * `generators.json` and not shipped in the package.
 *
 * It emits everything the library's per-component gates require, so the output passes them as
 * generated: the component on theme tokens with only translated text inputs; a spec that asserts
 * registry state and renders the component the way its slot's host does; a story tagged
 * `autodocs` with a typed control for its numeric input; an Overview page; the barrel export; the
 * registration in `provideNxsComponents()`; the ID's row in the extension reference; and its
 * section and row on the with-and-without-Satori page. Each splice goes through a marker and
 * throws if the marker is gone, rather than guessing. `beta:api` is the exception, on purpose: a
 * new export is a public API change, red until its snapshot is updated and reviewed.
 *
 * It registers; it does not place. Putting the component on a screen is a manifest entry in the
 * slot (Layer 1), which the closing message spells out.
 */
export default async function satoriComponentGenerator(tree: Tree, options: SatoriComponentSchema) {
  if (!SLOTS.includes(options.slot)) {
    throw new Error(
      `--slot must be one of ${SLOTS.join(', ')}: the slots whose descriptors render a component ` +
        `by ID. "${options.slot}" is not one of them.`,
    );
  }
  const projectName = options.project ?? 'satori-components';
  let root: string;
  try {
    root = readProjectConfiguration(tree, projectName).root;
  } catch {
    throw new Error(
      `No project named "${projectName}". This generator adds to the platform's nxs- library; ` +
        'to contribute a component from your own library, use extension-component under your prefix.',
    );
  }
  const provider = `${root}/src/lib/provide-nxs-components.ts`;
  const barrel = `${root}/src/index.ts`;
  const headingLevel = `${root}/src/lib/heading-level.ts`;
  for (const file of [provider, barrel, headingLevel, REFERENCE, COMPARISON]) {
    if (!tree.exists(file)) {
      throw new Error(
        `${file} does not exist, so "${projectName}" is not the nxs- component library this ` +
          'generator registers into.',
      );
    }
  }

  const name = names(options.name);
  const componentId = `nxs.${options.slot}.${name.propertyName}`;
  const className = `Nxs${name.className}Component`;
  const dir = `${root}/src/lib/${name.fileName}`;
  // Sentence case, as the library's other story titles and page headings are.
  const words = name.fileName.replace(/-/g, ' ');
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  const host = HOSTS[options.slot];
  const placement = placementFor(
    options.slot,
    componentId,
    name.fileName,
    name.propertyName,
    title,
  );

  assertIdAbsent(tree, provider, componentId);
  if (tree.exists(dir)) {
    throw new Error(`${dir} already exists. Choose another name, or delete the directory.`);
  }
  // `foo-1` and `foo1` share a class name. In different slots their IDs and directories differ,
  // so neither check above sees the second import of the same class.
  for (const file of [provider, barrel]) {
    if (new RegExp(String.raw`\b${className}\b`).test(tree.read(file, 'utf-8') ?? '')) {
      throw new Error(
        `${file} already names ${className}, and "${options.name}" would import it a second ` +
          'time, so the library would not typecheck. Choose another name.',
      );
    }
  }

  generateFiles(tree, join(__dirname, 'files'), `${root}/src/lib`, {
    ...name,
    className,
    componentId,
    slot: options.slot,
    isDocumentView: options.slot === 'documentView',
    isRoute: options.slot === 'routes',
    hostPassesInputs: host.passesInputs,
    host,
    placement,
    title,
    storiesName: `${name.className}Stories`,
    tmpl: '',
  });

  insertAboveMarker(tree, provider, 'satori:import:components', [
    `import { ${className} } from './${name.fileName}/${name.fileName}.component';`,
  ]);
  insertAboveMarker(tree, provider, 'satori:register:components', [
    `'${componentId}': ${className},`,
  ]);
  insertAboveMarker(tree, barrel, 'satori:export:components', [
    `export { ${className} } from './lib/${name.fileName}/${name.fileName}.component';`,
  ]);
  appendRowToTableAfterMarker(
    tree,
    REFERENCE,
    'satori:register:nxs-components',
    `| \`${componentId}\` | \`nxs-${name.fileName}\` | \`${options.slot}\` |`,
  );

  // The shape `satori-comparison-doc.mjs` checks, and its selftest's `generatedComponent()` mirrors.
  const shows = options.slot === 'documentView' ? 'heading and document title' : 'heading';
  insertSectionAboveMarker(
    tree,
    COMPARISON,
    COMPARISON_MARKERS.components,
    [
      `### ${title}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| Component | \`${className}\` |`,
      `| Registered ID | \`${componentId}\` |`,
      `| With Satori | ${THEME_ONLY} |`,
      `| Storybook story | \`components-${name.fileName}--default\` |`,
      '',
      `![${title}: without Satori on the left, with Satori on the right](${name.fileName}-side-by-side.png ` +
        `'Left: without Satori (Material theme). Right: with Satori (Satori theme). Same component, same inputs.')`,
      '',
      `The same ${shows} in both; the theme sets the type and the colours.`,
    ].join('\n'),
  );
  appendRowToTableAfterMarker(
    tree,
    COMPARISON,
    'satori:comparison:summary',
    `| ${title} | \`${componentId}\` | ${THEME_ONLY} |`,
  );

  await formatFiles(tree);

  return () => {
    console.log(`
Registered ${componentId}

  component  ${dir}/${name.fileName}.component.ts  (${className})
  spec       asserts the registration, and renders it as the ${options.slot} host does
  story      ${dir}/${name.fileName}.stories.ts  (autodocs; headingLevel has a typed select)
  overview   ${dir}/${name.fileName}.mdx
  exported   from ${barrel}
  documented ${REFERENCE}, and a section and row in ${COMPARISON}

Registered, not placed. A manifest places it, with no rebuild:
${placement.replace(/^/gm, '  ')}

Next:
  1. Make it do its job, then rewrite what its Overview and its section on the
     with-and-without-Satori page say: as generated, both describe the scaffold.
  2. npx nx test ${projectName} --coverage.enabled=true && npm run beta:coverage
  3. npx nx run-many -t lint,typecheck -p ${projectName} && npm run review:guardrails
  4. npm run beta:reference && npm run docs:satori-comparison:check
  5. npx nx run ${projectName}:build-storybook
  6. npx nx build platform && npm run beta:api -- --update — and review the new public API —
     then npm run beta:publishable
  7. npm run docs:satori-comparison:capture (needs the GitHub Packages token), then
     npm run docs:satori-comparison:publish (your Confluence credentials), so the page shows
     ${title} with and without Satori.
`);
  };
}
