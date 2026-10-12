import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import satoriComponentGenerator, { type SatoriComponentSchema } from './generator';

const ROOT = 'libs/shared/satori-components';
const PROVIDER = `${ROOT}/src/lib/provide-nxs-components.ts`;
const BARREL = `${ROOT}/src/index.ts`;
const HEADING_LEVEL = `${ROOT}/src/lib/heading-level.ts`;
const REFERENCE = 'docs/extension-reference.md';
const COMPARISON = 'docs/satori-components/with-and-without-satori.md';

const PROVIDER_SOURCE = `import type { EnvironmentProviders } from '@angular/core';
import { provideSatoriExtensions } from '@nuxeo-satori/platform/extensions';

import { NxsTagComponent } from './tag/tag.component';
// satori:import:components — \`satori-component\` inserts above this line

export function provideNxsComponents(): EnvironmentProviders {
  return provideSatoriExtensions({
    components: {
      'nxs.primitives.tag': NxsTagComponent,
      // satori:register:components — \`satori-component\` inserts above this line
    },
  });
}
`;

const REFERENCE_SOURCE = `# Reference

<!-- satori:register:nxs-components — \`satori-component\` appends a row to the table below -->

| Component ID | Element | For the slot |
| ------------ | ------- | ------------ |

---
`;

const COMPARISON_SOURCE = `# With and without Satori

## Side by side

### Tag

| Field | Value |
| --- | --- |
| Component | \`NxsTagComponent\` |

The tag.

<!-- satori:comparison:components -->

## All components

<!-- satori:comparison:summary -->

| Component | Registered ID (if any) | Differs with Satori? |
| --- | --- | --- |
| Tag | \`nxs.primitives.tag\` | Yes — Satori's own component |

## About this page
`;

function library(tree: Tree): void {
  addProjectConfiguration(tree, 'satori-components', {
    root: ROOT,
    sourceRoot: `${ROOT}/src`,
    projectType: 'library',
  });
  tree.write(PROVIDER, PROVIDER_SOURCE);
  tree.write(
    BARREL,
    "export { NxsTagComponent } from './lib/tag/tag.component';\n// satori:export:components\n",
  );
  tree.write(HEADING_LEVEL, 'export type NxsHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;\n');
  tree.write(REFERENCE, REFERENCE_SOURCE);
  tree.write(COMPARISON, COMPARISON_SOURCE);
}

const read = (tree: Tree, file: string): string => tree.read(file, 'utf-8') ?? '';
const generated = (tree: Tree, name: string, suffix: string): string =>
  read(tree, `${ROOT}/src/lib/${name}/${name}.${suffix}`);

/** Run the generator and its closing callback, returning what the callback printed. */
async function generate(tree: Tree, options: SatoriComponentSchema): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  log.mockClear();
  const done = await satoriComponentGenerator(tree, options);
  done();
  return log.mock.calls.map((args) => args.join(' ')).join('\n');
}

