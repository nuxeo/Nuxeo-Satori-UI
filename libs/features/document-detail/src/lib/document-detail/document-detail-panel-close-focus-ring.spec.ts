/**
 * NXENG-830 — document detail side panel close button keyboard focus indicator. The close button
 * is `nxs-details-panel`'s; the library draws its ring in `--nxs-details-panel-muted` and the page
 * pins that token to its light-panel muted colour. Runtime contrast and inset geometry:
 * `apps/nuxeo-ui/.../panel-close-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIBRARY_SCSS = join(
  import.meta.dirname,
  '../../../../../shared/satori-components/src/lib/details-panel/details-panel.component.scss',
);

describe('DocumentDetailComponent — panel close focus ring (NXENG-830)', () => {
  it('wires the details panel close control to closePropertiesPanel, with its name', () => {
    const html = readFileSync(join(import.meta.dirname, 'document-detail.html'), 'utf8');
    const tag = html.match(/<nxs-details-panel\b[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('class="properties-panel"');
    expect(tag).toContain('(closed)="closePropertiesPanel()"');
    expect(tag).toContain(
      '[closeLabel]="\'document-detail.document-detail.close-panel\' | translate"',
    );
  });

  it('pins the details panel ring token to the light-panel muted colour', () => {
    const host = readFileSync(join(import.meta.dirname, 'document-detail.scss'), 'utf8');
    const panel = host.match(/\.properties-panel\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(panel).toMatch(
      /--nxs-details-panel-muted:\s*var\(--document-detail-properties-label-muted\)/,
    );
  });

  it('the details panel declares a standalone :focus ring on its close control', () => {
    const library = readFileSync(LIBRARY_SCSS, 'utf8');
    expect(library).toMatch(/\.nxs-details-panel__close:focus\s*\{/);
    expect(library).not.toMatch(/\.nxs-details-panel__close:focus,\s/);
    expect(library).toMatch(
      /\.nxs-details-panel__close:focus\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--nxs-details-panel-muted\)/,
    );
  });
});
