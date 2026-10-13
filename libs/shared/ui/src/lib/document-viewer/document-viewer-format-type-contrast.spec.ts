/**
 * NXENG-801 / NXSAT-494 — `.format-type` and `.format-size` on the fixed light `.picture-cards`
 * strip use scoped host tokens so contrast stays ≥4.5:1 even when theme surface-variant drifts
 * (e.g. dark palette). IBM 1406866183 (NXENG-837) targets `.format-size`.
 * Per-theme Karma coverage (including `.format-size` host-token sentinel wiring for NXSAT-494):
 * `apps/nuxeo-ui/.../document-viewer-format-type-contrast.spec.ts`.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DocumentViewerComponent } from './document-viewer.component';

const WCAG_AA_NORMAL_TEXT = 4.5;

function scssBlock(source: string, className: string): string {
  const match = source.match(new RegExp(`\\.${className}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

function relativeLuminance([r, g, b]: readonly number[]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(value: string): { rgb: number[]; alpha: number } {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) {
    throw new Error(`not a computed colour: "${value}"`);
  }
  const parts = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function compositeOver(
  fg: { rgb: number[]; alpha: number },
  backdrop: readonly number[],
): number[] {
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + backdrop[i] * (1 - fg.alpha)));
}

function opaqueBackdrop(element: HTMLElement): number[] {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const { rgb, alpha } = parseColor(getComputedStyle(node).backgroundColor);
    if (alpha === 1) {
      return rgb;
    }
  }
  return [255, 255, 255];
}

describe('DocumentViewerComponent — format-type text contrast (NXENG-801 / NXSAT-494)', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentViewerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    originalTheme = document.documentElement.getAttribute('data-app-theme');
    fixture = TestBed.createComponent(DocumentViewerComponent);
    fixture.componentRef.setInput('mimeType', 'image/jpeg');
    fixture.componentRef.setInput('blobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('rawBlobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('pictureInfo', {
      width: 1920,
      height: 1080,
      format: 'JPEG',
      colorSpace: 'sRGB',
      depth: 8,
      weight: '8 KB',
    });
    fixture.componentRef.setInput('pictureViews', [
      {
        title: 'FullHD',
        width: 1920,
        height: 1080,
        fileSize: '8792 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/fullhd',
      },
    ]);
    fixture.detectChanges();
  });

  afterEach(() => {
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  it('pins picture-cards to the light-strip surface and pairs strip text with host tokens', () => {
    const scssPath = join(import.meta.dirname, 'document-viewer.component.scss');
    const scss = readFileSync(scssPath, 'utf8');
    const hostBlock = scss.match(/:host\s*\{[^}]+\}/s)?.[0] ?? '';
    const cards = scssBlock(scss, 'picture-cards');
    const label = scssBlock(scss, 'format-type');
    const size = scssBlock(scss, 'format-size');
    const title = scssBlock(scss, 'picture-card-title');
    const infoValue = scssBlock(scss, 'info-value');
    expect(hostBlock).toContain('--document-viewer-light-strip-surface');
    expect(hostBlock).toContain('--document-viewer-muted-on-light-surface');
    expect(cards).toMatch(/var\(--document-viewer-light-strip-surface/);
    expect(cards).not.toMatch(/var\(--mat-sys-surface/);
    expect(label).toMatch(/var\(--document-viewer-muted-on-light-surface/);
    expect(size).toMatch(/var\(--document-viewer-muted-on-light-surface/);
    expect(title).toMatch(/var\(--document-viewer-on-light-strip/);
    expect(infoValue).toMatch(/var\(--document-viewer-on-light-strip/);
    expect(label).not.toMatch(/#999/i);
    expect(scss).toMatch(
      /\.format-download-btn[\s\S]*mat-icon[\s\S]*var\(--document-viewer-muted-on-light-surface/,
    );
  });

  it(`meets ${WCAG_AA_NORMAL_TEXT}:1 on the picture-cards strip (including dark theme)`, () => {
    for (const theme of ['dark', null] as const) {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const strip = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement;
      const label = fixture.nativeElement.querySelector('.format-type') as HTMLElement;
      expect(strip).not.toBeNull();
      expect(label).not.toBeNull();
      if (!strip || !label) return;

      const labelStyle = getComputedStyle(label);
      const backdrop = opaqueBackdrop(strip);
      const painted = compositeOver(parseColor(labelStyle.color), backdrop);
      const ratio = contrastRatio(painted, backdrop);
      expect(
        ratio,
        `format-type ${labelStyle.color} on picture-cards backdrop rgb(${backdrop.join(',')}) (${theme ?? 'default'})`,
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });
});
