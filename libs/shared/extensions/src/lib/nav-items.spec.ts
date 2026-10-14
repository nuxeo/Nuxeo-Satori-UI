import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';

import { AppExtensionsService } from './app-extensions.service';
import { ExtensionRuleContextService } from './extension-rule-context.service';
import { ExtensionRuleRegistry } from './extension-rules';
import { APP_NAV_ITEMS, PACKAGED_NAV_ITEMS } from './nav-items';

/**
 * Administration visibility, which Phase 2 moved from a hardcoded
 * `path === '/administration' && !auth.hasAdministrationAccess()` filter in the
 * shell to `rule: 'app.rules.hasAdministrationAccess'` on the descriptor.
 *
 * Phase 2's evidence ran solely as Administrator, so the negative case — the
 * one that matters — was never exercised anywhere. These specs are that case.
 */
describe('APP_NAV_ITEMS — Administration gating', () => {
  /** The manifest signal `AppExtensionsService` reads; `{}` is the packaged default. */
  const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

  function setUp() {
    manifest.set({ extensionLayers: [] });
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: { manifest } }],
    });
  }

  function navIds(): readonly string[] {
    return TestBed.inject(APP_NAV_ITEMS)().map((item) => item.id);
  }

  /** Packaged ids the registry is expected to render: `disabled` entries never are. */
  function enabledPackagedIds(): readonly string[] {
    return PACKAGED_NAV_ITEMS.filter((item) => !item.disabled).map((item) => item.id);
  }

  beforeEach(setUp);

  it('shows Administration to a user with administration access', () => {
    TestBed.inject(AppExtensionsService).registerRules({
      'app.rules.hasAdministrationAccess': () => true,
    });
    expect(navIds()).toContain('app.navbar.administration');
  });

  it('hides Administration from a user without administration access', () => {
    TestBed.inject(AppExtensionsService).registerRules({
      'app.rules.hasAdministrationAccess': () => false,
    });
    const ids = navIds();
    expect(ids).not.toContain('app.navbar.administration');
    // Nothing else may disappear with it — a filter that removed too much would
    // otherwise pass the assertion above.
    expect(ids).toEqual(enabledPackagedIds().filter((id) => id !== 'app.navbar.administration'));
  });

  it('hides Administration when the gating rule has not been registered at all', () => {
    // The registration-order hazard: the rule is contributed by the shell's
    // APP_INITIALIZER, so a consumer that resolves the navbar earlier sees an
    // unknown id. Fail-open would expose Administration to everyone.
    expect(TestBed.inject(ExtensionRuleRegistry).has('app.rules.hasAdministrationAccess')).toBe(
      false,
    );
    expect(navIds()).not.toContain('app.navbar.administration');
  });

  it('still lets a manifest ungate Administration deliberately, with rule: null', () => {
    // Fail-closed must not become un-overridable, or a customer who genuinely
    // wants the entry visible has no Layer 1 route to it.
    manifest.set({
      extensionLayers: [{ overrides: { 'app.navbar.administration': { rule: null } } }],
    });
    expect(navIds()).toContain('app.navbar.administration');
  });

  it('renders every enabled packaged entry, in order, for an administrator', () => {
    TestBed.inject(AppExtensionsService).registerRules({
      'app.rules.hasAdministrationAccess': () => true,
    });
    TestBed.inject(ExtensionRuleContextService).isAdministrator.set(true);
    expect(navIds()).toEqual(enabledPackagedIds());
  });

  it('renders Browse exactly once, at /browse', () => {
    // Two entries reading "Browse" — one disabled, one on the adf-hx route — was the shape
    // until the adf-hx route was retired. Matched by label and by path, so an entry that
    // reads "Browse" anywhere else, or reaches any `/browse-*` route, also fails this.
    const browse = TestBed.inject(APP_NAV_ITEMS)().filter(
      (item) => item.label === 'Browse' || item.path.startsWith('/browse'),
    );
    expect(browse.map((item) => [item.id, item.path, item.labelKey])).toEqual([
      ['app.navbar.browse', '/browse', 'nav.item.browse'],
    ]);
  });

  it('registers no entry for the retired adf-hx route', () => {
    const ids = PACKAGED_NAV_ITEMS.map((item) => item.id);
    expect(ids).not.toContain('app.navbar.browseAdfHx');
    expect(PACKAGED_NAV_ITEMS.filter((item) => item.path.startsWith('/browse-'))).toEqual([]);
    expect(PACKAGED_NAV_ITEMS.find((item) => item.id === 'app.navbar.browse')?.disabled).toBe(
      undefined,
    );
  });

  it('ignores an override still written against the retired app.navbar.browseAdfHx', () => {
    // `docs/extension-reference.md` used this exact override as its worked example, so
    // manifests carrying it exist. It must address nothing — least of all Browse.
    manifest.set({
      extensionLayers: [{ overrides: { 'app.navbar.browseAdfHx': { visible: false } } }],
    });
    expect(navIds()).toEqual(
      enabledPackagedIds().filter((id) => id !== 'app.navbar.administration'),
    );
    expect(navIds()).toContain('app.navbar.browse');
  });
});
