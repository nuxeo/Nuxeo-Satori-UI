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
   * **Four** review rounds on PR 534 went at this, each catching a wording that stated some
   * outcome as though it were the rule: "the later one wins"; then "except `action`, which stays
   * as the first entry set it"; then an explanation keyed on the number of contributions; then
   * one keyed on whether any merge of that slot's array ran. Every formulation was a proxy for
   * the thing it was trying to name, and each was falsified by a case nobody had tested.
   *
   * The conclusion is not a fifth formulation. It is that **this is not describable in a
   * sentence a customer could use**, and the message must therefore say only what is certain —
   * one of the two rows is gone — and what to do: give each entry its own `id`.
   *
   * What the cases below are for is the opposite job: pinning the behaviour so a future change
   * to it is visible, without any prose claiming a rule. Six of them, including the two the
   * fourth round pointed out — merge order matters, and a packaged `id` keeps its own `action`
   * whatever the manifest does.
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

  it("keeps the first entry's action when the empty layer comes first, merge or no merge", () => {
    // Round 4's first qualification, and why "a merge ran" was the wrong thing to describe: the
    // merge runs either way, but reversing the order leaves both rows intact, because the pair is
    // then the *later* layer's new entries rather than a patch over an existing row.
    manifest.set({
      extensionLayers: [{ $name: 'regional', slots: { navbar: [] } }, duplicateLayer],
    });

    expect(resolvedNavbar(boot())).toEqual(firstAction);
  });

  it("keeps a packaged id's own action whichever duplicate the manifest writes last", () => {
    // Round 4's second qualification. `withoutAction` is withholding `action` from a patch onto a
    // registered descriptor, which is the confused-deputy control working exactly as intended —
    // so for a packaged id neither duplicate's action reaches the resolved entry.
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

    expect(resolvedNavbar(service)).toEqual([
      { id: 'app.navbar.trash', label: 'Second', action: 'app.actions.packaged' },
    ]);
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

/**
 * NXSAT-759 — the reporting half of the refused-**override** diagnostics.
 *
 * A fourth signal rather than a widened `refusedSlotEntries()`: an override is keyed by
 * descriptor id and belongs to no slot, so it has no `slot` to put in a
 * `RefusedExtensionEntry`. `readOverrides` in `extension-config.ts` argues it in full.
 *
 * Same harness as the block above, and deliberately the same assertions, because the claim is
 * that the two channels behave alike — a signal, and one console line per refusal per load.
 */
describe('AppExtensionsService refused overrides', () => {
  let manifest: WritableSignal<{ extensionLayers: readonly unknown[] }>;
  // `MockInstance<typeof console.warn>`, not `ReturnType<typeof vi.spyOn>`, for the reason the
  // block above gives: the latter's `mock.calls` is `any[]`, which `spec-types` catches and a
  // green test run does not (NXSAT-746).
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: { manifest } }],
    });
  });

  afterEach(() => warn.mockRestore());

  const reports = () =>
    warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('[agentic-ui-extensions]'));

  const boot = (): AppExtensionsService => {
    const service = TestBed.inject(AppExtensionsService);
    TestBed.tick();
    return service;
  };

  it('surfaces a refused override on its own signal, naming the id, reason and source', () => {
    manifest.set({
      extensionLayers: [{ $name: 'acme', overrides: { 'app.navbar.trash': true } }],
    });

    const service = boot();

    expect(service.refusedOverrides()).toEqual([
      {
        id: 'app.navbar.trash',
        source: 'acme',
        reason: 'an override must be an object, not a boolean, so it is dropped',
      },
    ]);
    // It did not arrive on the slot channel, which has no honest `slot` to give it.
    expect(service.refusedSlotEntries()).toEqual([]);
  });

  it('reports each refused override once per load, prefixed and keyed by overrides.<id>', () => {
    manifest.set({
      extensionLayers: [
        {
          $name: 'acme',
          overrides: { 'app.navbar.trash': true, 'app.navbar.tasks': 'hidden' },
        },
      ],
    });
    boot();

    expect(reports()).toEqual([
      '[agentic-ui-extensions] overrides.app.navbar.trash in acme: an override must be an' +
        ' object, not a boolean, so it is dropped',
      '[agentic-ui-extensions] overrides.app.navbar.tasks in acme: an override must be an' +
        ' object, not a string, so it is dropped',
    ]);
  });

  it('does not repeat an override refusal when the manifest recomputes and it still stands', () => {
    const layer = { $name: 'acme', overrides: { 'app.navbar.trash': true } };
    manifest.set({ extensionLayers: [layer] });
    boot();
    expect(reports()).toHaveLength(1);

    manifest.set({ extensionLayers: [{ ...layer }] });
    TestBed.tick();

    expect(reports()).toHaveLength(1);
  });

  it('reports both when two contributions share a $name and the same bad override', () => {
    // The case review round 4 of PR 534 found on the slot channel: two contributions may declare
    // the same `$name`, so two identical mistakes produce refusals equal in every field. The
    // dedup is keyed on the whole list for that reason, and this pins it on this channel too.
    const layer = { $name: 'acme', overrides: { 'app.navbar.trash': true } };
    manifest.set({ extensionLayers: [layer, { ...layer }] });
    const service = boot();

    expect(service.refusedOverrides()).toHaveLength(2);
    expect(reports()).toHaveLength(2);
  });

  /**
   * Pins the tracking claim the constructor's comment makes, rather than leaving it as prose.
   *
   * The effect reads both signals as arguments, so both are read on every run and both stay
   * tracked. An early `return` in the effect body — the obvious way to write "nothing to say" —
   * would skip the second read, and Angular would stop tracking that signal: a refusal arriving
   * on a later load would then never be written. This is the case that catches it, because the
   * first run has nothing on either channel.
   */
  it('reports an override refusal that only the second load introduces', () => {
    boot();
    expect(reports()).toEqual([]);

    manifest.set({
      extensionLayers: [{ $name: 'acme', overrides: { 'app.navbar.trash': true } }],
    });
    TestBed.tick();

    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('overrides.app.navbar.trash');
  });

  /**
   * Why the two channels dedup on a key each rather than on one key over both lists.
   *
   * A manifest with a refusal on **both** channels is what separates them. One shared key is
   * overwritten by whichever list was written last, so on the next recomputation each list
   * compares against the *other* list's key, differs, and is written again — the two ping-pong
   * the key and restate everything on every recomputation, for ever.
   *
   * Both channels have to be live for that to show. With one channel in play a shared key
   * behaves identically to a per-channel one, which is why the first version of this test —
   * one slot refusal, then a second load adding an override refusal — passed with the shared
   * key in place and proved nothing. Verified red by making both calls key on `'slots'`.
   */
  it('restates neither channel when a manifest refusing on both recomputes', () => {
    const layer = {
      $name: 'acme',
      slots: { navbar: 'not a list' },
      overrides: { 'app.navbar.trash': true },
    };
    manifest.set({ extensionLayers: [layer] });
    boot();

    expect(reports().filter((line) => line.includes('slots.'))).toHaveLength(1);
    expect(reports().filter((line) => line.includes('overrides.'))).toHaveLength(1);

    // A preset being selected, or a second load: a new manifest value holding the same refusals.
    manifest.set({ extensionLayers: [{ ...layer }] });
    TestBed.tick();

    expect(reports().filter((line) => line.includes('slots.'))).toHaveLength(1);
    expect(reports().filter((line) => line.includes('overrides.'))).toHaveLength(1);
  });

  /**
   * The control, and the test that has to be able to fail.
   *
   * It **exercises every legitimate override path before asserting silence** — a manifest
   * overriding a packaged id, two layers overriding the same id, a `$layers` entry overriding
   * one, and an empty `overrides` map — in that order, so an implementation that reports any
   * override rather than only a refused one cannot slip through by the assertions running
   * first. That is the exact mistake NXSAT-755's control made (review of PR 534): it asserted
   * `reports()` and only then called `resolve()`.
   *
   * Verified red by making `readOverrides` push a refusal for every override it read.
   */
  it('says nothing about a correctly layered manifest that overrides by id', () => {
    const service = TestBed.inject(AppExtensionsService);
    service.register(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.trash', label: 'Trash' },
      { id: 'app.navbar.collections', label: 'Collections' },
    ]);

    manifest.set({
      extensionLayers: [
        {
          $name: 'acme-customisation',
          $references: ['brand'],
          $layers: { brand: { overrides: { 'app.navbar.collections': { order: 5 } } } },
          overrides: { 'app.navbar.trash': { label: 'Bin it' } },
        },
        { $name: 'regional', overrides: { 'app.navbar.trash': { label: 'Corbeille' } } },
        { $name: 'empty', overrides: {} },
      ],
    });
    TestBed.tick();

    // The overrides the silence is about really did take effect — and this runs *before* the
    // assertions, so a report raised anywhere along that path is caught by them.
    const resolved = service
      .resolve<{ id: string; label: string }>(EXTENSION_SLOTS.navbar)
      .map((entry) => entry.label);

    expect(resolved).toEqual(['Collections', 'Corbeille']);
    expect(service.refusedOverrides()).toEqual([]);
    expect(service.refusedSlotEntries()).toEqual([]);
    expect(reports()).toEqual([]);
  });

  it('says nothing when there is no manifest at all', () => {
    expect(boot().refusedOverrides()).toEqual([]);
    expect(reports()).toEqual([]);
  });
});

