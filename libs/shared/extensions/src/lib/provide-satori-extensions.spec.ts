import { Injectable, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ExtensionActionRegistry } from './extension-actions';
import { ExtensionComponentRegistry } from './extension-component-registry.service';
import { EMPTY_EXTENSION_RULE_CONTEXT, ExtensionRuleRegistry } from './extension-rules';
import {
  ExtensionSlotRegistry,
  NO_EXTENSION_SLOT_OVERRIDES,
} from './extension-slot-registry.service';
import { EXTENSION_SLOTS } from './extension-slots';
import { provideSatoriExtensions } from './provide-satori-extensions';

@Injectable({ providedIn: 'root' })
class PilotService {
  /** `false` on purpose — see the factory-form test for why `true` cannot assert. */
  isPilot(): boolean {
    return false;
  }
}

/**
 * The Layer 2 contract: one declarative object reaching four registries, applied
 * before anything can resolve a slot.
 *
 * These tests are written against the *observable* registry state rather than
 * against the provider's internals, because the thing worth pinning is what a
 * customer's contribution actually does to the surface.
 */
describe('provideSatoriExtensions', () => {
  it('reaches all four registries from one object', () => {
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.toolbar]: [{ id: 'acme.toolbar.export' }] },
          rules: { 'acme.rules.always': () => true },
          components: { 'acme.sidebar.reports': () => Promise.resolve(class {}) },
          actions: { 'acme.actions.export': { execute: () => undefined } },
        }),
      ],
    });

    expect(TestBed.inject(ExtensionSlotRegistry).registeredIds(EXTENSION_SLOTS.toolbar)).toEqual([
      'acme.toolbar.export',
    ]);
    expect(TestBed.inject(ExtensionRuleRegistry).has('acme.rules.always')).toBe(true);
    expect(TestBed.inject(ExtensionComponentRegistry).has('acme.sidebar.reports')).toBe(true);
    expect(TestBed.inject(ExtensionActionRegistry).has('acme.actions.export')).toBe(true);
  });

  it('runs the factory form in an injection context, so a rule can inject', () => {
    // The whole reason the factory form exists: the application's own
    // `hasAdministrationAccess` rule reads `AuthService`, and a plain
    // object cannot `inject()`.
    //
    // The evaluator answers **false** deliberately. An *unregistered* rule id
    // evaluates to `true` — it fails open — so asserting `true` here would pass
    // whether or not the factory ever ran. Watched: with the registration
    // sabotaged, the `true` form of this test stayed green while every other one
    // went red. `false` is the only answer a real registered evaluator can give.
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions(() => {
          const pilot = inject(PilotService);
          return { rules: { 'acme.rules.isPilot': () => pilot.isPilot() } };
        }),
      ],
    });

    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(rules.has('acme.rules.isPilot')).toBe(true);
    expect(rules.evaluate('acme.rules.isPilot', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  it('layers multiple calls, and a later id wins', () => {
    // This is the customer-overrides-packaged path. Without it, a customer
    // wanting to change when a packaged action appears would have to fork it.
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions({ rules: { 'app.rules.gate': () => true } }),
        provideSatoriExtensions({ rules: { 'app.rules.gate': () => false } }),
      ],
    });

    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(rules.evaluate('app.rules.gate', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  it('accumulates slot descriptors across layers rather than replacing them', () => {
    // Slots are the one field that must not be last-wins: a customer adding a
    // toolbar button must not silently delete the packaged ones.
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.toolbar]: [{ id: 'app.toolbar.a' }] },
        }),
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.toolbar]: [{ id: 'acme.toolbar.b' }] },
        }),
      ],
    });

    expect(TestBed.inject(ExtensionSlotRegistry).registeredIds(EXTENSION_SLOTS.toolbar)).toEqual([
      'app.toolbar.a',
      'acme.toolbar.b',
    ]);
  });

  it('declares fail-closed rules, so an unregistered one denies instead of permitting', () => {
    TestBed.configureTestingModule({
      providers: [provideSatoriExtensions({ failClosedRules: ['acme.rules.isAdmin'] })],
    });

    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(rules.isFailClosed('acme.rules.isAdmin')).toBe(true);
    // Never registered, and must not be treated as satisfied.
    expect(rules.evaluate('acme.rules.isAdmin', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  it('declares fail-closed before evaluators register, whatever order they arrive in', () => {
    // The unsafe window is the one *before* registration, so the declaration
    // cannot depend on the evaluator having arrived first.
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions({
          rules: { 'acme.rules.isAdmin': () => true },
          failClosedRules: ['acme.rules.isAdmin'],
        }),
      ],
    });

    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(rules.isFailClosed('acme.rules.isAdmin')).toBe(true);
    expect(rules.evaluate('acme.rules.isAdmin', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
  });

  it('applies contributions before a slot can be resolved', () => {
    // The ordering guarantee this provider exists for. An id registered later
    // than the first resolve is an id that flashed the wrong state.
    TestBed.configureTestingModule({
      providers: [
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.navbar]: [{ id: 'app.navbar.browse' }] },
        }),
      ],
    });

    const resolved = TestBed.inject(ExtensionSlotRegistry).resolve(
      EXTENSION_SLOTS.navbar,
      NO_EXTENSION_SLOT_OVERRIDES,
      EMPTY_EXTENSION_RULE_CONTEXT,
    );
    expect(resolved.map((entry) => entry.id)).toEqual(['app.navbar.browse']);
  });

  it('is a no-op for an empty contribution rather than throwing', () => {
    // A generated extension library starts empty, and it must boot.
    TestBed.configureTestingModule({ providers: [provideSatoriExtensions({})] });
    expect(TestBed.inject(ExtensionSlotRegistry).registeredSlotIds()).toEqual([]);
  });
});
