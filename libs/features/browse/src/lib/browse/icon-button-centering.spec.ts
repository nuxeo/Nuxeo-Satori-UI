/**
 * NXSAT-809 — a Material icon button is 40px: a 24px icon with 8px of padding on each side. Each
 * rule below resizes one (to 28, 30, 32 or 36px) and sets a smaller icon, and without centring the
 * icon the leftover padding puts it low and to the right of the button's centre. The document
 * viewer's buttons are measured in a real browser by
 * `apps/nuxeo-ui/.../document-viewer-icon-button-centering.spec.ts`; these are the rest.
 *
 * It reads the stylesheets, because a component's stylesheet is only reachable from its own
 * template and these buttons are in screens that need a server to render. If a rule is renamed,
 * the test says so rather than passing without checking anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../../../../..');

/** Each button rule: its stylesheet, then the selectors to follow, outermost first. */
const RULES: ReadonlyArray<{ file: string; path: readonly string[]; what: string }> = [
  {
    file: 'apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.scss',
    path: ['.favorite-card-remove'],
    what: 'Favorites: remove from favorites',
  },
  {
    file: 'apps/nuxeo-ui/src/app/shell/nav-drawer/nav-drawer.component.scss',
    path: ['.clipboard-card-remove'],
    what: 'Clipboard: remove from clipboard',
  },
  {
    file: 'libs/features/browse/src/lib/browse/browse.scss',
    path: ['.gear-btn'],
    what: 'Browse: Manage columns',
  },
  {
    file: 'libs/features/assets/src/lib/asset-search-results/asset-search-results.component.scss',
    path: ['.gear-btn'],
    what: 'Assets: Manage columns',
  },
  {
    file: 'libs/features/search/src/lib/search/search.scss',
    path: ['.gear-btn'],
    what: 'Search: Manage columns',
  },
  {
    file: 'libs/features/trash/src/lib/trash-filters-drawer/trash-filters-drawer.component.scss',
    path: ['.view-switcher-btn'],
    what: 'Trash: view switcher',
  },
  {
    file: 'libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    path: ['.attachment-actions', 'button'],
    what: 'Document: attachment actions',
  },
  {
    file: 'libs/shared/ui/src/lib/document-viewer/document-viewer.component.scss',
    path: ['.format-download-btn'],
    what: 'Viewer: format download',
  },
  {
    file: 'libs/shared/ui/src/lib/document-viewer/document-viewer.component.scss',
    path: ['.viewer-toolbar', 'button'],
    what: 'Viewer: image toolbar',
  },
];

/** The text between the braces that open at `from`, with nested blocks removed. */
function declarationsAt(scss: string, from: number): string {
  let depth = 0;
  let top = '';
  for (let i = from; i < scss.length; i += 1) {
    const ch = scss[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return top;
    } else if (depth === 1) top += ch;
  }
  throw new Error('unbalanced braces');
}

/** The declarations of the rule reached by following `path` from the top of the file. */
function ruleDeclarations(scss: string, path: readonly string[]): string {
  let from = 0;
  for (const selector of path) {
    const found = new RegExp(`(^|[\\s}])${selector.replace(/[.]/g, '\\.')}\\s*\\{`, 'm').exec(
      scss.slice(from),
    );
    expect(found, `a rule for "${selector}" in ${path.join(' ')}`).not.toBeNull();
    const open = from + (found as RegExpExecArray).index + (found as RegExpExecArray)[0].length - 1;
    from = open;
  }
  return declarationsAt(scss, from);
}

describe('icon buttons that were resized centre their icon (NXSAT-809)', () => {
  it.each(RULES)('$what', ({ file, path }) => {
    const scss = readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const rule = ruleDeclarations(scss, path);
    expect(rule, `${path.join(' ')} in ${file}`).toMatch(/display:\s*inline-flex/);
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/justify-content:\s*center/);
    expect(rule).toMatch(/(^|[;\s])padding:\s*0\s*;/);
  });
});