describe('satori-component generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    library(tree);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the component, its spec, its story and its Overview page', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'sidebar' });
    for (const suffix of [
      'component.ts',
      'component.html',
      'component.scss',
      'component.spec.ts',
      'stories.ts',
      'mdx',
    ]) {
      expect(tree.exists(`${ROOT}/src/lib/claim-summary/claim-summary.${suffix}`)).toBe(true);
    }
    const component = generated(tree, 'claim-summary', 'component.ts');
    expect(component).toContain("selector: 'nxs-claim-summary'");
    expect(component).toContain('standalone: true');
    expect(component).toContain('export class NxsClaimSummaryComponent');
    expect(component).not.toContain('document = input');
  });

  it('renders the heading as a native heading at a typed level, and requires no input', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    // Whitespace-insensitive: this tree formats at Prettier's default width, not the repository's.
    const component = generated(tree, 'claim-summary', 'component.ts').replace(/\s+/g, ' ');
    expect(component).toContain(
      'readonly headingLevel: InputSignal<NxsHeadingLevel> = input<NxsHeadingLevel>(2);',
    );
    expect(component).not.toContain('input.required');
    const template = generated(tree, 'claim-summary', 'component.html');
    expect(template).toContain('@if (heading().trim())');
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(template).toContain(`<h${level} class="nxs-claim-summary__heading">`);
    }
    expect(generated(tree, 'claim-summary', 'component.scss')).toContain(
      '.nxs-claim-summary__heading.nxs-claim-summary__heading {',
    );
  });

  it('tags the story autodocs and gives headingLevel a select typed as the union', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    const story = generated(tree, 'claim-summary', 'stories.ts');
    expect(story).toContain("title: 'Components/Claim summary'");
    expect(story).toContain('component: NxsClaimSummaryComponent');
    expect(story).toContain("tags: ['autodocs']");
    expect(story).toContain(
      'const HEADING_LEVELS: readonly NxsHeadingLevel[] = [1, 2, 3, 4, 5, 6];',
    );
    expect(story).toContain("headingLevel: { control: 'select', options: HEADING_LEVELS }");
    expect(story).toContain('export const Default: Story');
  });

  it.each(['sidebar', 'tabs', 'documentView', 'routes'] as const)(
    'writes a %s Overview the docs-coverage check counts, its text unescaped',
    async (slot) => {
      await generate(tree, { name: 'claim-summary', slot });
      const overview = generated(tree, 'claim-summary', 'mdx');
      expect(overview).toContain("import * as ClaimSummaryStories from './claim-summary.stories';");
      expect(overview).toContain('<Meta of={ClaimSummaryStories} name="Overview" />');
      const sections = [...overview.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);
      expect(sections).toEqual(
        expect.arrayContaining([
          'Key features',
          'Demo showcase',
          'Usage',
          'Examples',
          'Accessibility',
        ]),
      );
      expect(overview).toContain('<Canvas of={ClaimSummaryStories.Default} />');
      expect(overview).toContain("from '@nuxeo-satori/platform/components'");
      expect(overview).toContain(`registers it as \`nxs.${slot}.claimSummary\``);
      // The manifest example that places it: a route by its path, every other slot by componentId.
      expect(overview).toContain(
        slot === 'routes' ? '"path": "claim-summary"' : `"componentId": "nxs.${slot}.claimSummary"`,
      );
      expect(overview).not.toMatch(/^\s*\|.*\|\s*$/m);
      expect(overview).not.toMatch(/&#\d+;|&#x[\da-f]+;|&quot;|&amp;/i);
    },
  );

  it('registers the ID as live code above the marker, with its import', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    const provider = read(tree, PROVIDER);
    const lines = provider.split('\n').map((line) => line.trim());
    expect(lines).toContain("'nxs.tabs.claimSummary': NxsClaimSummaryComponent,");
    expect(lines).toContain(
      "import { NxsClaimSummaryComponent } from './claim-summary/claim-summary.component';",
    );
    expect(provider.indexOf("'nxs.tabs.claimSummary'")).toBeLessThan(
      provider.indexOf('satori:register:components'),
    );
  });

  it('exports the component from the barrel', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    expect(read(tree, BARREL)).toContain(
      "export { NxsClaimSummaryComponent } from './lib/claim-summary/claim-summary.component';",
    );
  });

  it('documents the ID as a row of the reference table, not after it', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    const reference = read(tree, REFERENCE).split('\n');
    const header = reference.findIndex((line) => line.startsWith('| Component ID'));
    const row = reference.findIndex((line) => line.includes('`nxs.tabs.claimSummary`'));
    expect(row).toBe(header + 2);
    expect(reference[row]).toContain('`nxs-claim-summary`');
  });

  it('adds its section above the comparison marker and its row to the summary table', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    const page = read(tree, COMPARISON);
    const lines = page.split('\n');
    const section = lines.indexOf('### Claim summary');
    expect(section).toBeGreaterThan(lines.indexOf('### Tag'));
    expect(section).toBeLessThan(lines.indexOf('<!-- satori:comparison:components -->'));
    const fields = lines.slice(section, lines.indexOf('<!-- satori:comparison:components -->'));
    expect(fields.join('\n')).toMatch(/\| Component +\| `NxsClaimSummaryComponent` +\|/);
    expect(fields.join('\n')).toMatch(/\| Registered ID +\| `nxs\.tabs\.claimSummary` +\|/);
    expect(fields.join('\n')).toMatch(/\| With Satori +\| Same component; theme only +\|/);
    expect(fields.join('\n')).toMatch(
      /\| Storybook story +\| `components-claim-summary--default` +\|/,
    );
    expect(fields.filter((line) => line.startsWith('!['))).toEqual([
      expect.stringContaining('](claim-summary-side-by-side.png '),
    ]);

    const summary = lines.indexOf('<!-- satori:comparison:summary -->');
    const row = lines.findIndex((line) => line.startsWith('| Claim summary'));
    expect(row).toBeGreaterThan(summary);
    expect(lines[row - 1]).toMatch(/^\| Tag /);
    expect(lines[row]).toMatch(/`nxs\.tabs\.claimSummary` +\| Same component; theme only +\|$/);
  });

  it('gives a documentView component the document input, and renders it as that host does', async () => {
    const message = await generate(tree, { name: 'claim-view', slot: 'documentView' });
    expect(generated(tree, 'claim-view', 'component.ts')).toContain(
      'readonly document = input<NuxeoDocument | null>(null);',
    );
    expect(generated(tree, 'claim-view', 'component.html')).toContain('doc.title');
    const spec = generated(tree, 'claim-view', 'component.spec.ts');
    expect(spec).toContain('shows the focused document’s title');
    expect(spec).toContain('[componentInputs]="inputs"');
    expect(spec).toContain("inputs: { heading: 'Rendered by ID' }");
    expect(generated(tree, 'claim-view', 'stories.ts')).toContain('export const WithoutADocument');
    expect(message).toContain('"heading": "Claim view"');
  });

  it('renders a routes entry through the routes the slot builds, with its inputs', async () => {
    const message = await generate(tree, { name: 'claim-page', slot: 'routes' });
    const spec = generated(tree, 'claim-page', 'component.spec.ts');
    expect(spec).toContain("path: 'claim-page'");
    expect(spec).toContain('extensionRoutes(entries)');
    expect(spec).toContain('withComponentInputBinding()');
    expect(spec).not.toContain('lib-extension-outlet');
    expect(message).toContain('"path": "claim-page"');
    expect(message).toContain('"heading": "Claim page"');
  });

  it('renders a tabs or sidebar component with no inputs, as those hosts do', async () => {
    await generate(tree, { name: 'claim-tab', slot: 'tabs' });
    const spec = generated(tree, 'claim-tab', 'component.spec.ts');
    expect(spec).toContain('template: `<lib-extension-outlet [componentId]="componentId" />`');
    expect(spec).not.toContain('componentInputs');
  });

  it('places a sidebar component behind a nav entry that opens a drawer', async () => {
    const message = await generate(tree, { name: 'claim-drawer', slot: 'sidebar' });
    expect(message).toContain('"hasDrawer": true');
    expect(message.match(/"id": "acme\.navbar\.claimDrawer"/g)).toHaveLength(2);
    expect(message).toContain('"componentId": "nxs.sidebar.claimDrawer"');
  });

  it('names the capture and publish steps the comparison page needs', async () => {
    const message = await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    expect(message).toContain('npm run docs:satori-comparison:check');
    expect(message).toContain('npm run docs:satori-comparison:capture');
    expect(message).toContain('npm run docs:satori-comparison:publish');
  });

  it('refuses a slot that does not render a component by ID', async () => {
    await expect(
      satoriComponentGenerator(tree, { name: 'x', slot: 'toolbar' as never }),
    ).rejects.toThrow(/--slot must be one of sidebar, tabs, documentView, routes/);
  });

  it('refuses to register an ID twice', async () => {
    await generate(tree, { name: 'claim-summary', slot: 'tabs' });
    await expect(
      satoriComponentGenerator(tree, { name: 'claim-summary', slot: 'tabs' }),
    ).rejects.toThrow(/nxs\.tabs\.claimSummary is already registered/);
  });

  it('refuses a workspace without the nxs- library, pointing a customer elsewhere', async () => {
    const empty = createTreeWithEmptyWorkspace();
    await expect(satoriComponentGenerator(empty, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      /use extension-component under your prefix/,
    );
  });

  it.each([HEADING_LEVEL, COMPARISON])('refuses a library without %s', async (file) => {
    tree.delete(file);
    await expect(satoriComponentGenerator(tree, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      `${file} does not exist`,
    );
  });

  it('refuses when the registration marker is gone, rather than guessing', async () => {
    tree.write(PROVIDER, PROVIDER_SOURCE.replace(/.*satori:register:components.*\n/, ''));
    await expect(satoriComponentGenerator(tree, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      /has no `satori:register:components` marker/,
    );
  });

  it('refuses when the reference table is gone', async () => {
    tree.write(REFERENCE, REFERENCE_SOURCE.replace(/\| Component ID[\s\S]*?\n\n/, ''));
    await expect(satoriComponentGenerator(tree, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      /has no table after `satori:register:nxs-components`/,
    );
  });

  it('refuses when the comparison page has lost its section marker', async () => {
    tree.write(
      COMPARISON,
      COMPARISON_SOURCE.replace('<!-- satori:comparison:components -->\n', ''),
    );
    await expect(satoriComponentGenerator(tree, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      /has no `<!-- satori:comparison:components -->` line/,
    );
  });

  it('refuses when the comparison page has lost its summary table', async () => {
    tree.write(COMPARISON, COMPARISON_SOURCE.replace(/\| Component \| Registered[\s\S]*?\n\n/, ''));
    await expect(satoriComponentGenerator(tree, { name: 'x', slot: 'tabs' })).rejects.toThrow(
      /has no table after `satori:comparison:summary`/,
    );
  });
});
