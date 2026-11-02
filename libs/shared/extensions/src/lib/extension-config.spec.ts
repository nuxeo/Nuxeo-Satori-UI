import {
  mergeExtensionConfigs,
  readExtensionConfig,
  resolveExtensionConfig,
  resolveExtensionLayers,
  type ExtensionConfig,
} from './extension-config';
import type { ExtensionElement } from './extension-slots';

/** `label` is a descriptor field, not an `ExtensionElement` one, so reading it needs saying. */
type LabelledEntry = ExtensionElement & { readonly label?: string };

describe('mergeExtensionConfigs', () => {
  it('lets a later layer win on a scalar', () => {
    const merged = mergeExtensionConfigs(
      { overrides: { 'app.toolbar.delete': { visible: true } } },
      { overrides: { 'app.toolbar.delete': { visible: false } } },
    );
    expect(merged.overrides?.['app.toolbar.delete'].visible).toBe(false);
  });

  it('merges arrays of descriptors by id rather than concatenating them', () => {
    const merged = mergeExtensionConfigs(
      { slots: { navbar: [{ id: 'app.navbar.browse', order: 30 }] } } as ExtensionConfig,
      { slots: { navbar: [{ id: 'app.navbar.browse', order: 5 }] } } as ExtensionConfig,
    );
    expect(merged.slots?.['navbar']).toEqual([{ id: 'app.navbar.browse', order: 5 }]);
  });

  it('appends a descriptor a later layer introduces', () => {
    const merged = mergeExtensionConfigs(
      { slots: { navbar: [{ id: 'app.navbar.browse' }] } } as ExtensionConfig,
      { slots: { navbar: [{ id: 'acme.navbar.contracts' }] } } as ExtensionConfig,
    );
    expect(merged.slots?.['navbar'].map((entry) => entry.id)).toEqual([
      'app.navbar.browse',
      'acme.navbar.contracts',
    ]);
  });

  it('replaces rather than merges when a key uses the $replace suffix', () => {
    const merged = mergeExtensionConfigs({ slots: { navbar: [{ id: 'app.navbar.browse' }] } }, {
      'slots.$replace': { navbar: [{ id: 'acme.navbar.only' }] },
    } as unknown as ExtensionConfig);
    expect(merged.slots?.['navbar'].map((entry) => entry.id)).toEqual(['acme.navbar.only']);
  });

  it('does not merge $-prefixed metadata into the result', () => {
    const merged = mergeExtensionConfigs(
      { $name: 'packaged', $references: ['acme'] },
      { $name: 'acme', overrides: {} },
    );
    expect(merged.$name).toBeUndefined();
    expect(merged.$references).toBeUndefined();
  });

  it('returns an empty config when given nothing usable', () => {
    expect(mergeExtensionConfigs()).toEqual({});
    expect(mergeExtensionConfigs(...([null, undefined] as unknown as ExtensionConfig[]))).toEqual(
      {},
    );
  });
});

describe('resolveExtensionConfig', () => {
  const root: ExtensionConfig = {
    $references: ['base', 'acme'],
    $layers: {
      base: { overrides: { 'app.toolbar.delete': { visible: true, label: 'Delete' } } },
      acme: { overrides: { 'app.toolbar.delete': { label: 'Bin it' } } },
    },
  };

  it('applies referenced layers in order, with the last file winning', () => {
    const { config, applied, missing } = resolveExtensionConfig(root);
    expect(applied).toEqual(['base', 'acme']);
    expect(missing).toEqual([]);
    expect(config.overrides?.['app.toolbar.delete']).toEqual({ visible: true, label: 'Bin it' });
  });

  it('drops a layer named in $ignoreReferenceList', () => {
    const { config, applied } = resolveExtensionConfig({
      ...root,
      $ignoreReferenceList: ['acme'],
    });
    expect(applied).toEqual(['base']);
    expect(config.overrides?.['app.toolbar.delete'].label).toBe('Delete');
  });

  it('reports a referenced layer that cannot be resolved instead of failing', () => {
    const { config, applied, missing } = resolveExtensionConfig({
      $references: ['base', 'absent'],
      $layers: { base: { overrides: { 'app.toolbar.a': { visible: false } } } },
    });
    expect(applied).toEqual(['base']);
    expect(missing).toEqual(['absent']);
    expect(config.overrides?.['app.toolbar.a'].visible).toBe(false);
  });

  it('accepts an external layer resolver, so layers need not live in the document', () => {
    const { config, applied } = resolveExtensionConfig({ $references: ['remote'] }, (name) =>
      name === 'remote' ? { overrides: { 'app.toolbar.x': { visible: false } } } : null,
    );
    expect(applied).toEqual(['remote']);
    expect(config.overrides?.['app.toolbar.x'].visible).toBe(false);
  });

  it('returns the root untouched when there are no references', () => {
    const config: ExtensionConfig = { overrides: { 'app.toolbar.a': { order: 1 } } };
    expect(resolveExtensionConfig(config).config.overrides).toEqual(config.overrides);
  });

  it('ignores a layer body that is not an object', () => {
    const { applied, missing } = resolveExtensionConfig(
      { $references: ['bad'] },
      () => 'not an object' as unknown as ExtensionConfig,
    );
    expect(applied).toEqual([]);
    expect(missing).toEqual(['bad']);
  });
});