/**
 * NXSAT-761 — the reporting half of the refused-**section** diagnostics.
 *
 * A fifth signal rather than rows on either per-entry list: a whole `slots` or `overrides` map
 * of the wrong shape has neither a slot nor an id, and those are the fields
 * `RefusedExtensionEntry` and `RefusedExtensionOverride` each require. `RefusedExtensionSection`
 * in `extension-config.ts` argues it in full.
 *
 * Same harness and deliberately the same assertions as the two blocks above, because the claim
 * is that the three channels behave alike — a signal, and one console line per refusal per load.
 */
describe('AppExtensionsService refused sections', () => {
  let manifest: WritableSignal<{ extensionLayers: readonly unknown[] }>;
  // `MockInstance<typeof console.warn>`, not `ReturnType<typeof vi.spyOn>`, for the reason the
  // first block gives: the latter's `mock.calls` is `any[]`, which `spec-types` catches and a
  // green test run does not (NXSAT-746).
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: { manifest } }],
    });
  });

  afterEach(() => warn.mockRestore());

  const reports = () =>
    warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('[agentic-ui-extensions]'));

  const boot = (): AppExtensionsService => {
    const service = TestBed.inject(AppExtensionsService);
    TestBed.tick();
    return service;
  };

  it('surfaces a refused section on its own signal, naming the key, reason and source', () => {
    manifest.set({
      extensionLayers: [{ $name: 'acme', overrides: [{ id: 'app.navbar.trash' }] }],
    });

    const service = boot();

    expect(service.refusedSections()).toEqual([
      {
        key: 'overrides',
        source: 'acme',
        reason:
          '"overrides" must be an object keyed by descriptor id, not a list, ' +
          'so every override in this contribution is dropped',
      },
    ]);
    // It did not arrive on either per-entry channel, neither of which has an honest value for
    // the field its type requires.
    expect(service.refusedSlotEntries()).toEqual([]);
    expect(service.refusedOverrides()).toEqual([]);
  });

  it('writes one console line per refused section, prefixed and naming the key', () => {
    manifest.set({
      extensionLayers: [{ $name: 'acme', slots: 'x', overrides: [] }],
    });
    boot();

    expect(reports()).toHaveLength(2);
    expect(reports()[0]).toBe(
      '[agentic-ui-extensions] slots in acme: "slots" must be an object keyed by slot id, ' +
        'not a string, so every slot in this contribution is dropped',
    );
    expect(reports()[1]).toContain('overrides in acme:');
  });

  /**
   * Pins the tracking claim the constructor's comment makes, for the third channel too. The
   * effect reads all three signals as arguments, so all three stay tracked; an early `return` in
   * the body would skip the reads after it and Angular would stop tracking those signals.
   */
  it('reports a section refusal that only the second load introduces', () => {
    boot();
    expect(reports()).toEqual([]);

    manifest.set({ extensionLayers: [{ $name: 'acme', slots: 'x' }] });
    TestBed.tick();

    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('slots in acme:');
  });

  /**
   * The test §5 of the ticket asks for: **every channel live at once**, then a recomputation.
   *
   * One `lastNoted` key over several lists is overwritten by whichever list wrote last, so on
   * the next recomputation each list compares against another list's key, differs, and is
   * written again — they ping-pong the key and restate everything for ever. NXSAT-759's version
   * of this proved it for two channels; a third key makes the same mistake available again, and
   * with three lists a shared key is worse, because two of them are rewritten on every pass.
   *
   * All three channels have to be live for it to show at all. With fewer in play a shared key
   * behaves identically to a per-channel one — which is why NXSAT-759's first attempt at this
   * test passed under the very bug it was written for, and why this one asserts a count on each
   * of the three before and after.
   *
   * Verified red by making all three `noteRefusals` calls key on `'slots'`.
   */
  it('restates no channel when a manifest refusing on all three recomputes', () => {
    const layer = {
      $name: 'acme',
      // A slot-entry refusal, a per-id override refusal and a whole-section refusal at once.
      // `slots` must stay a record for the first of these to be reachable, so the section
      // refusal is the `overrides` one, written as the list a customer plausibly writes.
      slots: { navbar: 'not a list' },
      overrides: [{ id: 'app.navbar.trash', visible: false }],
      $references: ['brand'],
      $layers: { brand: { overrides: { 'app.navbar.tasks': true } } },
    };
    manifest.set({ extensionLayers: [layer] });
    const service = boot();

    // Each channel really is live — asserted on the signals, so a channel that silently
    // reported nothing could not make the console counts below pass by being empty.
    expect(service.refusedSlotEntries()).toHaveLength(1);
    expect(service.refusedOverrides()).toHaveLength(1);
    expect(service.refusedSections()).toHaveLength(1);

    const counts = () => ({
      slots: reports().filter((line) => line.startsWith('[agentic-ui-extensions] slots.')).length,
      overrides: reports().filter((line) => line.startsWith('[agentic-ui-extensions] overrides.'))
        .length,
      sections: reports().filter((line) => line.startsWith('[agentic-ui-extensions] overrides in'))
        .length,
    });

    expect(counts()).toEqual({ slots: 1, overrides: 1, sections: 1 });

    // A preset being selected, or a second load: a new manifest value holding the same refusals.
    manifest.set({ extensionLayers: [{ ...layer }] });
    TestBed.tick();

    expect(counts()).toEqual({ slots: 1, overrides: 1, sections: 1 });
  });

  /**
   * The control, and the test that has to be able to fail.
   *
   * It **exercises every legitimate path before asserting silence**, in that order, which is the
   * mistake NXSAT-755's control made (review of PR 534): it asserted `reports()` and only then
   * called `resolve()`, so a warning raised inside `resolve` slipped through unnoticed. The
   * paths walked here are the ones a reporter keyed on the two configuration keys could get
   * wrong: a layer with neither key, a layer with both keys valid, an **empty** map of each, a
   * `$layers` body carrying valid keys, and a packaged id actually being overridden.
   *
   * It asserts silence on all four refusal signals and on the console, which is what "no
   * diagnostic on any channel" means.
   *
   * Verified red three ways, each turning this test alone red: having `readSection` report when
   * the key is absent, having it report an empty map, and having it report on success.
   */
  it('says nothing on any channel about a valid manifest', () => {
    const service = TestBed.inject(AppExtensionsService);
    service.register(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.trash', label: 'Trash' },
      { id: 'app.navbar.collections', label: 'Collections' },
    ]);

    manifest.set({
      extensionLayers: [
        { $name: 'no-keys', $version: '1.0.0' },
        {
          $name: 'acme-customisation',
          $references: ['brand'],
          $layers: { brand: { slots: { navbar: [{ id: 'acme.navbar.contracts' }] } } },
          overrides: { 'app.navbar.trash': { label: 'Bin it' } },
        },
        { $name: 'empty-maps', slots: {}, overrides: {} },
      ],
    });
    TestBed.tick();

    // The contributions the silence is about really did take effect, read before the assertions
    // so a report raised anywhere along that path is caught by them.
    const labels = service
      .resolve<{ id: string; label: string }>(EXTENSION_SLOTS.navbar)
      .map((entry) => entry.label);

    expect(labels).toContain('Bin it');
    expect(labels).toHaveLength(3);

    expect(service.refusedSections()).toEqual([]);
    expect(service.refusedSlotEntries()).toEqual([]);
    expect(service.refusedOverrides()).toEqual([]);
    expect(service.missingLayers()).toEqual([]);
    expect(reports()).toEqual([]);
  });

  it('says nothing when there is no manifest at all', () => {
    expect(boot().refusedSections()).toEqual([]);
    expect(reports()).toEqual([]);
  });
});
