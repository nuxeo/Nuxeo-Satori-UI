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
   * The duplicate-`id` outcome, which NXSAT-760 made statable.
   *
   * Four review rounds on PR 534 went at describing this, each wording falsified by a case nobody
   * had tested — "the later one wins"; "except `action`, which stays as the first entry set it";
   * a rule keyed on the number of contributions; a rule keyed on whether any merge of the slot's
   * array ran. The outcome was five-way and had to be documented as **unspecified**.
   *
   * The cause was `withoutAction` firing on manifest-owned patches as well as packaged ones, so
   * which row's `action` survived depended on whether that line happened to run. Narrowed to
   * packaged ids, every stack below gives the **same** answer, and the contract is one sentence
   * plus one carve-out: *the later entry's fields win; on a packaged `id` the packaged `action`
   * is kept.*
   *
   * The four stacks are kept — not because the answer differs between them any more, but because
   * that invariance is the claim. They were five separate behaviours; a regression would make
   * them so again.
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
  /** The later row, whole — `label` and `action` both. */
  const laterRow = [{ id: 'acme.navbar.x', label: 'Second', action: 'acme.actions.second' }];

  it("gives the later row when nothing has merged that slot's array", () => {
    manifest.set({ extensionLayers: [duplicateLayer] });

    expect(resolvedNavbar(boot())).toEqual(laterRow);
  });

  it('gives the later row when another contribution sets only a different slot', () => {
    // Round 3's case: two contributions, but `slots.navbar` is set by only one, so it is taken
    // whole and the pair is still intact when `resolve` sees it. Used to give the first action.
    manifest.set({
      extensionLayers: [duplicateLayer, { $name: 'regional', slots: { toolbar: [] } }],
    });

    expect(resolvedNavbar(boot())).toEqual(laterRow);
  });

  it('gives the later row once another contribution merges the same slot', () => {
    manifest.set({
      extensionLayers: [duplicateLayer, { $name: 'regional', slots: { navbar: [] } }],
    });

    expect(resolvedNavbar(boot())).toEqual(laterRow);
  });

  it("gives the later row when one contribution's own $references merge that slot", () => {
    // Round 3's other case: a single contribution is no guarantee of either outcome.
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

    expect(resolvedNavbar(boot())).toEqual(laterRow);
  });

  it('gives the later row when the empty layer comes first', () => {
    // Round 4's first qualification, and why "a merge ran" was the wrong thing to describe: the
    // merge runs either way, but reversing the order leaves both rows intact, because the pair is
    // then the *later* layer's new entries rather than a patch over an existing row. Used to give
    // the first action; now indistinguishable from the others, which is the point.
    manifest.set({
      extensionLayers: [{ $name: 'regional', slots: { navbar: [] } }, duplicateLayer],
    });

    expect(resolvedNavbar(boot())).toEqual(laterRow);
  });

  /**
   * **This is a security control, not a behavioural detail.** It is the confused-deputy case
   * `docs/extension-reference.md` §1 promises against: a manifest keeping our label and icon
   * while pointing the click at something else, which the server authorises because it really is
   * that user asking. Hiding an action is the customer's call; rebinding one is not.
   *
   * It is asserted with a **duplicate pair** on the packaged id on purpose — one entry would pass
   * on the narrower claim that a single patch is refused, and the pair also covers the path
   * NXSAT-760 changed, where the second patch lands on a row the first already touched.
   *
   * Verified able to fail: inverting `isPackaged` in `resolve` turns this red.
   */
  it('refuses to let a manifest rebind the action of a packaged id', () => {
    const service = TestBed.inject(AppExtensionsService);
    service.register(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.trash', label: 'Trash', action: 'app.actions.packaged' },
    ]);
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          slots: {
            navbar: [
              { id: 'app.navbar.trash', label: 'First', action: 'acme.actions.first' },
              { id: 'app.navbar.trash', label: 'Second', action: 'acme.actions.second' },
            ],
          },
        },
      ],
    });
    TestBed.tick();

    // Label relabelled — that is Layer 1 working. Action untouched — that is the control.
    expect(resolvedNavbar(service)).toEqual([
      { id: 'app.navbar.trash', label: 'Second', action: 'app.actions.packaged' },
    ]);
  });

  /**
   * The boundary itself, which is the one thing NXSAT-760 could have got wrong.
   *
   * `resolve` tells a packaged row from a manifest-owned one by `index < packaged.length`. A call
   * carrying **both** kinds of patch is what makes that a row-by-row decision rather than a
   * per-call one, so it is the case that would catch an off-by-one or a condition applied to the
   * whole batch.
   */
  it('protects the packaged row and not the manifest-owned one in the same resolve call', () => {
    const service = TestBed.inject(AppExtensionsService);
    service.register(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.trash', label: 'Trash', action: 'app.actions.packaged' },
      { id: 'app.navbar.collections', label: 'Collections', action: 'app.actions.collections' },
    ]);
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          slots: {
            navbar: [
              // A patch onto ours, and a pair of the customer's own, interleaved.
              { id: 'acme.navbar.x', label: 'Theirs', action: 'acme.actions.first' },
              { id: 'app.navbar.trash', label: 'Relabelled', action: 'acme.actions.hijack' },
              { id: 'acme.navbar.x', label: 'Theirs again', action: 'acme.actions.second' },
            ],
          },
        },
      ],
    });
    TestBed.tick();

    expect(resolvedNavbar(service)).toEqual([
      // Ours: relabelled, action held.
      { id: 'app.navbar.trash', label: 'Relabelled', action: 'app.actions.packaged' },
      { id: 'app.navbar.collections', label: 'Collections', action: 'app.actions.collections' },
      // Theirs: the later row, whole.
      { id: 'acme.navbar.x', label: 'Theirs again', action: 'acme.actions.second' },
    ]);
  });

  /**
   * What the narrowing does **not** change, and the reason it grants nothing new: a manifest can
   * bind any action to an id it owns in a **single** entry, and §1 instructs customers to do
   * exactly that. Withholding it from the second of two of their own rows protected nothing.
   */
  it('lets a manifest bind any action to an id it owns, as it always could', () => {
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          slots: {
            navbar: [{ id: 'acme.navbar.y', label: 'Archive', action: 'app.toolbar.delete' }],
          },
        },
      ],
    });

    expect(resolvedNavbar(boot())).toEqual([
      { id: 'acme.navbar.y', label: 'Archive', action: 'app.toolbar.delete' },
    ]);
  });

  /**
   * The message's claim, asserted against the entry `resolve` actually returns — in one test, so
   * the two cannot drift apart. That coupling is the lesson of PR 534, where the message and the
   * behaviour lived in different files and disagreed four times running.
   */
  it('reports the duplicate and says which row wins, matching what resolve returns', () => {
    manifest.set({ extensionLayers: [duplicateLayer] });
    const service = boot();
    const reason = service.refusedSlotEntries()[0].reason;

    expect(reason).toContain('repeats the id "acme.navbar.x"');
    expect(reason).toContain('the later entry wins');
    expect(resolvedNavbar(service)).toEqual(laterRow);
  });

  it('says nothing when there is no manifest at all', () => {
    const service = boot();

    expect(service.refusedSlotEntries()).toEqual([]);
    expect(service.missingLayers()).toEqual([]);
    expect(reports()).toEqual([]);
  });
});