describe('resolveExtensionLayers', () => {
  it('merges packages in contribution order, so a later package wins over an earlier one', () => {
    const { config } = resolveExtensionLayers([
      { overrides: { 'app.navbar.trash': { visible: false, label: 'Bin' } } },
      { overrides: { 'app.navbar.trash': { label: 'Recycle' } } },
    ]);

    expect(config.overrides?.['app.navbar.trash']).toEqual({ visible: false, label: 'Recycle' });
  });

  it("resolves each package's $layers on its own, even when two use the same name", () => {
    const { config, applied, missing } = resolveExtensionLayers([
      {
        $references: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.trash': { label: 'Bin' } } } },
      },
      {
        $references: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.tasks': { label: 'Queue' } } } },
      },
    ]);

    expect(config.overrides?.['app.navbar.trash']).toEqual({ label: 'Bin' });
    expect(config.overrides?.['app.navbar.tasks']).toEqual({ label: 'Queue' });
    expect(applied).toEqual(['brand', 'brand']);
    expect(missing).toEqual([]);
  });

  it("cannot reference another package's named layer", () => {
    const { config, missing } = resolveExtensionLayers([
      { $layers: { shared: { overrides: { 'app.navbar.trash': { visible: false } } } } },
      { $references: ['shared'] },
    ]);

    expect(config.overrides?.['app.navbar.trash']).toBeUndefined();
    expect(missing).toEqual(['shared']);
  });

  it('lets a later null clear an earlier rule, and a later order replace an earlier null', () => {
    // Upstream's merge threw here, inside the computed every slot reads, so all of them rethrew.
    const { config } = resolveExtensionLayers([
      {
        overrides: {
          'app.navbar.trash': {
            rule: { type: 'core.every', parameters: ['app.rules.isAdministrator'] },
          },
          'app.navbar.tasks': { order: null },
        },
      },
      {
        overrides: {
          'app.navbar.trash': { rule: null },
          'app.navbar.tasks': { order: 5 },
        },
      },
    ]);

    expect(config.overrides?.['app.navbar.trash']).toEqual({ rule: null });
    expect(config.overrides?.['app.navbar.tasks']).toEqual({ order: 5 });
  });

  it('keeps the other packages when one has malformed layer metadata', () => {
    const { config, applied, missing } = resolveExtensionLayers([
      { overrides: { 'app.navbar.trash': { label: 'Bin' } } },
      { $references: 'brand', $ignoreReferenceList: 1, $layers: { brand: 'x' } },
      { $references: ['brand', 7], $layers: [] },
      { $references: ['brand'], $layers: { brand: 'x' } },
      {
        $references: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.tasks': { label: 'Queue' } } } },
      },
    ]);

    expect(config.overrides?.['app.navbar.trash']).toEqual({ label: 'Bin' });
    expect(config.overrides?.['app.navbar.tasks']).toEqual({ label: 'Queue' });
    expect(applied).toEqual(['brand']);
    expect(missing).toEqual(['brand', 'brand']);
  });
});

