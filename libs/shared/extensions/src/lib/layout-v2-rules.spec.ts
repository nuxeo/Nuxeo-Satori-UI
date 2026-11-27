import { TestBed } from '@angular/core/testing';

import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import { ExtensionRuleContextService } from './extension-rule-context.service';
import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRuleContext,
} from './extension-rules';

/**
 * Layout version 2's three rules on a field, a state and a group (docs/business-apps/layout-v2.md,
 * section 5). Its three date rules are `date-rules.spec.ts`'s.
 */

function claim(properties: Record<string, unknown>, state?: string): NuxeoDocument {
  return {
    uid: 'c1',
    title: 'Claim',
    type: 'Claim',
    path: '/c1',
    lastModified: '2026-11-23T00:00:00.000Z',
    properties,
    ...(state ? { state } : {}),
  };
}

function on(document: NuxeoDocument | null, groups?: readonly string[]): ExtensionRuleContext {
  const { user } = EMPTY_EXTENSION_RULE_CONTEXT;
  return {
    ...EMPTY_EXTENSION_RULE_CONTEXT,
    document,
    user:
      groups === undefined
        ? { username: user.username, isAdministrator: false }
        : { ...user, groups },
  };
}

const evaluate = (id: string, context: ExtensionRuleContext, ...parameters: unknown[]): boolean =>
  DOCUMENT_RULE_EVALUATORS[id](context, parameters, () => false);

describe('app.rules.fieldIn', () => {
  const status = { field: 'claim:status' };

  it('passes while the property holds one of the values', () => {
    const denied = on(claim({ 'claim:status': 'denied' }));
    expect(evaluate('app.rules.fieldIn', denied, status, 'denied', 'appealed')).toBe(true);
    expect(evaluate('app.rules.fieldIn', denied, status, 'approved')).toBe(false);
  });

  it('passes while any item of a list property is one of the values', () => {
    const tagged = on(claim({ 'claim:tags': ['urgent', 'fraud'] }));
    expect(evaluate('app.rules.fieldIn', tagged, { field: 'claim:tags' }, 'fraud')).toBe(true);
    expect(evaluate('app.rules.fieldIn', tagged, { field: 'claim:tags' }, 'routine')).toBe(false);
  });

  it('compares a number or a boolean written as text, as the values are', () => {
    const record = on(claim({ 'claim:amount': 5000, 'claim:urgent': true }));
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:amount' }, '5000')).toBe(true);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:urgent' }, 'true')).toBe(true);
  });

  it('matches a number as a number and a boolean as a boolean, as a manifest may write them', () => {
    const record = on(claim({ 'claim:amount': 5000, 'claim:urgent': true, 'claim:code': '5000' }));
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:amount' }, 5000)).toBe(true);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:amount' }, '5000.0')).toBe(true);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:amount' }, '50')).toBe(false);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:urgent' }, true)).toBe(true);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:urgent' }, 'false')).toBe(false);
    expect(evaluate('app.rules.fieldIn', record, { field: 'claim:code' }, 5000)).toBe(true);
  });

  it('compares a literal first parameter as it is', () => {
    expect(evaluate('app.rules.fieldIn', on(claim({})), 'gold', 'gold', 'silver')).toBe(true);
    expect(evaluate('app.rules.fieldIn', on(claim({})), 'bronze', 'gold')).toBe(false);
  });

  it('does not pass with a computation first, which this library does not evaluate', () => {
    const computed = { computed: { type: 'core.template', parameters: ['denied'] } };
    expect(evaluate('app.rules.fieldIn', on(claim({})), computed, 'denied')).toBe(false);
  });

  it('does not pass with no document, a missing property, an object value or no values', () => {
    expect(evaluate('app.rules.fieldIn', on(null), status, 'denied')).toBe(false);
    expect(evaluate('app.rules.fieldIn', on(claim({})), status, 'denied')).toBe(false);
    const nested = on(claim({ 'claim:status': { value: 'denied' } }));
    expect(evaluate('app.rules.fieldIn', nested, status, 'denied')).toBe(false);
    expect(evaluate('app.rules.fieldIn', on(claim({ 'claim:status': 'denied' })), status)).toBe(
      false,
    );
  });
});

describe('app.rules.inState', () => {
  it("passes while the record's lifecycle state is one of the parameters", () => {
    expect(evaluate('app.rules.inState', on(claim({}, 'approved')), 'approved', 'closed')).toBe(
      true,
    );
    expect(evaluate('app.rules.inState', on(claim({}, 'project')), 'approved')).toBe(false);
  });

  it('does not pass with no document, no state or no parameters', () => {
    expect(evaluate('app.rules.inState', on(null), 'approved')).toBe(false);
    expect(evaluate('app.rules.inState', on(claim({})), 'approved')).toBe(false);
    expect(evaluate('app.rules.inState', on(claim({}, 'approved')))).toBe(false);
  });
});

