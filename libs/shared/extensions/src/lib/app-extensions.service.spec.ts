import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import { AppExtensionsService } from './app-extensions.service';
import { EXTENSION_SLOTS } from './extension-slots';

/**
 * NXSAT-755 — the reporting half of the refused-entry diagnostics.
 *
 * Fed through a stubbed `AppConfigService.manifest()`, the way `extension-routes.spec.ts`
 * does, because that is the only route a customer has: nothing a manifest contributes
 * reaches `ExtensionSlotRegistry.register`, so a spec that called `register` directly
 * would be exercising a path the ticket is not about.
 */
describe('AppExtensionsService refused slot entries', () => {
  let manifest: WritableSignal<{ extensionLayers: readonly unknown[] }>;
  // `MockInstance<typeof console.warn>`, not `ReturnType<typeof vi.spyOn>`: the latter
  // resolves to a loosely typed spy whose `mock.calls` is `any[]`, which `spec-types`
  // catches and a green test run does not (NXSAT-746).
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: { manifest } }],
    });
  });

  afterEach(() => warn.mockRestore());

  /** Only our own lines: `AppConfigService` and the layouts library warn with their own prefixes. */
  const reports = () =>
    warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('[agentic-ui-extensions]'));

  /** Instantiate the service and let its constructor effect run. */
  const boot = (): AppExtensionsService => {
    const service = TestBed.inject(AppExtensionsService);
    TestBed.tick();
    return service;
  };

  it('surfaces a refused entry on a signal, alongside missingLayers and invalidRoutes', () => {
    manifest.set({
      extensionLayers: [{ $name: 'acme', slots: { documentView: { id: 'acme.view' } } }],
    });

    expect(boot().refusedSlotEntries()).toEqual([
      {
        slot: 'documentView',
        id: null,
        source: 'acme',
        reason: 'a slot must be a list of entries, not an object, so the whole slot is dropped',
      },
    ]);
  });

  it('reports each refused entry once per load, naming the slot, the reason and the source', () => {
    manifest.set({
      extensionLayers: [
        { $name: 'acme', slots: { documentView: {}, navbar: [{ label: 'no id' }] } },
      ],
    });
    boot();

    expect(reports()).toEqual([
      '[agentic-ui-extensions] slots.documentView in acme: a slot must be a list of entries,' +
        ' not an object, so the whole slot is dropped',
      '[agentic-ui-extensions] slots.navbar in acme: entry 1 has no string "id", so nothing' +
        ' could address it',
    ]);
  });

  it('does not repeat a refusal when the manifest signal changes and it still stands', () => {
    const layer = { $name: 'acme', slots: { navbar: 'not a list' } };
    manifest.set({ extensionLayers: [layer] });
    boot();
    expect(reports()).toHaveLength(1);

    // A second load, or a preset being selected: a new signal value whose refusals are the
    // same ones. The refusals come out of a `computed`, so without the dedup this restates
    // the same typo on every recomputation.
    manifest.set({ extensionLayers: [{ ...layer }] });
    TestBed.tick();

    expect(reports()).toHaveLength(1);
  });

  /**
   * Review round 4. Two contributions may declare the same `$name` — `extension-config.spec.ts`
   * has a case for it — and two identical typos in them produce refusals equal in every field.
   * A dedup keyed on those fields collapsed them into one line, so the console under-reported
   * the number of problems while the signal held both. Suppressing a distinct refusal is the
   * silence this whole ticket is about, which makes it worse than the repetition the dedup
   * exists to prevent.
   */
  it('reports both refusals when two contributions share a $name and a typo', () => {
    const layer = { $name: 'acme', slots: { navbar: 'not a list' } };
    manifest.set({ extensionLayers: [layer, { ...layer }] });
    const service = boot();

    expect(service.refusedSlotEntries()).toHaveLength(2);
    expect(reports()).toHaveLength(2);
  });

  it('reports a refusal that only the second load introduces', () => {
    boot();
    expect(reports()).toEqual([]);

    manifest.set({ extensionLayers: [{ $name: 'acme', slots: { navbar: 'not a list' } }] });
    TestBed.tick();

    expect(reports()).toHaveLength(1);
  });

  /**
   * The control that matters most here, because the same-`id` path is legitimate.
   *
   * A manifest entry reusing a **packaged** id patches it — that is what `resolve`'s
   * `withoutAction` carve-out exists for — a second contribution patching the first is what
   * `$references` layering is, and re-registering an id is `register` being idempotent per id.
   * Reporting any of the three would fire on every correctly layered manifest, so all three
   * must stay silent, and the fix must not be able to pass by warning about everything.
   *
   * **Every same-`id` path is walked before silence is asserted**, which is the whole value of
   * this test. It first asserted `reports()` and only then called `resolve()`, so the one
   * implementation it exists to reject — a warning inside `resolve` — slipped through it
   * unnoticed. Verified by putting that warning in on purpose and watching this go red.
   */
  it('says nothing about a correctly layered manifest that overrides by id', () => {
    const service = TestBed.inject(AppExtensionsService);
    // Packaged first, in two calls, as the product and then a customer library would.
    service.register(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.trash', label: 'Trash', action: 'app.navbar.trash' },
      { id: 'app.navbar.collections', label: 'Collections' },
    ]);
    service.register(EXTENSION_SLOTS.navbar, [{ id: 'app.navbar.trash', label: 'Bin' }]);

    manifest.set({
      extensionLayers: [
        {
          $name: 'acme-customisation',
          slots: { navbar: [{ id: 'app.navbar.trash', label: 'Bin it' }] },
          overrides: { 'app.navbar.collections': { visible: false } },
        },
        { $name: 'regional', slots: { navbar: [{ id: 'app.navbar.trash', label: 'Corbeille' }] } },
      ],
    });
    TestBed.tick();

    // The override the silence is about really did take effect, on the packaged id — and this
    // runs *before* the assertions, so a warning raised anywhere along that path is caught.
    const labels = service
      .resolve<{ id: string; label: string }>(EXTENSION_SLOTS.navbar)
      .map((entry) => entry.label);

    expect(labels).toEqual(['Corbeille']);
    expect(service.refusedSlotEntries()).toEqual([]);
    expect(reports()).toEqual([]);
  });

  /**
   * Why the duplicate message predicts **nothing** about which fields survive.
   *
   * Three review rounds on PR 534 went at this, each catching a wording that stated one outcome
   * as though it were the rule: "the later one wins", then "except `action`, which stays as the
   * first entry set it", then an explanation keyed on the **number of contributions**. All three
   * were overstatements, and the third is the instructive one — the discriminator is not how
   * many contributions or layers there are. It is **whether anything merged that slot's array
   * before the registry saw it**:
   *
   * - nothing did: the pair reaches `resolve`, which patches the first with
   *   `withoutAction(entry)` — later `label`, **first** `action`;
   * - something did: `mergeObjects` merged the array by `id` and already collapsed the pair to
   *   the later row, so there is nothing left to patch — **later** `action`.
   *
   * And either can happen at any contribution count: a second contribution touching only a
   * *different* slot leaves the pair intact, while one contribution's own `$references` can
   * collapse it. All four combinations are asserted below, so the behaviour is pinned by test
   * rather than predicted by prose, and the message is asserted to claim none of it.
   */
  const duplicateNavbar = {
    navbar: [
      { id: 'acme.navbar.x', label: 'First', action: 'acme.actions.first' },
      { id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.second' },
    ],
  };
  const duplicateLayer = { $name: 'acme', slots: duplicateNavbar };
  const resolvedNavbar = (service: AppExtensionsService) =>
    service.resolve<{ id: string; label: string; action: string }>(EXTENSION_SLOTS.navbar);
  const firstAction = [{ id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.first' }];
  const laterAction = [{ id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.second' }];

  it("keeps the first entry's action while nothing has merged that slot's array", () => {
    manifest.set({ extensionLayers: [duplicateLayer] });

    expect(resolvedNavbar(boot())).toEqual(firstAction);
  });

  it("keeps the first entry's action when another contribution sets only a different slot", () => {
    // The case review round 3 named: two contributions, but `slots.navbar` is set by only one, so
    // it is taken whole and the pair is still intact when `resolve` sees it.
    manifest.set({
      extensionLayers: [duplicateLayer, { $name: 'regional', slots: { toolbar: [] } }],
    });

    expect(resolvedNavbar(boot())).toEqual(firstAction);
  });

  it("keeps the later entry's action once another contribution merges the same slot", () => {
    manifest.set({
      extensionLayers: [duplicateLayer, { $name: 'regional', slots: { navbar: [] } }],
    });

    expect(resolvedNavbar(boot())).toEqual(laterAction);
  });

  it("keeps the later entry's action when one contribution's own $references merge that slot", () => {
    // The other case round 3 named: a single contribution is no guarantee either.
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          slots: duplicateNavbar,
          $references: ['brand'],
          $layers: { brand: { slots: { navbar: [] } } },
        },
      ],
    });

    expect(resolvedNavbar(boot())).toEqual(laterAction);
  });

  it('reports the duplicate without predicting which fields survive', () => {
    manifest.set({ extensionLayers: [duplicateLayer] });
    const reason = boot().refusedSlotEntries()[0].reason;

    expect(reason).toContain('repeats the id "acme.navbar.x"');
    expect(reason).toContain('which fields survive depends on the other layers');
    // The two claims the earlier wordings made, neither of which holds in both stacks above.
    expect(reason).not.toContain('the later one wins');
    expect(reason).not.toContain('action');
  });

  it('says nothing when there is no manifest at all', () => {
    const service = boot();

    expect(service.refusedSlotEntries()).toEqual([]);
    expect(service.missingLayers()).toEqual([]);
    expect(reports()).toEqual([]);
  });
});