describe('readExtensionConfig', () => {
  it('reads slots and overrides out of untrusted JSON', () => {
    const config = readExtensionConfig({
      $name: 'acme',
      slots: { navbar: [{ id: 'acme.navbar.contracts', label: 'Contracts' }] },
      overrides: { 'app.toolbar.delete': { visible: false } },
    });
    expect(config.$name).toBe('acme');
    expect(config.slots?.['navbar']).toHaveLength(1);
    expect(config.overrides?.['app.toolbar.delete'].visible).toBe(false);
  });

  it('drops a slot entry with no usable id, because it could never be addressed', () => {
    const config = readExtensionConfig({
      slots: { navbar: [{ id: '  ' }, { label: 'no id' }, { id: 'acme.navbar.ok' }] },
    });
    expect(config.slots?.['navbar'].map((entry) => entry.id)).toEqual(['acme.navbar.ok']);
  });

  it('ignores a __proto__ slot or override id rather than re-prototyping what it reads', () => {
    const config = readExtensionConfig(
      JSON.parse(
        '{"slots": {"__proto__": [{"id": "acme.navbar.x"}]},' +
          ' "overrides": {"__proto__": {"app.navbar.trash": {"visible": false}}}}',
      ),
    );

    expect(Object.getPrototypeOf(config.slots)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(config.overrides)).toBe(Object.prototype);
    expect(config.overrides?.['app.navbar.trash']).toBeUndefined();
    expect(config).toStrictEqual({ slots: {}, overrides: {} });
  });

  it('tolerates the shapes a customer can actually save', () => {
    expect(readExtensionConfig(null)).toEqual({});
    expect(readExtensionConfig('a string')).toEqual({});
    expect(readExtensionConfig([1, 2, 3])).toEqual({});
    expect(readExtensionConfig({ slots: 'not an object' })).toEqual({});
    expect(readExtensionConfig({ slots: { navbar: 'not an array' } }).slots).toEqual({});
    expect(readExtensionConfig({ overrides: { 'app.a': 'not an object' } }).overrides).toEqual({});
  });

  /**
   * `{ slots: 'not an object' }` returning `{}` used to be the pin on a stated limitation: the
   * whole map went and nothing said so anywhere. It is now the pin on a **contract**, and the
   * difference is the second half of this test.
   *
   * This function discards refusals by design — it keeps the signature callers that only want
   * configuration already have — so the silence here is the signature, not the gap.
   * `resolveExtensionLayers` is the caller that keeps them, because it alone knows a layer's
   * position in contribution order. Asserting both halves side by side is what stops the next
   * reader taking the `toEqual({})` above for the defect NXSAT-761 fixed.
   */
  it('discards a section refusal, which resolveExtensionLayers is the one to report', () => {
    expect(readExtensionConfig({ slots: 'not an object' })).toEqual({});

    const { refusedSections } = resolveExtensionLayers([{ slots: 'not an object' }]);

    expect(refusedSections).toHaveLength(1);
    expect(refusedSections[0].key).toBe('slots');
    expect(refusedSections[0].source).toBe('contribution 1');
  });
});

/**
 * NXSAT-755. Each of these shapes changed what a customer saw and said nothing anywhere.
 *
 * The refusals are collected where the drop happens, which is why they are asserted through
 * `resolveExtensionLayers` — the one caller that knows a layer's position in contribution
 * order, and so the only place that can name where an entry was written.
 */
