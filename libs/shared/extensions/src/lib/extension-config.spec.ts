import {
  mergeExtensionConfigs,
  readExtensionConfig,
  resolveExtensionConfig,
  resolveExtensionLayers,
  type ExtensionConfig,
} from './extension-config';

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
