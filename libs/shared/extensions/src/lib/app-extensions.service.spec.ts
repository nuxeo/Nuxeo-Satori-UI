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
   * The duplicate message's claim, checked against what `resolve` actually does.
   *
   * It read "the later one wins" until review of PR 534: `resolve` patches with
   * `withoutAction(entry)`, so the later entry's `action` is dropped and the **first** entry's
   * survives. Asserting the message and the resolved entry in one test is what stops the two
   * drifting apart again — a diagnostic that overstates what happened is the defect this
   * ticket exists to remove, not a smaller version of it.
   */
  it('describes the duplicate merge exactly as resolve performs it, action included', () => {
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          slots: {
            navbar: [
              { id: 'acme.navbar.x', label: 'First', action: 'acme.actions.first' },
              { id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.second' },
            ],
          },
        },
      ],
    });
    const service = boot();
    const resolved = service.resolve<{ id: string; label: string; action: string }>(
      EXTENSION_SLOTS.navbar,
    );

    expect(resolved).toEqual([
      { id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.first' },
    ]);
    expect(service.refusedSlotEntries()[0].reason).toContain(
      'the later entry\'s fields win, except "action", which stays as the first entry set it',
    );
  });

  it('says nothing when there is no manifest at all', () => {
    const service = boot();

    expect(service.refusedSlotEntries()).toEqual([]);
    expect(service.missingLayers()).toEqual([]);
    expect(reports()).toEqual([]);
  });
});