describe('refused slot entries', () => {
  /** Only the fields a reader has to act on, so a message reflow does not fail the suite. */
  const shapeOf = (layers: readonly unknown[]) =>
    resolveExtensionLayers(layers).refused.map(({ slot, id, source }) => ({ slot, id, source }));

  it('reports a slot whose value is not a list, and says the whole slot went', () => {
    const { refused, config } = resolveExtensionLayers([
      { $name: 'acme', slots: { documentView: { id: 'acme.view' }, navbar: [{ id: 'acme.nav' }] } },
    ]);

    expect(refused).toHaveLength(1);
    expect(refused[0].slot).toBe('documentView');
    expect(refused[0].id).toBeNull();
    expect(refused[0].source).toBe('acme');
    expect(refused[0].reason).toContain('list of entries');
    expect(refused[0].reason).toContain('not an object');
    expect(refused[0].reason).toContain('whole slot');
    // The behaviour itself is unchanged: the bad slot is still dropped and the good one kept.
    expect(config.slots?.['documentView']).toBeUndefined();
    expect(config.slots?.['navbar']).toHaveLength(1);
  });

  it('reports a slot named __proto__ rather than dropping it in silence', () => {
    const { refused } = resolveExtensionLayers([
      JSON.parse('{"$name": "acme", "slots": {"__proto__": [{"id": "acme.x"}]}}'),
    ]);

    expect(refused).toHaveLength(1);
    expect(refused[0].slot).toBe('__proto__');
    expect(refused[0].reason).toContain('__proto__');
  });

  it('reports each entry shape the per-entry filter refuses, naming the position', () => {
    const { refused, config } = resolveExtensionLayers([
      {
        $name: 'acme',
        slots: {
          navbar: ['a string', { label: 'no id' }, { id: 42 }, { id: '   ' }, { id: 'acme.ok' }],
        },
      },
    ]);

    expect(refused.map((entry) => entry.reason)).toEqual([
      'entry 1 must be an object, not a string',
      'entry 2 has no string "id", so nothing could address it',
      'entry 3 has no string "id", so nothing could address it',
      'entry 4 has a blank "id", so nothing could address it',
    ]);
    expect(refused.every((entry) => entry.slot === 'navbar' && entry.id === null)).toBe(true);
    // Unchanged: the four are still dropped, the fifth still registers.
    expect(config.slots?.['navbar'].map((entry) => entry.id)).toEqual(['acme.ok']);
  });

  it('reports a duplicate id inside one contribution, which is a typo and never an override', () => {
    const { refused, config } = resolveExtensionLayers([
      {
        $name: 'acme',
        slots: {
          navbar: [
            { id: 'acme.nav.contracts', label: 'Contracts' },
            { id: 'acme.nav.contracts', label: 'Agreements' },
          ],
        },
      },
    ]);

    expect(refused).toHaveLength(1);
    expect(refused[0].slot).toBe('navbar');
    expect(refused[0].id).toBe('acme.nav.contracts');
    expect(refused[0].reason).toContain('entry 2 repeats the id "acme.nav.contracts"');
    // It names no winner: there are two collapse paths and they disagree on a field the later
    // row omits. `app-extensions.service.spec.ts` pins both, and the cases that refute every
    // winner-naming wording the review loop tried.
    expect(refused[0].reason).toContain('give each entry its own id');
    expect(refused[0].reason).not.toContain('the later entry wins');
    expect(refused[0].reason).not.toContain('survives');
    // Reported, not dropped. Both survive the read exactly as before; the merge collapses them.
    const navbar = (config.slots?.['navbar'] ?? []) as readonly LabelledEntry[];
    expect(navbar.map((entry) => entry.label)).toEqual(['Contracts', 'Agreements']);
  });

  it('names the contribution by $name, and by its position when it declares none', () => {
    expect(
      shapeOf([
        { $name: 'acme-customisation', slots: { navbar: 'not a list' } },
        { slots: { navbar: 'not a list' } },
      ]),
    ).toEqual([
      { slot: 'navbar', id: null, source: 'acme-customisation' },
      { slot: 'navbar', id: null, source: 'contribution 2' },
    ]);
  });

  it('names the $layers entry a refusal sits in, so a referenced layer is findable', () => {
    expect(
      shapeOf([
        {
          $name: 'acme-customisation',
          $references: ['brand'],
          $layers: { brand: { slots: { navbar: 'not a list' } } },
        },
      ]),
    ).toEqual([{ slot: 'navbar', id: null, source: '$layers.brand of acme-customisation' }]);
  });

  /**
   * Pins what §12 of `docs/extension-reference.md` promises. The read walks `$layers` before
   * `$ignoreReferenceList` is consulted, so an ignored layer's typo is still reported — which is
   * fine only because the message names the layer rather than implying it took effect.
   */
  it('still reports a refusal in a layer dropped by $ignoreReferenceList, naming that layer', () => {
    const { refused, applied } = resolveExtensionLayers([
      {
        $name: 'acme-customisation',
        $references: ['brand'],
        $ignoreReferenceList: ['brand'],
        $layers: { brand: { slots: { navbar: 'not a list' } } },
      },
    ]);

    expect(applied).toEqual([]);
    expect(refused).toHaveLength(1);
    expect(refused[0].source).toBe('$layers.brand of acme-customisation');
  });

  /**
   * Review of PR 534. The fallback label used to be derived first and detected by
   * `startsWith('contribution ')`, so a layer that *declared* this name had it thrown away and
   * replaced by the `$layers` form — a discriminator sniffing a string the customer owns.
   */
  it('keeps a declared $name that happens to look like the generated fallback', () => {
    expect(
      shapeOf([
        {
          $name: 'acme-customisation',
          $references: ['brand'],
          $layers: { brand: { $name: 'contribution 5', slots: { navbar: 'not a list' } } },
        },
      ]),
    ).toEqual([{ slot: 'navbar', id: null, source: 'contribution 5' }]);
  });

  it("prefers a $layers entry's own $name over the name it is filed under", () => {
    expect(
      shapeOf([
        {
          $name: 'acme-customisation',
          $references: ['brand'],
          $layers: { brand: { $name: 'acme-brand', slots: { navbar: 'not a list' } } },
        },
      ]),
    ).toEqual([{ slot: 'navbar', id: null, source: 'acme-brand' }]);
  });

  /**
   * The control, and the reason this ticket was not simply "add a warning".
   *
   * Every same-`id` reuse below is the documented override mechanism — a `$layers` entry
   * patching an earlier one, and a second contribution patching the first — so a diagnostic
   * here would fire on every correctly layered manifest and be worse than silence.
   */
  it('refuses nothing in a valid, correctly layered manifest', () => {
    const { refused, config } = resolveExtensionLayers([
      {
        $name: 'acme-customisation',
        $references: ['baseline', 'brand'],
        $layers: {
          baseline: {
            slots: { navbar: [{ id: 'acme.nav.contracts', label: 'Contracts', order: 20 }] },
          },
          brand: { slots: { navbar: [{ id: 'acme.nav.contracts', order: 5 }] } },
        },
        overrides: { 'app.navbar.trash': { visible: false } },
      },
      { $name: 'regional', slots: { navbar: [{ id: 'acme.nav.contracts', label: 'Contrats' }] } },
    ]);

    expect(refused).toEqual([]);
    // And the layering it was asserting silence about really did happen.
    expect(config.slots?.['navbar']).toEqual([
      { id: 'acme.nav.contracts', label: 'Contrats', order: 5 },
    ]);
  });

  it('refuses nothing when no contribution carries an extensions layer', () => {
    expect(resolveExtensionLayers([]).refused).toEqual([]);
    expect(resolveExtensionLayers([null, 'a string', 7]).refused).toEqual([]);
  });
});