describe('app.rules.inGroup', () => {
  it('passes while the user is in one of the groups', () => {
    const staff = on(claim({}), ['members', 'member-services']);
    expect(evaluate('app.rules.inGroup', staff, 'member-services')).toBe(true);
    expect(evaluate('app.rules.inGroup', staff, 'adjusters', 'members')).toBe(true);
    expect(evaluate('app.rules.inGroup', staff, 'adjusters')).toBe(false);
  });

  it('does not pass with no group known, a context built without groups, or no parameters', () => {
    expect(evaluate('app.rules.inGroup', on(claim({}), []), 'member-services')).toBe(false);
    expect(evaluate('app.rules.inGroup', on(claim({})), 'member-services')).toBe(false);
    expect(evaluate('app.rules.inGroup', on(claim({}), ['member-services']))).toBe(false);
  });
});

describe('failing closed', () => {
  /** It keeps a field from users outside a group, so unknown it denies, as isPowerUser does. */
  it('denies app.rules.inGroup while it is not registered', () => {
    const registry = TestBed.inject(ExtensionRuleRegistry);
    expect(registry.has('app.rules.inGroup')).toBe(false);
    const rule = { type: 'app.rules.inGroup', parameters: ['member-services'] };
    expect(registry.evaluate(rule, on(claim({}), ['member-services']))).toBe(false);
  });
});

describe('the rule context', () => {
  it('carries the groups set on it', () => {
    const service = TestBed.inject(ExtensionRuleContextService);
    expect(service.context().user.groups).toEqual([]);
    service.groups.set(['members', 'member-services']);
    expect(service.context().user.groups).toEqual(['members', 'member-services']);
  });
});

describe("a linked record's property (layout-v2.md, section 5)", () => {
  const TITLE = 'f027e437-0795-4ec7-8e6c-4bb1dd4c75cc';
  const status = { field: 'deal:title', types: ['Title'], show: 'title:status' };
  const openedOn = { field: 'deal:title', types: ['Title'], show: 'title:openedOn' };
  /** What the record page read of the linked titles, as the reader: one title, by its id. */
  const read: Record<string, Record<string, unknown>> = {
    [TITLE]: { 'title:status': 'Awaiting lien release', 'title:openedOn': '2026-10-01' },
  };
  const linked = (id: string, xpath: string): unknown => read[id]?.[xpath];
  const deal = (title: unknown): ExtensionRuleContext => ({
    ...on(claim({ 'deal:title': title, 'title:status': 'Issued' })),
    linked,
    today: new Date('2026-11-27T12:00:00Z'),
    timeZone: '+0000',
  });

  it("compares the linked record's property, not the open record's", () => {
    expect(evaluate('app.rules.fieldIn', deal(TITLE), status, 'Awaiting lien release')).toBe(true);
    // The open record's own title:status is not read for it.
    expect(evaluate('app.rules.fieldIn', deal(TITLE), status, 'Issued')).toBe(false);
  });

  it('reads a linked date as the date rules read any', () => {
    expect(evaluate('app.rules.dateAfter', deal(TITLE), 'today', openedOn, 30)).toBe(true);
    expect(evaluate('app.rules.dateAfter', deal(TITLE), 'today', openedOn, 60)).toBe(false);
    expect(evaluate('app.rules.datePassed', deal(TITLE), openedOn)).toBe(true);
    expect(evaluate('app.rules.dateWithin', deal(TITLE), openedOn, 5)).toBe(false);
  });

  it('reads no value for a record the page did not read, or the reader may not', () => {
    const unread = 'a72723a2-73cf-4d88-8804-5b58a360ab3e';
    expect(evaluate('app.rules.fieldIn', deal(unread), status, 'Awaiting lien release')).toBe(
      false,
    );
    expect(evaluate('app.rules.datePassed', deal(unread), openedOn)).toBe(false);
  });

  it('reads no value from a reference holding no id, or a list of them', () => {
    for (const title of [undefined, null, '', [TITLE], 42])
      expect(evaluate('app.rules.fieldIn', deal(title), status, 'Awaiting lien release')).toBe(
        false,
      );
  });

  it('reads no value where the context gives no linked records: every slot but the record page', () => {
    const elsewhere: ExtensionRuleContext = { ...deal(TITLE), linked: undefined };
    expect(evaluate('app.rules.fieldIn', elsewhere, status, 'Awaiting lien release')).toBe(false);
    expect(evaluate('app.rules.datePassed', elsewhere, openedOn)).toBe(false);
  });

  it('still reads a plain property as before', () => {
    expect(evaluate('app.rules.fieldIn', deal(TITLE), { field: 'title:status' }, 'Issued')).toBe(
      true,
    );
  });
});
