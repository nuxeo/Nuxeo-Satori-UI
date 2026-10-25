import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
// testTranslateModule() removed - no longer exported in ngx-translate 18

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

/**
 * NXENG-780 — IBM issue 548995131 flags the **Knowledge Discovery** sidebar link on
 * `/#/dashboard`, `/#/doc/:uid`, and `/#/browse`. The underlying token override landed in
 * NXENG-761 (`html { --sat-platform-nav-outline: … }` in `styles.scss`); this spec pins the
 * reported surface so a palette or Satori change cannot regress it silently.
 *
 * The layout mirrors the dashboard route: Dashboard is the current item and sits directly
 * under Knowledge Discovery, which is the adjacency that produced sub-3:1 contrast before the
 * override.
 */

const KD_LINK =
  'sat-platform-nav-list-item[data-nav-id="app.navbar.knowledgeDiscovery"] .sat-platform-nav-item';
const DASHBOARD_LINK =
  'sat-platform-nav-list-item[data-nav-id="app.navbar.dashboard"] .sat-platform-nav-item';

const ACTIVE_CLASS = 'sat-platform-nav-item-active';
const MINIMUM_RATIO = 3;

const SHIPPED_THEMES: readonly (string | null)[] = [null, ...COMPILED_THEME_BASES];

const KD_TEST_LABELS = {
  'shell.test.knowledge-discovery-nav-item': 'Knowledge Discovery',
  'shell.test.dashboard-nav-item': 'Dashboard',
} as const;

@Component({
  standalone: true,
  imports: [SatPlatformNavModule, testTranslateModule()],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './nav-focus-ring-knowledge-discovery.host.html',
})
class KdNavHostComponent {}

function luminance([r, g, b]: readonly number[]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseColor(value: string): { rgb: number[]; alpha: number } {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) throw new Error(`not a computed colour: "${value}"`);
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

function flatten(value: string, backdrop: readonly number[]): number[] {
  return compositeOver(parseColor(value), backdrop);
}

function paintedBackdrop(element: Element): number[] {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
      return parseColor(background).rgb;
    }
  }
  throw new Error('no painted ancestor found; the nav panel did not render');
}

describe('Knowledge Discovery sidebar nav focus ring (NXENG-780)', () => {
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KdNavHostComponent, testTranslateModule({ ...KD_TEST_LABELS })],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
  });

  afterEach(() => {
    if (originalTheme === null) document.documentElement.removeAttribute('data-app-theme');
    else document.documentElement.setAttribute('data-app-theme', originalTheme);
  });

  function applyTheme(theme: string | null): void {
    if (theme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', theme);
    }
  }

  function measureKnowledgeDiscovery(theme: string | null) {
    applyTheme(theme);

    const fixture = TestBed.createComponent(KdNavHostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);

    try {
      const kd = fixture.nativeElement.querySelector(KD_LINK) as HTMLElement | null;
      const dashboard = fixture.nativeElement.querySelector(DASHBOARD_LINK) as HTMLElement | null;
      if (!kd || !dashboard) {
        throw new Error('Satori did not render the Knowledge Discovery / Dashboard nav items');
      }
      if (!dashboard.classList.contains(ACTIVE_CLASS)) {
        throw new Error('Dashboard must render as the current route item for this ticket scenario');
      }
      expect(kd.classList.contains(ACTIVE_CLASS))
        .withContext('Knowledge Discovery must stay inactive on the dashboard route')
        .toBe(false);

      kd.focus({ focusVisible: true } as FocusOptions);
      expect(kd.matches(':focus-visible'))
        .withContext('keyboard focus must be visible before contrast is measured')
        .toBe(true);

      const styles = getComputedStyle(kd);
      expect(styles.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThan(0);

      const panel = paintedBackdrop(kd);
      const ownFill = parseColor(styles.backgroundColor);
      const interior = ownFill.alpha > 0 ? compositeOver(ownFill, panel) : panel;
      const neighbourFill = parseColor(getComputedStyle(dashboard).backgroundColor);
      const neighbour = compositeOver(neighbourFill, panel);
      const ringOpaque = flatten(styles.outlineColor, interior);

      return {
        outlineStyle: styles.outlineStyle,
        outlineWidth: Number.parseFloat(styles.outlineWidth),
        ringColor: styles.outlineColor,
        ratioVsInterior: contrastRatio(ringOpaque, interior),
        ratioVsPanel: contrastRatio(ringOpaque, panel),
        ratioVsNeighbour: contrastRatio(ringOpaque, neighbour),
      };
    } finally {
      fixture.nativeElement.remove();
    }
  }

  it('draws a visible keyboard focus indicator on the Knowledge Discovery link', () => {
    const measured = measureKnowledgeDiscovery('nuxeo');
    expect(measured.outlineStyle).not.toBe('none');
    expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
  });

  for (const theme of SHIPPED_THEMES) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`clears ${MINIMUM_RATIO}:1 on the reported link with Dashboard active — ${label}`, () => {
      const measured = measureKnowledgeDiscovery(theme);
      expect(measured.ratioVsInterior)
        .withContext(`ring on KD item interior (${label})`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
      expect(measured.ratioVsPanel)
        .withContext(`ring on nav panel (${label})`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
      expect(measured.ratioVsNeighbour)
        .withContext(`ring against active Dashboard neighbour (${label})`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
    });
  }
});
