import { TestBed } from '@angular/core/testing';

import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionActionRegistry,
  ExtensionComponentRegistry,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';

import { provideAcmeExtensions } from './extensions';

/**
 * Proves the three "add one contribution" generators registered live code.
 *
 * This is the check that catches the bug the generators shipped with: they spliced
 * their insertions inside the marker's own comment, so every registration was
 * commented out. Lint, typecheck and the library's six existing specs all passed,
 * because none of them named the new IDs. Only asking the registry does.
 */
describe('generated contributions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideAcmeExtensions()] });
  });

  it('registers the generated rule', () => {
    const rules = TestBed.inject(ExtensionRuleRegistry);
    expect(rules.has('acme.rules.isLegalTeam')).toBe(true);
    // `false`, not `true`: an unregistered ID also evaluates to `true`, so `true`
    // would pass whether or not the generator did anything.
    expect(rules.evaluate('acme.rules.isLegalTeam', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  it('registers the generated action handler', () => {
    expect(TestBed.inject(ExtensionActionRegistry).has('acme.actions.exportClaim')).toBe(true);
  });

  it('registers the generated component', () => {
    expect(TestBed.inject(ExtensionComponentRegistry).has('acme.panel.policySummary')).toBe(true);
  });
});
