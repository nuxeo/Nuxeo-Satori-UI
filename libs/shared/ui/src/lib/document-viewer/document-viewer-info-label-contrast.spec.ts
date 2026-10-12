/**
 * NXENG-812 / NXSAT-493 — `.info-label` on the fixed light `.picture-cards` strip must meet WCAG 2.1 SC 1.4.3
 * (IBM 716638997, IBM 1390196018). Per-theme Karma coverage:
 * `apps/nuxeo-ui/.../document-viewer-info-label-contrast.spec.ts`.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentViewerComponent } from './document-viewer.component';

const WCAG_AA_NORMAL_TEXT = 4.5;

function scssBlock(source: string, className: string): string {
  const match = source.match(new RegExp(`\\.${className}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]: readonly number[]): number {
  const s = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

function contrastRatio(fg: readonly number[], bg: readonly number[]): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function opaqueBackground(element: HTMLElement): [number, number, number] {
  const own = parseRgb(getComputedStyle(element).backgroundColor);
  if (own && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)') {
    return own;
  }
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const bg = parseRgb(getComputedStyle(node).backgroundColor);
    if (bg && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return bg;
    }
  }
  return [255, 255, 255];
}

describe('DocumentViewerComponent — info-label text contrast (NXENG-812 / NXSAT-493)', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;

  beforeEach(async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [DocumentViewerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentViewerComponent);
  });

  it('pins .info-label to the light-strip muted token per NXENG-812 / NXSAT-493', () => {
    const scssPath = join(import.meta.dirname, 'document-viewer.component.scss');
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/NXSAT-493/);
    expect(scss).toMatch(/1390196018/);
    const label = scssBlock(scss, 'info-label');
    expect(label).toMatch(/var\(--document-viewer-muted-on-light-surface\)/);
    expect(label).not.toMatch(/color:\s*#777/i);
    expect(label).not.toMatch(/var\(--mat-sys-on-surface-variant/i);
  });

  it(`meets ${WCAG_AA_NORMAL_TEXT}:1 on the picture strip fallback (NXSAT-493)`, () => {
    const raw = 'blob:http://localhost/sample';
    const trusted = (): SafeResourceUrl =>
      TestBed.inject(DomSanitizer).bypassSecurityTrustResourceUrl(raw);

    fixture.componentRef.setInput('mimeType', 'image/jpeg');
    fixture.componentRef.setInput('blobUrl', trusted());
    fixture.componentRef.setInput('rawBlobUrl', raw);
    fixture.componentRef.setInput('pictureInfo', {
      width: 1920,
      height: 1080,
      format: 'JPEG',
      colorSpace: 'sRGB',
      depth: 8,
      weight: '8 KB',
    });
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();

    const infoLabel = fixture.nativeElement.querySelector('.info-label') as HTMLElement | null;
    const strip = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
    expect(infoLabel).not.toBeNull();
    expect(strip).not.toBeNull();
    if (!infoLabel || !strip) return;

    const fg = parseRgb(getComputedStyle(infoLabel).color);
    expect(fg).not.toBeNull();
    if (!fg) return;

    const bg = opaqueBackground(strip);
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});