/**
 * NXSAT-759. The same silence NXSAT-755 removed from `slots`, one key over.
 *
 * Reported on its own list rather than through `RefusedExtensionEntry`, because that type's
 * `slot` is required and an override belongs to no slot — `readOverrides` in
 * `extension-config.ts` argues that in full. So these assert `refusedOverrides`, and the
 * `refused` list is asserted to stay empty, which is the half that proves the two channels did
 * not get mixed.
 */
describe('refused overrides', () => {
  it('reports an override whose value is not an object, naming the id and the shape', () => {
    const { refusedOverrides, refused, config } = resolveExtensionLayers([
      {
        $name: 'acme',
        overrides: { 'app.navbar.trash': true, 'app.navbar.tasks': { visible: false } },
      },
    ]);

    expect(refusedOverrides).toEqual([
      {
        id: 'app.navbar.trash',
        source: 'acme',
        reason: 'an override must be an object, not a boolean, so it is dropped',
      },
    ]);
    // Not a slot refusal, and nothing was invented on the other channel to carry it.
    expect(refused).toEqual([]);
    // The behaviour itself is unchanged: the bad override is still dropped, the good one kept.
    expect(config.overrides?.['app.navbar.trash']).toBeUndefined();
    expect(config.overrides?.['app.navbar.tasks']).toEqual({ visible: false });
  });

  it('names each shape a customer can actually write, so the message says what to look for', () => {
    const { refusedOverrides } = resolveExtensionLayers([
      {
        $name: 'acme',
        overrides: {
          'app.navbar.a': 'hidden',
          'app.navbar.b': 42,
          'app.navbar.c': null,
          'app.navbar.d': [{ visible: false }],
        },
      },
    ]);

    expect(refusedOverrides.map((entry) => entry.reason)).toEqual([
      'an override must be an object, not a string, so it is dropped',
      'an override must be an object, not a number, so it is dropped',
      'an override must be an object, not null, so it is dropped',
      'an override must be an object, not a list, so it is dropped',
    ]);
    expect(refusedOverrides.map((entry) => entry.id)).toEqual([
      'app.navbar.a',
      'app.navbar.b',
      'app.navbar.c',
      'app.navbar.d',
    ]);
  });

  it('reports an override keyed __proto__ rather than dropping it in silence', () => {
    const { refusedOverrides, config } = resolveExtensionLayers([
      JSON.parse('{"$name": "acme", "overrides": {"__proto__": {"visible": false}}}'),
    ]);

    expect(refusedOverrides).toEqual([
      {
        id: '__proto__',
        source: 'acme',
        reason: 'an override may not be keyed "__proto__", so it is dropped',
      },
    ]);
    // Unchanged: still dropped, and the object it built still has `Object.prototype`.
    expect(Object.getPrototypeOf(config.overrides)).toBe(Object.prototype);
    expect(config.overrides).toEqual({});
  });

  /**
   * `__proto__` is checked first, so a `"__proto__": true` is reported as the key problem it is.
   * Both guards refuse it either way — only the reason differs — which is the order `readSlots`
   * already uses for a `__proto__` slot that is also not a list.
   */
  it('names __proto__ as the cause when the value is malformed too', () => {
    const { refusedOverrides } = resolveExtensionLayers([
      JSON.parse('{"$name": "acme", "overrides": {"__proto__": true}}'),
    ]);

    expect(refusedOverrides).toHaveLength(1);
    expect(refusedOverrides[0].reason).toContain('__proto__');
  });

  it('names the contribution the way a slot refusal does — $name, $layers, then position', () => {
    const { refusedOverrides } = resolveExtensionLayers([
      { $name: 'acme-customisation', overrides: { 'app.navbar.a': true } },
      { overrides: { 'app.navbar.b': true } },
      {
        $name: 'brand-stack',
        $references: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.c': true } } },
      },
    ]);

    expect(refusedOverrides.map(({ id, source }) => ({ id, source }))).toEqual([
      { id: 'app.navbar.a', source: 'acme-customisation' },
      { id: 'app.navbar.b', source: 'contribution 2' },
      { id: 'app.navbar.c', source: '$layers.brand of brand-stack' },
    ]);
  });

  /**
   * Pins what §12 of `docs/extension-reference.md` promises for this channel too. The read walks
   * `$layers` before `$ignoreReferenceList` is consulted, so an ignored layer's bad override is
   * still reported — fine only because the message names the layer rather than implying it
   * applied.
   */
  it('still reports a refused override in a layer dropped by $ignoreReferenceList', () => {
    const { refusedOverrides, applied, config } = resolveExtensionLayers([
      {
        $name: 'acme-customisation',
        $references: ['brand'],
        $ignoreReferenceList: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.trash': true } } },
      },
    ]);

    expect(applied).toEqual([]);
    expect(refusedOverrides).toHaveLength(1);
    expect(refusedOverrides[0].source).toBe('$layers.brand of acme-customisation');
    // And the ignored layer really did not apply, so the message is about a layer with no effect.
    expect(config.overrides).toBeUndefined();
  });

  /**
   * The control. It asserts silence **after** exercising every override path that must stay
   * silent, which is the ordering NXSAT-755's own control got wrong first time: a manifest that
   * overrides a packaged id, two layers overriding the same id, and a layer whose `overrides` is
   * an empty object. Verified by making `readOverrides` report every override and watching this
   * go red.
   */
  it('refuses nothing for a valid manifest that overrides by id across layers', () => {
    const { refusedOverrides, refused, config } = resolveExtensionLayers([
      {
        $name: 'acme-customisation',
        $references: ['brand'],
        $layers: { brand: { overrides: { 'app.navbar.trash': { label: 'Bin' } } } },
        overrides: { 'app.navbar.trash': { visible: false }, 'app.navbar.tasks': { order: 5 } },
      },
      { $name: 'regional', overrides: { 'app.navbar.trash': { label: 'Corbeille' } } },
      { $name: 'empty', overrides: {} },
    ]);

    expect(refusedOverrides).toEqual([]);
    expect(refused).toEqual([]);
    // And the layering it was asserting silence about really did happen.
    expect(config.overrides?.['app.navbar.trash']).toEqual({
      visible: false,
      label: 'Corbeille',
    });
    expect(config.overrides?.['app.navbar.tasks']).toEqual({ order: 5 });
  });

  it('refuses nothing when no contribution carries an overrides map', () => {
    expect(resolveExtensionLayers([]).refusedOverrides).toEqual([]);
    expect(resolveExtensionLayers([null, 'a string', 7]).refusedOverrides).toEqual([]);
  });

  /**
   * Was the pin on NXSAT-759's one stated limitation; now it pins where that refusal goes.
   *
   * A whole-map refusal has no id, which is why it could not join this list —
   * `RefusedExtensionOverride.id` is non-null by design and that is the whole argument for the
   * type existing separately. It reaches `refusedSections` instead (NXSAT-761), and the half
   * worth keeping from the old test is this one: it is **not** on either per-entry list, so the
   * three channels did not get mixed to make the reporting fit.
   */
  it('reports a whole overrides map on the section channel, not on this one', () => {
    const { refusedOverrides, refused, refusedSections } = resolveExtensionLayers([
      { $name: 'acme', overrides: [{ id: 'app.navbar.trash', visible: false }] },
    ]);

    expect(refusedOverrides).toEqual([]);
    expect(refused).toEqual([]);
    expect(refusedSections.map(({ key, source }) => ({ key, source }))).toEqual([
      { key: 'overrides', source: 'acme' },
    ]);
  });
});

