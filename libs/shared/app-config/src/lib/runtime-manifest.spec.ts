import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_RUNTIME_MANIFEST, mergeRuntimeManifest } from './runtime-manifest';

describe('mergeRuntimeManifest', () => {
  it('returns the defaults for an empty manifest', () => {
    expect(mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {})).toEqual(
      DEFAULT_APP_RUNTIME_MANIFEST,
    );
  });

  it('reads nav items and fills the optional fields', () => {
    const manifest = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      navItems: [{ id: 'acme-reports', route: '/reports' }],
    });

    expect(manifest.navItems).toEqual([
      {
        id: 'acme-reports',
        route: '/reports',
        label: 'acme-reports',
        icon: 'folder',
        order: 0,
        visible: true,
      },
    ]);
  });

  it('drops nav items with nothing to address or navigate to', () => {
    const manifest = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      navItems: [
        { route: '/no-id' },
        { id: 'no-route' },
        { id: '  ', route: '/blank-id' },
        'not an object',
        { id: 'kept', route: '/kept' },
      ],
    });

    expect(manifest.navItems.map((item) => item.id)).toEqual(['kept']);
  });

  it('reads action overrides and defaults visibility to true', () => {
    const manifest = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      actions: {
        'document.delete': { visible: false },
        'document.export': { rule: 'canWriteDocument', label: 'Download', order: 3 },
      },
    });

    expect(manifest.actions['document.delete']?.visible).toBe(false);
    expect(manifest.actions['document.export']).toEqual({
      visible: true,
      rule: 'canWriteDocument',
      label: 'Download',
      order: 3,
    });
  });

  it('keeps only boolean toggles and string labels', () => {
    const manifest = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      featureToggles: { ai: true, search: 'yes' },
      labels: { 'browse.title': 'Files', 'browse.count': 7 },
    });

    expect(manifest.featureToggles).toEqual({ ai: true });
    expect(manifest.labels).toEqual({ 'browse.title': 'Files' });
  });

  it('leaves nav items untouched when the key is absent but clears them when set empty', () => {
    const withItems = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      navItems: [{ id: 'a', route: '/a' }],
    });

    expect(mergeRuntimeManifest(withItems, {}).navItems).toHaveLength(1);
    expect(mergeRuntimeManifest(withItems, { navItems: [] }).navItems).toHaveLength(0);
  });

  it("keeps each fragment's extensions as its own layer, in order", () => {
    const merged = [
      { extensions: { overrides: { a: 1 } } },
      { labels: { x: 'y' } },
      { extensions: { overrides: { b: 2 } } },
      { extensions: 'not an object' },
    ].reduce(mergeRuntimeManifest, DEFAULT_APP_RUNTIME_MANIFEST);

    expect(merged.extensionLayers).toEqual([{ overrides: { a: 1 } }, { overrides: { b: 2 } }]);
  });

  // Error paths.
  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
  ])('ignores a manifest that is %s', (_label, patch) => {
    expect(mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, patch)).toEqual(
      DEFAULT_APP_RUNTIME_MANIFEST,
    );
  });

  it('ignores a non-numeric version and wrongly typed collections', () => {
    const manifest = mergeRuntimeManifest(DEFAULT_APP_RUNTIME_MANIFEST, {
      version: 'two',
      actions: 'all',
      rules: 42,
      presets: 'none',
      labels: [],
    });

    expect(manifest).toEqual(DEFAULT_APP_RUNTIME_MANIFEST);
  });
});
