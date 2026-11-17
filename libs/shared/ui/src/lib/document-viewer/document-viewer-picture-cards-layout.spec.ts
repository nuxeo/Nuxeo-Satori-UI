/**
 * NXSAT-803 — layout contract for the picture/video metadata cards: with the Properties side panel
 * open the viewer is narrow, and the cards used to overlap each other and squeeze the preview to a
 * ~100px strip. jsdom does no layout, so this pins the rules that prevent it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scss = readFileSync(join(import.meta.dirname, 'document-viewer.component.scss'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/** The declaration block whose selector is exactly `selector`. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\~:]/g, '\\$&');
  const match = scss.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match, `${selector} block`).not.toBeNull();
  return match![1];
}

describe('DocumentViewerComponent — picture cards layout (NXSAT-803)', () => {
  it('lets the cards shrink and scroll instead of taking all the height', () => {
    const cards = block('.picture-cards');
    expect(cards).not.toMatch(/flex-shrink:\s*0/);
    expect(cards).toMatch(/flex:\s*0 1 auto/);
    expect(cards).toMatch(/overflow-y:\s*auto/);
  });

  it('keeps a usable preview while the cards are shown, scaling down in short windows', () => {
    expect(block('.viewer-content:has(~ .picture-cards)')).toMatch(
      /min-height:\s*min\(240px,\s*35vh\)/,
    );
    expect(block('.picture-cards')).toMatch(/min-height:\s*min\(96px,\s*20vh\)/);
  });

  it('draws a focus ring on the scrollable strip, on :focus as well as :focus-visible', () => {
    expect(block('.picture-cards:focus')).toMatch(/outline:\s*2px solid/);
    expect(block('.picture-cards:focus-visible')).toMatch(/outline:\s*2px solid/);
  });

  it('wraps to fewer, wider columns instead of squeezing a card below its widest row', () => {
    expect(block('.picture-cards')).toMatch(/minmax\(min\(100%,\s*380px\),\s*1fr\)/);
    expect(block('.picture-card')).toMatch(/min-width:\s*0/);
  });

  it('does not let a label overrun its value, or a format row overrun its card', () => {
    expect(block('.info-label')).toMatch(/flex-shrink:\s*0/);
    expect(block('.info-value')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block('.format-row')).toMatch(/flex-wrap:\s*wrap/);
    expect(block('.format-details')).toMatch(/flex-wrap:\s*wrap/);
    expect(block('.format-details')).not.toMatch(/white-space:\s*nowrap/);
  });

  it('makes every scrollable strip a labelled, keyboard-focusable region', () => {
    const html = readFileSync(join(import.meta.dirname, 'document-viewer.component.html'), 'utf8');
    const strips = [...html.matchAll(/<div\s[^>]*class="picture-cards"[^>]*>/gs)].map((m) => m[0]);
    expect(strips).toHaveLength(2);
    for (const strip of strips) {
      expect(strip).toMatch(/tabindex="0"/);
      expect(strip).toMatch(/role="region"/);
      expect(strip).toMatch(
        /\[attr\.aria-label\]="'shared-ui\.document-viewer\.(picture|video)-metadata-region'/,
      );
    }
  });
});
