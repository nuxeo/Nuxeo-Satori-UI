/**
 * NXSAT-545 / IBM 2851011211 — document detail `.version-select` keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (standalone `:focus` selector). Runtime
 * inset geometry and hover cascade: `apps/nuxeo-ui/.../version-select-focus-ring.spec.ts`.
 * WCAG contrast / focus visibility verdict: a11y journey `document-detail-version-select`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Drop SCSS comments so commented-out rules cannot satisfy selector lookups. */
function stripScssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function selectorBlock(scss: string, selector: string): string {
  const start = scss.indexOf(selector);
  expect(start, `selector ${selector}`).toBeGreaterThan(-1);
  const openBrace = scss.indexOf('{', start);
  expect(openBrace, `opening brace for ${selector}`).toBeGreaterThan(start);
  let depth = 0;
  for (let i = openBrace; i < scss.length; i++) {
    if (scss[i] === '{') {
      depth++;
    }
    if (scss[i] === '}') {
      depth--;
      if (depth === 0) {
        return scss.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed block for ${selector}`);
}

describe('DocumentDetailComponent — version-select focus ring (NXSAT-545)', () => {
  const scssPath = join(import.meta.dirname, 'document-detail-version-select-focus.scss');
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const componentPath = join(import.meta.dirname, 'document-detail.ts');

  it('wires version-select on the production properties panel version control', () => {
    const html = readFileSync(templatePath, 'utf8');
    const clickIdx = html.indexOf('(click)="toggleVersionDropdown()"');
    expect(clickIdx, 'version dropdown toggle handler').toBeGreaterThan(-1);
    const tagStart = html.lastIndexOf('<button', clickIdx);
    expect(tagStart, 'version control must be a button').toBeGreaterThan(-1);
    const tagEnd = html.indexOf('>', clickIdx);
    expect(tagEnd, 'version control opening tag must close').toBeGreaterThan(clickIdx);
    const openingTag = html.slice(tagStart, tagEnd + 1);
    expect(openingTag).toContain('class="version-select"');
    const versionRow = html.slice(Math.max(0, clickIdx - 120), clickIdx + 280);
    expect(versionRow).toContain('class="version-select-wrapper"');
    expect(versionRow).toMatch(/<mat-icon[^>]*class="version-arrow"/);
  });

  it('declares a standalone :focus ring on the version selector', () => {
    const raw = readFileSync(scssPath, 'utf8');
    expect(raw).toMatch(/NXSAT-545[\s\S]*2851011211/);
    const scss = stripScssComments(raw);
    const focusBlock = selectorBlock(scss, '.version-select:focus {');
    expect(focusBlock).toMatch(
      /outline:\s*2px\s+solid\s+var\(--document-detail-properties-label-muted\)/,
    );
  });

  it('loads version-select focus styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-version-select-focus\.scss['"]/);
  });

  it('pins version-select fill and accent to light-panel tokens', () => {
    const scss = stripScssComments(readFileSync(scssPath, 'utf8'));
    const baseBlock = selectorBlock(scss, '.version-select {');
    expect(baseBlock).toMatch(/background:\s*var\(--document-detail-properties-panel-surface\)/);
    expect(baseBlock).toMatch(/color:\s*var\(--document-detail-properties-accent\)/);
    expect(baseBlock).toMatch(/border-color:\s*var\(--document-detail-properties-accent\)/);
    expect(baseBlock).toMatch(
      /\.version-arrow[\s\S]*color:\s*var\(--document-detail-properties-accent\)/,
    );

    const hoverBlock = selectorBlock(scss, '.version-select:hover {');
    expect(hoverBlock).toMatch(
      /color-mix\([\s\S]*var\(--document-detail-properties-accent\)\s+8%/,
    );
    expect(hoverBlock).toMatch(/var\(--document-detail-properties-panel-surface\)/);

    const focusHoverBlock = selectorBlock(scss, '.version-select:focus:hover {');
    expect(focusHoverBlock).toMatch(
      /color-mix\([\s\S]*var\(--document-detail-properties-accent\)\s+8%/,
    );
    expect(focusHoverBlock).toMatch(
      /var\(--document-detail-properties-panel-surface\)/,
    );
  });
});

