/**
 * NXENG-776 / NXENG-792 — document detail side panel views (Properties, Comments, Activity)
 * keyboard focus indicator. The views are `nxs-details-panel` tabs; the library draws the ring in
 * `--nxs-details-panel-muted` and the page pins that token to its light-panel muted colour. Runtime
 * contrast and inset geometry: `apps/nuxeo-ui/.../sub-tab-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIBRARY_SCSS = join(
  import.meta.dirname,
  '../../../../../shared/satori-components/src/lib/details-panel/details-panel.component.scss',
);

describe('DocumentDetailComponent — side panel view focus ring (NXENG-776, NXENG-792)', () => {
  const host = readFileSync(join(import.meta.dirname, 'document-detail.scss'), 'utf8');
  const library = readFileSync(LIBRARY_SCSS, 'utf8');

  it('pins the details panel ring token to the light-panel muted colour', () => {
    const panel = host.match(/\.properties-panel\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(panel).toMatch(
      /--nxs-details-panel-muted:\s*var\(--document-detail-properties-label-muted\)/,
    );
  });

  it('the details panel declares a standalone :focus ring on its views in that token', () => {
    expect(library).toMatch(/\.nxs-details-panel__tab:focus\s*\{/);
    expect(library).not.toMatch(/\.nxs-details-panel__tab:focus,\s/);
    expect(library).toMatch(
      /\.nxs-details-panel__tab:focus\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--nxs-details-panel-muted\)/,
    );
  });
});
