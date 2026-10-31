import { TestBed } from '@angular/core/testing';

import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import { EMPTY_EXTENSION_RULE_CONTEXT, ExtensionRuleRegistry } from './extension-rules';
import {
  ExtensionSlotRegistry,
  NO_EXTENSION_SLOT_OVERRIDES,
  type ExtensionSlotOverrides,
} from './extension-slot-registry.service';
import { EXTENSION_SLOTS, type ExtensionElement } from './extension-slots';

interface TestAction extends ExtensionElement {
  readonly label?: string;
  /** Mirrors `NavItemDescriptor.labelKey`, so the override-precedence specs are type-checked. */
  readonly labelKey?: string;
  readonly rule?: string;
}

/** A toolbar descriptor as the action registry sees it — `action` names the handler to run. */
interface ActionDescriptor extends ExtensionElement {
  readonly label?: string;
  readonly action?: string;
}

function overrides(patch: Partial<ExtensionSlotOverrides>): ExtensionSlotOverrides {
  return { ...NO_EXTENSION_SLOT_OVERRIDES, ...patch };
}

/**
 * Manifest additions for one slot, typed as the concrete descriptor.
 *
 * `additions` is declared as `ExtensionElement[]`, so an inline literal carrying `action` or
 * `label` trips excess-property checking. A real manifest carries exactly those extra keys —
 * `readExtensionConfig` keeps any entry with a string id — so the test needs to express them
 * without widening the production type.
 */
function additionsFor<T extends ExtensionElement>(
  slot: (typeof EXTENSION_SLOTS)[keyof typeof EXTENSION_SLOTS],
  entries: readonly T[],
): Pick<ExtensionSlotOverrides, 'additions'> {
  return { additions: { [slot]: entries } };
}

function doc(permissions: string[]): NuxeoDocument {
  return {
    uid: 'uid-1',
    title: 'Doc',
    type: 'File',
    path: '/default-domain/doc',
    properties: {},
    contextParameters: { permissions },
  } as unknown as NuxeoDocument;
}

