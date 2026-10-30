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
    expect(refused[0].reason).toContain('merged into one');
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
