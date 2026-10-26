import { TestBed } from '@angular/core/testing';

import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionComponentRegistry,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
} from '@nuxeo/satori-platform/extensions';

import { ACME_EXTENSIONS_EXTENSION_IDS, provideAcmeExtensions } from './extensions';

/**
 * Proves this library actually registers what it claims to.
 *
 * Written against the **observable registry state**, not against the provider's
 * internals, because the failure worth catching is a library that declares
 * descriptors nothing renders. Asserting "the function was called" would not catch
 * it; asserting "the ID is in the registry" does.
 *
 * Keep these tests when you replace the generated contributions with your own —
 * change the expected IDs, not the shape of the assertions.
 */
describe('provideAcmeExtensions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideAcmeExtensions()] });
  });

  it('registers its navbar descriptor', () => {
    expect(TestBed.inject(ExtensionSlotRegistry).registeredIds(EXTENSION_SLOTS.navbar)).toEqual([
      ...ACME_EXTENSIONS_EXTENSION_IDS.navbar,
    ]);
  });

  it('registers its rule, its action handler and its component', () => {
    expect(TestBed.inject(ExtensionRuleRegistry).has(ACME_EXTENSIONS_EXTENSION_IDS.rules[0])).toBe(
      true,
    );
    expect(
      TestBed.inject(ExtensionActionRegistry).has(ACME_EXTENSIONS_EXTENSION_IDS.actions[0]),
    ).toBe(true);
    expect(
      TestBed.inject(ExtensionComponentRegistry).has(ACME_EXTENSIONS_EXTENSION_IDS.components[0]),
    ).toBe(true);
  });

  it('evaluates its rule through the registered evaluator, not the fail-open default', () => {
    // Asserts **false**, and that is deliberate. An *unregistered* rule ID
    // evaluates to `true` — rules fail open so a manifest typo cannot strip
    // working actions out of the UI. So a test expecting `true` would pass even
    // if registration never happened. `EMPTY_EXTENSION_RULE_CONTEXT` has a null
    // username, and the generated rule requires one, so `false` is an answer only
    // a genuinely registered evaluator can give.
    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(
      rules.evaluate(ACME_EXTENSIONS_EXTENSION_IDS.rules[0], EMPTY_EXTENSION_RULE_CONTEXT),
    ).toBe(false);
  });

  it('declares its rule fail-closed', () => {
    // A rule gating a surface must deny while unregistered, not permit. Note this
    // is a UI affordance only — Nuxeo still enforces the real permission.
    expect(
      TestBed.inject(ExtensionRuleRegistry).isFailClosed(ACME_EXTENSIONS_EXTENSION_IDS.rules[0]),
    ).toBe(true);
  });

  it('keeps the exported ID list in step with what is registered', () => {
    // Stops the documented contract drifting from the code. If you add a
    // contribution and forget the ID list, this fails.
    const slots = TestBed.inject(ExtensionSlotRegistry);
    const declared = [...ACME_EXTENSIONS_EXTENSION_IDS.navbar].sort();
    const registered = [...slots.registeredIds(EXTENSION_SLOTS.navbar)].sort();
    expect(registered).toEqual(declared);
  });

  it('resolves the descriptor for a signed-in user', () => {
    // End to end: the rule permits, so the entry survives resolution. Without
    // this, a rule-gated descriptor that is never resolvable would still pass
    // every test above.
    const resolved = TestBed.inject(ExtensionSlotRegistry).resolve(
      EXTENSION_SLOTS.navbar,
      { byId: {}, additions: {} },
      { ...EMPTY_EXTENSION_RULE_CONTEXT, user: { username: 'someone', isAdministrator: false } },
    );
    expect(resolved.map((entry) => entry.id)).toEqual([...ACME_EXTENSIONS_EXTENSION_IDS.navbar]);
  });

  it('lazily loads the acme panel component when requested', async () => {
    // Lines 106: dynamic import for acme-panel component - tests the lazy loader function
    const components = TestBed.inject(ExtensionComponentRegistry);
    expect(components.has(ACME_EXTENSIONS_EXTENSION_IDS.components[0])).toBe(true);

    // Resolve the component by ID - this triggers the dynamic import at line 106
    const componentType = await components.resolve(ACME_EXTENSIONS_EXTENSION_IDS.components[0]);
    expect(componentType).toBeDefined();
    // Angular may append numbers during compilation, so just check it starts with the expected name
    expect(componentType?.name).toMatch(/^AcmePanelComponent/);
  });

  it('lazily loads the policy summary component when requested', async () => {
    // Lines 108: dynamic import for policy-summary component
    const components = TestBed.inject(ExtensionComponentRegistry);
    expect(components.has('acme.panel.policySummary')).toBe(true);

    // Resolve the component by ID - this triggers the dynamic import at line 108
    const componentType = await components.resolve('acme.panel.policySummary');
    expect(componentType).toBeDefined();
    // Angular may append numbers during compilation, so just check it starts with the expected name
    expect(componentType?.name).toMatch(/^PolicySummaryComponent/);
  });
});