/**
 * NXSAT-761. The silence NXSAT-755 and NXSAT-759 removed from inside the two maps, one level up:
 * a `slots` or `overrides` map that is the wrong shape **as a whole** lost every entry in that
 * contribution and said nothing anywhere.
 *
 * Reported on a third list rather than on either per-entry one, because a whole-map refusal has
 * neither a slot nor an id — the two fields those types require. `RefusedExtensionSection`
 * argues it in full. So each case here asserts the section list **and** that both per-entry
 * lists stayed empty, which is the half that proves nothing was invented on a channel that had
 * no honest value to put in its key field.
 */
describe('refused configuration sections', () => {
  /** Only the fields a reader acts on, so a message reflow does not fail the suite. */
  const shapeOf = (layers: readonly unknown[]) =>
    resolveExtensionLayers(layers).refusedSections.map(({ key, source }) => ({ key, source }));

  it('reports a slots map that is not an object, and says every slot went', () => {
    const { refusedSections, refused, refusedOverrides, config } = resolveExtensionLayers([
      { $name: 'acme', slots: 'x', overrides: { 'app.navbar.trash': { visible: false } } },
    ]);

    expect(refusedSections).toHaveLength(1);
    expect(refusedSections[0].key).toBe('slots');
    expect(refusedSections[0].source).toBe('acme');
    expect(refusedSections[0].reason).toContain('"slots"');
    expect(refusedSections[0].reason).toContain('keyed by slot id');
    expect(refusedSections[0].reason).toContain('not a string');
    expect(refusedSections[0].reason).toContain('every slot in this contribution is dropped');
    // Not a slot-entry refusal: there is no slot to name, which is why this list exists.
    expect(refused).toEqual([]);
    expect(refusedOverrides).toEqual([]);
    // The behaviour itself is unchanged: the bad key is still dropped and the good one applies.
    expect(config.slots).toBeUndefined();
    expect(config.overrides?.['app.navbar.trash']).toEqual({ visible: false });
  });

  /**
   * The case worth having a ticket for. Writing `overrides` as a list is a plausible mistake
   * precisely because a `slots` entry **is** a list, and it silently cost a customer every
   * override in the layer.
   */
  it('reports an overrides map written as a list, the mistake slots entries invite', () => {
    const { refusedSections, refused, refusedOverrides, config } = resolveExtensionLayers([
      {
        $name: 'acme',
        overrides: [{ id: 'app.navbar.trash', visible: false }],
        slots: { navbar: [{ id: 'acme.navbar.contracts' }] },
      },
    ]);

    expect(refusedSections).toHaveLength(1);
    expect(refusedSections[0].key).toBe('overrides');
    expect(refusedSections[0].source).toBe('acme');
    expect(refusedSections[0].reason).toContain('"overrides"');
    expect(refusedSections[0].reason).toContain('keyed by descriptor id');
    expect(refusedSections[0].reason).toContain('not a list');
    expect(refusedSections[0].reason).toContain('every override in this contribution is dropped');
    expect(refused).toEqual([]);
    expect(refusedOverrides).toEqual([]);
    expect(config.overrides).toBeUndefined();
    expect(config.slots?.['navbar']).toHaveLength(1);
  });

  it('names each shape a customer can actually write, so the message says what to look for', () => {
    const { refusedSections } = resolveExtensionLayers([
      { $name: 'a', slots: null },
      { $name: 'b', slots: 7 },
      { $name: 'c', overrides: 'hidden' },
      { $name: 'd', overrides: true },
    ]);

    expect(refusedSections.map((section) => section.reason)).toEqual([
      '"slots" must be an object keyed by slot id, not null, ' +
        'so every slot in this contribution is dropped',
      '"slots" must be an object keyed by slot id, not a number, ' +
        'so every slot in this contribution is dropped',
      '"overrides" must be an object keyed by descriptor id, not a string, ' +
        'so every override in this contribution is dropped',
      '"overrides" must be an object keyed by descriptor id, not a boolean, ' +
        'so every override in this contribution is dropped',
    ]);
  });

  /**
   * Three contributions can each get the same key wrong, and "which file do I open" is the
   * question the report exists to answer — so the three must be distinguishable. `source` is
   * what does it, by the same three rules the other two channels use.
   */
  it('names the contribution three ways, so three layers with the same mistake are told apart', () => {
    expect(
      shapeOf([
        { $name: 'acme', overrides: [] },
        { $name: 'parent', $layers: { brand: { overrides: [] } }, $references: ['brand'] },
        { overrides: [] },
      ]),
    ).toEqual([
      { key: 'overrides', source: 'acme' },
      { key: 'overrides', source: '$layers.brand of parent' },
      { key: 'overrides', source: 'contribution 3' },
    ]);
  });

  it('reports both keys of one contribution when both are wrong', () => {
    expect(shapeOf([{ $name: 'acme', slots: [], overrides: [] }])).toEqual([
      { key: 'slots', source: 'acme' },
      { key: 'overrides', source: 'acme' },
    ]);
  });

  /**
   * The control, and the test that has to be able to fail.
   *
   * It exercises every shape that must stay silent **before** asserting silence, which is the
   * ordering NXSAT-755's control got wrong first time (review of PR 534) — it asserted silence
   * and only then called the code that would have broken it. Here the order does not save a
   * reader on its own, so the list is what carries the weight: a layer with neither key, a layer
   * with both keys valid, an **empty** map of each (`{}` is a record, so it must not refuse), a
   * `$layers` body with valid keys, and the non-object layers `resolveExtensionLayers` tolerates
   * at the top — all of which a reporter keyed on "is this key missing or unusable" could get
   * wrong in a different way.
   *
   * Verified red by having `readSection` report whenever the key was absent, and again by having
   * it report an empty map; each turned the relevant row of this test red on its own.
   */
  it('refuses nothing for a valid manifest, nor for an absent or empty map', () => {
    const { refusedSections, refused, refusedOverrides, config } = resolveExtensionLayers([
      { $name: 'no-keys', $version: '1.0.0' },
      {
        $name: 'acme',
        $references: ['brand'],
        $layers: { brand: { slots: { navbar: [{ id: 'acme.navbar.contracts' }] } } },
        overrides: { 'app.navbar.trash': { visible: false } },
      },
      { $name: 'empty-maps', slots: {}, overrides: {} },
      null,
      'a string',
      7,
      [1, 2, 3],
    ]);

    // The contributions the silence is about really did take effect, asserted before it.
    expect(config.slots?.['navbar']).toEqual([{ id: 'acme.navbar.contracts' }]);
    expect(config.overrides?.['app.navbar.trash']).toEqual({ visible: false });

    expect(refusedSections).toEqual([]);
    expect(refused).toEqual([]);
    expect(refusedOverrides).toEqual([]);
  });
});
