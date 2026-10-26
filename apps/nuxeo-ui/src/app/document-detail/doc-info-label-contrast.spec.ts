/**
 * NXENG-774 / NXENG-782 / NXENG-804 / NXENG-813 / NXENG-829 / NXENG-852 / NXENG-911 / NXENG-924 (IBM 280073873, IBM 1224611475,
 * IBM 542201046, IBM 787384272, IBM 1741130194, IBM 3376112021, IBM 3883422420) — the info-row labels
 * (State, Version, …) of the real `nxs-properties-panel` inside `.properties-panel`, under every compiled
 * palette. Karma loads `apps/nuxeo-ui/src/styles.scss`, so `data-app-theme` resolves real token
 * pairs. Host tokens come from `:host` in `document-detail.scss` (no inline overrides on the test host).
 */
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  NxsDetailsPanelComponent,
  NxsPropertiesPanelComponent,
  type NxsDetailsPanelTab,
} from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

const WCAG_AA_NORMAL_TEXT = 4.5;

@Component({
  standalone: true,
  imports: [NxsDetailsPanelComponent, NxsPropertiesPanelComponent],
  templateUrl: './doc-info-label-contrast.host.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
  ],
})
class DocInfoLabelContrastHostComponent {
  readonly views: readonly NxsDetailsPanelTab[] = [{ id: 'properties', label: 'Properties' }];
  readonly heading = 'Sample document.pdf';
  readonly document: NuxeoDocument = {
    uid: 'doc-1',
    path: '/default-domain/workspaces/ws/sample',
    type: 'File',
    title: 'Sample document',
    lastModified: '2026-08-24T10:00:00.000Z',
    state: 'project',
    properties: {},
  };
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

describe('Document detail doc-info-label contrast by theme (NXENG-774 / NXENG-782 / NXENG-804 / NXENG-813 / NXENG-829 / NXENG-852 / NXENG-911 / NXENG-924)', () => {
  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

    await TestBed.configureTestingModule({
      imports: [DocInfoLabelContrastHostComponent, testTranslateModule()],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  afterEach(() => {
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_AA_NORMAL_TEXT}:1 on properties-panel — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }

      const fixture = TestBed.createComponent(DocInfoLabelContrastHostComponent);
      document.body.appendChild(fixture.nativeElement);
      fixture.detectChanges();

      try {
        const panel = fixture.nativeElement.querySelector(
          '.properties-panel',
        ) as HTMLElement | null;
        const docLabel = fixture.nativeElement.querySelector(
          '.nxs-properties-panel__row .nxs-properties-panel__label',
        ) as HTMLElement | null;
        expect(panel).withContext('expected .properties-panel').not.toBeNull();
        expect(docLabel).withContext('expected an info-row label').not.toBeNull();
        if (!panel || !docLabel) return;

        const panelBg = getComputedStyle(panel).backgroundColor;
        expect(panelBg)
          .withContext(`properties-panel background in ${label}`)
          .not.toBe('rgba(0, 0, 0, 0)');

        const fg = parseRgb(getComputedStyle(docLabel).color);
        expect(fg)
          .withContext(`doc-info-label colour ${getComputedStyle(docLabel).color}`)
          .not.toBeNull();
        if (!fg) return;

        const bg = opaqueBackground(panel);
        const ratio = contrastRatio(fg, bg);
        expect(ratio)
          .withContext(
            `doc-info-label on properties-panel in ${label}: ${getComputedStyle(docLabel).color} vs ${panelBg}`,
          )
          .toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);

        if (theme === 'dark') {
          expect(panelBg)
            .withContext('properties panel stays a fixed light surface in dark theme')
            .toBe('rgb(255, 255, 255)');
          expect(getComputedStyle(docLabel).color)
            .withContext('label must not inherit light-theme variant on the light strip')
            .toBe('rgb(92, 95, 107)');
        }
      } finally {
        fixture.nativeElement.remove();
      }
    });
  }
});
