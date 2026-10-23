/**
 * NXENG-858 / NXENG-891 / NXENG-895 — the field labels (Title, Description, …) of the real
 * `nxs-properties-panel` inside `.properties-panel`, under every compiled palette
 * (IBM 1792790291, 2951482449, 2993932592). Karma loads `apps/nuxeo-ui/src/styles.scss`, so
 * `data-app-theme` resolves real token pairs. Host tokens come from `:host` in
 * `document-detail.scss` (no inline overrides on the test host).
 */
import { Component } from '@angular/core';
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
  templateUrl: './prop-label-contrast.host.html',
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
  ],
})
class PropLabelContrastHostComponent {
  readonly views: readonly NxsDetailsPanelTab[] = [{ id: 'properties', label: 'Properties' }];
  readonly heading = 'Sample document.pdf';
  readonly document: NuxeoDocument = {
    uid: 'doc-1',
    path: '/default-domain/workspaces/ws/sample',
    type: 'File',
    title: 'Sample document',
    lastModified: '2026-08-24T10:00:00.000Z',
    properties: {},
  };
}

function parseColor(value: string): { rgb: number[]; alpha: number } {
  const parts = value
    .replace(/rgba?\(|\)|\s/g, '')
    .split(',')
    .map((p) => Number(p));
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function compositeOver(
  fg: { rgb: number[]; alpha: number },
  backdrop: readonly number[],
): number[] {
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + backdrop[i] * (1 - fg.alpha)));
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

function compositeBackgroundLayers(layers: readonly { rgb: number[]; alpha: number }[]): number[] {
  let canvas: number[] = [255, 255, 255];
  for (const layer of layers) {
    if (layer.alpha === 0) {
      continue;
    }
    canvas = compositeOver(layer, canvas);
    if (layer.alpha === 1) {
      break;
    }
  }
  return canvas;
}

/** Composite non-transparent backgrounds from the element up to the first opaque ancestor. */
function paintedBackground(element: HTMLElement): number[] {
  const layers: { rgb: number[]; alpha: number }[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const parsed = parseColor(getComputedStyle(node).backgroundColor);
    if (parsed.alpha === 0) {
      continue;
    }
    layers.unshift(parsed);
    if (parsed.alpha === 1) {
      break;
    }
  }
  return compositeBackgroundLayers(layers);
}

describe('Document detail prop-label contrast by theme (NXENG-858, NXENG-891, NXENG-895)', () => {
  it('compositeBackgroundLayers treats translucent panel backgrounds as painted, not white', () => {
    const mutedLabel = parseColor('rgb(92, 95, 107)');
    const translucentPanel = compositeBackgroundLayers([{ rgb: [0, 0, 0], alpha: 0.5 }]);
    expect(translucentPanel).toEqual([128, 128, 128]);
    const paintedFg = compositeOver(mutedLabel, translucentPanel);
    expect(contrastRatio(paintedFg, translucentPanel)).toBeLessThan(WCAG_AA_NORMAL_TEXT);
  });

  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

    await TestBed.configureTestingModule({
      imports: [PropLabelContrastHostComponent, testTranslateModule()],
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

      const fixture = TestBed.createComponent(PropLabelContrastHostComponent);
      document.body.appendChild(fixture.nativeElement);
      fixture.detectChanges();

      try {
        const host = fixture.nativeElement as HTMLElement;
        expect(
          getComputedStyle(host)
            .getPropertyValue('--document-detail-properties-label-muted')
            .trim(),
        )
          .withContext('label token must come from document-detail.scss :host')
          .toBe('#5c5f6b');
        expect(
          getComputedStyle(host)
            .getPropertyValue('--document-detail-properties-panel-surface')
            .trim(),
        )
          .withContext('panel surface token must come from document-detail.scss :host')
          .toBe('#ffffff');

        const panel = host.querySelector('.properties-panel') as HTMLElement | null;
        const propLabel = host.querySelector(
          '.nxs-properties-panel__field .nxs-properties-panel__label',
        ) as HTMLElement | null;
        expect(panel).withContext('expected .properties-panel').not.toBeNull();
        expect(propLabel).withContext('expected a field label').not.toBeNull();
        if (!panel || !propLabel) return;

        const panelBg = getComputedStyle(panel).backgroundColor;
        expect(panelBg)
          .withContext(`properties-panel background in ${label}`)
          .not.toBe('rgba(0, 0, 0, 0)');

        const backdrop = paintedBackground(panel);
        const painted = compositeOver(parseColor(getComputedStyle(propLabel).color), backdrop);
        const ratio = contrastRatio(painted, backdrop);
        expect(ratio)
          .withContext(
            `prop-label on properties-panel in ${label}: ${getComputedStyle(propLabel).color} vs ${panelBg}`,
          )
          .toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);

        if (theme === 'dark') {
          expect(panelBg)
            .withContext('properties panel stays a fixed light surface in dark theme')
            .toBe('rgb(255, 255, 255)');
          expect(getComputedStyle(propLabel).color)
            .withContext('label must not inherit light-theme variant on the light strip')
            .toBe('rgb(92, 95, 107)');
        }
      } finally {
        fixture.nativeElement.remove();
      }
    });
  }
});