describe('ExtensionSlotRegistry', () => {
  let registry: ExtensionSlotRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionSlotRegistry);
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
  });

  it('resolves registered descriptors in ascending order, absent order last', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.late' },
      { id: 'app.toolbar.second', order: 20 },
      { id: 'app.toolbar.first', order: 10 },
    ]);

    expect(registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar).map((a) => a.id)).toEqual([
      'app.toolbar.first',
      'app.toolbar.second',
      'app.toolbar.late',
    ]);
  });

  it('replaces rather than duplicates when an id is registered twice', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.delete', label: 'Delete' },
    ]);
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.delete', label: 'Remove' },
    ]);

    const resolved = registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].label).toBe('Remove');
  });

  it('drops descriptors the manifest hides', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.delete' },
      { id: 'app.toolbar.download' },
    ]);

    const resolved = registry.resolve<TestAction>(
      EXTENSION_SLOTS.toolbar,
      overrides({ byId: { 'app.toolbar.delete': { visible: false } } }),
    );
    expect(resolved.map((a) => a.id)).toEqual(['app.toolbar.download']);
  });

  it('applies manifest label and order overrides', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.a', label: 'A', order: 10 },
      { id: 'app.toolbar.b', label: 'B', order: 20 },
    ]);

    const resolved = registry.resolve<TestAction>(
      EXTENSION_SLOTS.toolbar,
      overrides({
        byId: {
          'app.toolbar.a': { order: 30 },
          'app.toolbar.b': { label: 'Renamed' },
        },
      }),
    );
    expect(resolved.map((a) => [a.id, a.label])).toEqual([
      ['app.toolbar.b', 'Renamed'],
      ['app.toolbar.a', 'A'],
    ]);
  });

  it('gates a descriptor behind a rule the manifest attaches', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [{ id: 'app.toolbar.delete' }]);
    const gated = overrides({
      byId: { 'app.toolbar.delete': { rule: 'app.rules.canRemove' } },
    });

    expect(
      registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar, gated, {
        ...EMPTY_EXTENSION_RULE_CONTEXT,
        document: doc(['Read']),
      }),
    ).toEqual([]);
    expect(
      registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar, gated, {
        ...EMPTY_EXTENSION_RULE_CONTEXT,
        document: doc(['Remove']),
      }),
    ).toHaveLength(1);
  });

  it('lets an override clear a packaged rule with an explicit null', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
      { id: 'app.toolbar.delete', rule: 'app.rules.canRemove' },
    ]);

    expect(
      registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar, NO_EXTENSION_SLOT_OVERRIDES, {
        ...EMPTY_EXTENSION_RULE_CONTEXT,
        document: doc(['Read']),
      }),
    ).toEqual([]);

    expect(
      registry.resolve<TestAction>(
        EXTENSION_SLOTS.toolbar,
        overrides({ byId: { 'app.toolbar.delete': { rule: null } } }),
        { ...EMPTY_EXTENSION_RULE_CONTEXT, document: doc(['Read']) },
      ),
    ).toHaveLength(1);
  });

  it('adds manifest-contributed descriptors and patches packaged ones by id', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.browse', label: 'Browse', order: 10 },
    ]);

    const resolved = registry.resolve<TestAction>(
      EXTENSION_SLOTS.navbar,
      overrides({
        additions: {
          [EXTENSION_SLOTS.navbar]: [
            { id: 'app.navbar.browse', label: 'Repository' } as TestAction,
            { id: 'acme.navbar.contracts', label: 'Contracts', order: 5 } as TestAction,
          ],
        },
      }),
    );

    expect(resolved.map((a) => [a.id, a.label])).toEqual([
      ['acme.navbar.contracts', 'Contracts'],
      ['app.navbar.browse', 'Repository'],
    ]);
  });

  /**
   * `docs/extension-reference.md` promises that a manifest `label` wins over the packaged
   * `labelKey`. Without clearing the key, the renderer would keep preferring it and the
   * override would silently do nothing — the single most confusing way this could fail, and a
   * documented guarantee with no line enforcing it.
   */
  it('clears labelKey when a manifest supplies a literal label, so the override wins', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.browse', label: 'Browse', labelKey: 'nav.item.browse', order: 10 },
    ]);

    const [resolved] = registry.resolve<TestAction>(
      EXTENSION_SLOTS.navbar,
      overrides({ byId: { 'app.navbar.browse': { label: 'Repository' } } }),
    );

    expect(resolved.label).toBe('Repository');
    expect(resolved.labelKey).toBeUndefined();
  });

  it('leaves labelKey intact when an override does not touch the label', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.navbar, [
      { id: 'app.navbar.browse', label: 'Browse', labelKey: 'nav.item.browse', order: 10 },
    ]);

    const [resolved] = registry.resolve<TestAction>(
      EXTENSION_SLOTS.navbar,
      overrides({ byId: { 'app.navbar.browse': { order: 99 } } }),
    );

    expect(resolved.labelKey).toBe('nav.item.browse');
    expect(resolved.order).toBe(99);
  });

  it('honours the upstream `disabled` flag', () => {
    registry.register<TestAction>(EXTENSION_SLOTS.tabs, [
      { id: 'app.tabs.a' },
      { id: 'app.tabs.b', disabled: true },
    ]);
    expect(registry.resolve<TestAction>(EXTENSION_SLOTS.tabs).map((t) => t.id)).toEqual([
      'app.tabs.a',
    ]);
  });

  /**
   * The hard design constraint from the phase brief: adding a slot must not
   * require changing the existing ones.
   *
   * `'acme.reportPanel'` appears nowhere in this library — not in
   * `EXTENSION_SLOTS`, not in a union, not in a `switch`. If registration or
   * resolution had a central dispatch, this test could not pass without editing
   * it. That it passes is the proof that the addressable ceiling is backlog
   * rather than an irreversible decision.
   */
  it('supports a slot the library has never heard of, with no change to the existing ones', () => {
    const before = registry.registeredSlotIds();
    registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [{ id: 'app.toolbar.delete' }]);
    const toolbarBefore = registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar).map((a) => a.id);

    registry.register<TestAction>('acme.reportPanel', [
      { id: 'acme.reportPanel.summary', order: 10 },
      { id: 'acme.reportPanel.hidden', disabled: true },
    ]);

    // The new slot behaves exactly like a packaged one: ordering, `disabled`,
    // overrides and rule gating all work with no registration of the slot itself.
    expect(registry.resolve<TestAction>('acme.reportPanel').map((a) => a.id)).toEqual([
      'acme.reportPanel.summary',
    ]);
    expect(
      registry.resolve<TestAction>(
        'acme.reportPanel',
        overrides({ byId: { 'acme.reportPanel.summary': { visible: false } } }),
      ),
    ).toEqual([]);

    // And nothing about the existing slots changed.
    expect(registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar).map((a) => a.id)).toEqual(
      toolbarBefore,
    );
    expect(before.every((slot) => registry.registeredSlotIds().includes(slot))).toBe(true);
  });

  describe('error paths', () => {
    it('resolves an unregistered slot to an empty list rather than throwing', () => {
      expect(() => registry.resolve('slot.that.does.not.exist')).not.toThrow();
      expect(registry.resolve('slot.that.does.not.exist')).toEqual([]);
    });

    it('ignores an override for an id that is not registered', () => {
      registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [{ id: 'app.toolbar.delete' }]);
      expect(
        registry
          .resolve<TestAction>(
            EXTENSION_SLOTS.toolbar,
            overrides({ byId: { 'app.toolbar.typo': { visible: false } } }),
          )
          .map((a) => a.id),
      ).toEqual(['app.toolbar.delete']);
    });

    it('keeps a descriptor whose rule id is unknown, rather than hiding it', () => {
      registry.register<TestAction>(EXTENSION_SLOTS.toolbar, [
        { id: 'app.toolbar.delete', rule: 'acme.rules.notInThisBuild' },
      ]);
      expect(registry.resolve<TestAction>(EXTENSION_SLOTS.toolbar)).toHaveLength(1);
    });
  });

  describe('a manifest patching a packaged id', () => {
    it('cannot rebind the action while keeping the packaged label', () => {
      // The confused deputy this guards against: the user sees a star reading "Add to Favorites"
      // and deletes the document. The server authorises it, because it really is that user asking.
      registry.register<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
        { id: 'app.toolbar.addToFavorites', label: 'Add to Favorites', action: undefined },
      ]);

      const [resolved] = registry.resolve<ActionDescriptor>(
        EXTENSION_SLOTS.toolbar,
        overrides(
          additionsFor<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
            { id: 'app.toolbar.addToFavorites', action: 'app.toolbar.delete' },
          ]),
        ),
      );

      expect(resolved.label).toBe('Add to Favorites');
      expect(resolved.action).toBeUndefined();
    });

    it('still applies the presentation keys it is allowed to patch', () => {
      registry.register<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
        { id: 'app.toolbar.addToFavorites', label: 'Add to Favorites' },
      ]);

      const [resolved] = registry.resolve<ActionDescriptor>(
        EXTENSION_SLOTS.toolbar,
        overrides(
          additionsFor<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
            { id: 'app.toolbar.addToFavorites', label: 'Star it', order: 5 },
          ]),
        ),
      );

      expect(resolved.label).toBe('Star it');
      expect(resolved.order).toBe(5);
    });

    it('keeps the action on an id the manifest owns, which is how new behaviour is added', () => {
      registry.register<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [{ id: 'app.toolbar.delete' }]);

      const resolved = registry.resolve<ActionDescriptor>(
        EXTENSION_SLOTS.toolbar,
        overrides(
          additionsFor<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
            { id: 'acme.toolbar.archive', action: 'acme.actions.archive' },
          ]),
        ),
      );

      expect(resolved.find((a) => a.id === 'acme.toolbar.archive')?.action).toBe(
        'acme.actions.archive',
      );
    });

    /**
     * The contract NXSAT-760 changed, at the level it changed: `resolve` tells a packaged row from
     * a manifest-owned one by its position, because `merged` starts as the packaged list and only
     * grows by appending contributions.
     *
     * Before, `action` was withheld from this patch too, so the customer's second row lost its
     * action to their first. That protected nothing — the test above shows they may bind any
     * action to an id they own — and it is what made which-row-wins depend on the layer stack.
     */
    it('lets a later entry replace the action of an earlier one the manifest also owns', () => {
      registry.register<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [{ id: 'app.toolbar.delete' }]);

      const resolved = registry.resolve<ActionDescriptor>(
        EXTENSION_SLOTS.toolbar,
        overrides(
          additionsFor<ActionDescriptor>(EXTENSION_SLOTS.toolbar, [
            { id: 'acme.toolbar.archive', label: 'Archive', action: 'acme.actions.first' },
            { id: 'acme.toolbar.archive', label: 'Archive v2', action: 'acme.actions.second' },
          ]),
        ),
      );

      const archive = resolved.find((a) => a.id === 'acme.toolbar.archive');
      expect(archive?.label).toBe('Archive v2');
      expect(archive?.action).toBe('acme.actions.second');
      // One row, not two: the pair really did collapse rather than both surviving.
      expect(resolved.filter((a) => a.id === 'acme.toolbar.archive')).toHaveLength(1);
    });
  });
});
