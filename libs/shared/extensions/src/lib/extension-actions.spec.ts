import { TestBed } from '@angular/core/testing';

import {
  ExtensionActionRegistry,
  type ExtensionActionDescriptor,
  type ExtensionActionRegistration,
} from './extension-actions';
import { EMPTY_EXTENSION_RULE_CONTEXT } from './extension-rules';

function descriptor(patch: Partial<ExtensionActionDescriptor>): ExtensionActionDescriptor {
  return { id: 'app.toolbar.delete', label: 'Delete', ...patch };
}

describe('ExtensionActionRegistry', () => {
  let registry: ExtensionActionRegistry;
  let calls: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionActionRegistry);
    calls = [];
  });

  it('runs the handler registered under the descriptor id', () => {
    registry.register({ 'app.toolbar.delete': { execute: () => calls.push('delete') } });
    expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
    expect(calls).toEqual(['delete']);
  });

  it('prefers an explicit action id, so two descriptors can share one handler', () => {
    registry.register({ 'app.actions.download': { execute: () => calls.push('download') } });
    registry.execute(
      descriptor({ id: 'app.toolbar.export', action: 'app.actions.download' }),
      EMPTY_EXTENSION_RULE_CONTEXT,
    );
    registry.execute(
      descriptor({ id: 'app.contextMenu.export', action: 'app.actions.download' }),
      EMPTY_EXTENSION_RULE_CONTEXT,
    );
    expect(calls).toEqual(['download', 'download']);
  });

  it('passes the rule context through to the handler', () => {
    let seen: string | null = null;
    registry.register({
      'app.toolbar.delete': { execute: (context) => (seen = context.user.username) },
    });
    registry.execute(descriptor({}), {
      ...EMPTY_EXTENSION_RULE_CONTEXT,
      user: { username: 'jdoe', isAdministrator: false },
    });
    expect(seen).toBe('jdoe');
  });

  it('lets a later registration replace a packaged handler', () => {
    registry.register({ 'app.toolbar.delete': { execute: () => calls.push('packaged') } });
    registry.register({ 'app.toolbar.delete': { execute: () => calls.push('acme') } });
    registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT);
    expect(calls).toEqual(['acme']);
  });

  it('lists registered ids for the reference doc', () => {
    registry.register({
      'app.toolbar.delete': { execute: () => undefined },
    });
    registry.registerPackaged({
      'app.toolbar.edit': { execute: () => undefined },
      'app.toolbar.delete': { execute: () => undefined },
    });
    expect(registry.registeredActionIds()).toEqual(['app.toolbar.delete', 'app.toolbar.edit']);
  });

  describe('packaged handlers versus customer handlers', () => {
    /** What a packaged surface registers for itself, and withdraws when it unmounts. */
    function packaged(): ExtensionActionRegistration {
      return registry.registerPackaged({
        'app.toolbar.delete': { execute: () => calls.push('packaged') },
      });
    }

    /** What a customer library registers under the same published id. */
    function customer(): ExtensionActionRegistration {
      return registry.register({
        'app.toolbar.delete': { execute: () => calls.push('acme') },
      });
    }

    it('answers with the packaged handler when no customer has registered anything', () => {
      packaged();
      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(calls).toEqual(['packaged']);
    });

    it('prefers the customer handler regardless of which registered first', () => {
      customer();
      packaged();
      registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT);

      // A customer registers from an APP_INITIALIZER, so a component registering in
      // ngOnInit always registers *later*. Precedence cannot be arrival order here.
      expect(calls).toEqual(['acme']);
    });

    it('leaves the customer handler answering after the packaged one is withdrawn', () => {
      customer();
      const mounted = packaged();

      mounted.unregister();

      expect(registry.has('app.toolbar.delete')).toBe(true);
      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(calls).toEqual(['acme']);
    });

    it('falls back to the packaged handler when the customer withdraws theirs', () => {
      packaged();
      const override = customer();

      override.unregister();

      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(calls).toEqual(['packaged']);
    });

    it('keeps the newest customer handler when an older one is withdrawn', () => {
      const first = registry.register({
        'app.toolbar.delete': { execute: () => calls.push('first') },
      });
      registry.register({ 'app.toolbar.delete': { execute: () => calls.push('second') } });

      first.unregister();

      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(calls).toEqual(['second']);
    });
  });

  describe('error paths', () => {
    it('is inert rather than throwing when nothing is registered under the id', () => {
      expect(registry.has('app.toolbar.delete')).toBe(false);
      expect(() => registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).not.toThrow();
      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
    });

    it('stops running a handler after its registration is withdrawn', () => {
      const registration = registry.register({
        'app.toolbar.delete': { execute: () => calls.push('delete') },
      });

      registration.unregister();

      expect(registry.has('app.toolbar.delete')).toBe(false);
      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
      expect(calls).toEqual([]);
    });

    it('ignores a second withdrawal of the same registration', () => {
      const registration = registry.register({
        'app.toolbar.delete': { execute: () => calls.push('first') },
      });
      registration.unregister();
      registry.register({ 'app.toolbar.delete': { execute: () => calls.push('second') } });

      registration.unregister();

      // A stale handle must not delete whatever took the id over afterwards.
      expect(registry.execute(descriptor({}), EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(calls).toEqual(['second']);
    });
  });
});

describe('ExtensionActionRegistry.runsOverWholeQuery', () => {
  it('answers what the handler that runs the id declares, and false for none', () => {
    const registry = new ExtensionActionRegistry();
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(false);
    registry.register({ 'app.bulkActions.delete': { execute: () => undefined, wholeQuery: true } });
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(true);
    // A customer's replacement answers now, and it does not declare it.
    const replacement = registry.register({
      'app.bulkActions.delete': { execute: () => undefined },
    });
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(false);
    replacement.unregister();
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(true);
  });

  it('is outranked by a customer handler over a packaged one that declares it', () => {
    const registry = new ExtensionActionRegistry();
    registry.registerPackaged({
      'app.bulkActions.delete': { execute: () => undefined, wholeQuery: true },
    });
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(true);
    registry.register({ 'app.bulkActions.delete': { execute: () => undefined } });
    expect(registry.runsOverWholeQuery('app.bulkActions.delete')).toBe(false);
  });
});
