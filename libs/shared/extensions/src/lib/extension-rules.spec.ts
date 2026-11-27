import { TestBed } from '@angular/core/testing';

import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
  type ExtensionRuleContext,
} from './extension-rules';

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

function context(patch: Partial<ExtensionRuleContext>): ExtensionRuleContext {
  return { ...EMPTY_EXTENSION_RULE_CONTEXT, ...patch };
}

describe('ExtensionRuleRegistry', () => {
  let registry: ExtensionRuleRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionRuleRegistry);
    registry.registerRules(DOCUMENT_RULE_EVALUATORS);
  });

  describe('explicit opt-in rules (NXSAT-857)', () => {
    it('denies an unknown opt-in without changing visibility-rule behavior', () => {
      const report = vi.fn();
      expect(
        registry.evaluateOptIn('app.rules.hasMimeTyp', EMPTY_EXTENSION_RULE_CONTEXT, report),
      ).toBe(false);
      expect(report).toHaveBeenCalledWith('unknown rule "app.rules.hasMimeTyp"');
      expect(registry.evaluate('app.rules.hasMimeTyp', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
    });

    it.each([
      { type: 'core.not', parameters: ['typo'] },
      { type: 'core.some', parameters: ['core.true', 'typo'] },
      { type: 'core.every', parameters: ['core.false', 'typo'] },
      { type: 'core.not', parameters: [{ type: 'core.some', parameters: ['typo'] }] },
      { type: 'core.every', parameters: [null] },
      { type: 'core.every', parameters: 'core.true' },
    ])('does not allow invalid operands to be inverted or hidden by a composite: %j', (rule) => {
      const report = vi.fn();
      expect(
        registry.evaluateOptIn(
          rule as unknown as ExtensionRule,
          EMPTY_EXTENSION_RULE_CONTEXT,
          report,
        ),
      ).toBe(false);
      expect(report).toHaveBeenCalled();
    });

    it('still evaluates valid composites, custom rules and MIME parameters normally', () => {
      const report = vi.fn();
      registry.registerRules({
        'acme.rules.allowed': (_context, parameters) => parameters[0] === 'yes',
      });
      const rule = {
        type: 'core.every',
        parameters: [
          { type: 'core.not', parameters: ['core.false'] },
          { type: 'acme.rules.allowed', parameters: ['yes'] },
          { type: 'app.rules.hasMimeType', parameters: ['application/pdf'] },
        ],
      };
      const pdf = context({
        document: {
          ...doc(['Read']),
          properties: { 'file:content': { 'mime-type': 'application/pdf' } },
        },
      });
      expect(registry.evaluateOptIn(rule, pdf, report)).toBe(true);
      expect(report).not.toHaveBeenCalled();
    });

    it('rejects unknown references resolved by customer evaluators even if they invert the result', () => {
      registry.registerRules({
        'acme.rules.inverse': (_context, _parameters, resolve) => !resolve('typo'),
      });
      expect(
        registry.evaluateOptIn('acme.rules.inverse', EMPTY_EXTENSION_RULE_CONTEXT, vi.fn()),
      ).toBe(false);
    });

    it('rejects excessive nesting and evaluator exceptions without opening the opt-in', () => {
      registry.registerRules({
        'acme.rules.loop': (_context, _parameters, resolve) => !resolve('acme.rules.loop'),
        'acme.rules.throws': () => {
          throw new Error('broken evaluator');
        },
      });
      const report = vi.fn();
      expect(registry.evaluateOptIn('acme.rules.loop', EMPTY_EXTENSION_RULE_CONTEXT, report)).toBe(
        false,
      );
      expect(report).toHaveBeenCalledWith(expect.stringContaining('nesting limit exceeded'));
      expect(
        registry.evaluateOptIn('acme.rules.throws', EMPTY_EXTENSION_RULE_CONTEXT, report),
      ).toBe(false);
      expect(report).toHaveBeenCalledWith('rule "acme.rules.throws" could not be evaluated');
    });

    it('keeps an absent opt-in off without reporting a configuration error', () => {
      const report = vi.fn();
      expect(registry.evaluateOptIn(undefined, EMPTY_EXTENSION_RULE_CONTEXT, report)).toBe(false);
      expect(registry.evaluateOptIn(null, EMPTY_EXTENSION_RULE_CONTEXT, report)).toBe(false);
      expect(report).not.toHaveBeenCalled();
    });
  });

  it('registers the packaged document predicates under their published ids', () => {
    expect(registry.registeredRuleIds()).toEqual(
      expect.arrayContaining([
        'app.rules.canAddChildren',
        'app.rules.canManagePermissions',
        'app.rules.canPublish',
        'app.rules.canRemove',
        'app.rules.canWrite',
      ]),
    );
  });

  it('answers canPublish as Web UI: a version with WriteVersion, never on Write alone', () => {
    const publishable = (permissions: string[], extra: Partial<NuxeoDocument> = {}) =>
      context({ document: { ...doc(permissions), facets: ['Publishable'], ...extra } });
    expect(
      registry.evaluate('app.rules.canPublish', publishable(['WriteVersion'], { isVersion: true })),
    ).toBe(true);
    expect(registry.evaluate('app.rules.canPublish', publishable(['Read', 'Write']))).toBe(false);
    expect(
      registry.evaluate('app.rules.canPublish', publishable(['WriteVersion'], { isProxy: true })),
    ).toBe(false);
    expect(registry.evaluate('app.rules.canPublish', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  it('delegates to the existing permission predicate rather than reimplementing it', () => {
    expect(registry.evaluate('app.rules.canWrite', context({ document: doc(['Write']) }))).toBe(
      true,
    );
    expect(registry.evaluate('app.rules.canWrite', context({ document: doc(['Read']) }))).toBe(
      false,
    );
    expect(registry.evaluate('app.rules.canRemove', context({ document: doc(['Remove']) }))).toBe(
      true,
    );
  });

  it('gates bulk rules on every document in the selection, not just the first', () => {
    const mixed = context({ selection: [doc(['Write']), doc(['Read'])] });
    expect(registry.evaluate('app.rules.canWriteSelection', mixed)).toBe(false);

    const allWritable = context({ selection: [doc(['Write']), doc(['WriteProperties'])] });
    expect(registry.evaluate('app.rules.canWriteSelection', allWritable)).toBe(true);
  });

  it('treats an empty selection as failing the bulk rules', () => {
    expect(registry.evaluate('app.rules.canWriteSelection', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(
      false,
    );
    expect(registry.evaluate('app.rules.hasSelection', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
  });

  describe('composites', () => {
    it('evaluates core.every, core.some and core.not over nested references', () => {
      const writable = context({ document: doc(['Write', 'Remove']) });
      expect(
        registry.evaluate(
          { type: 'core.every', parameters: ['app.rules.canWrite', 'app.rules.canRemove'] },
          writable,
        ),
      ).toBe(true);

      const readOnly = context({ document: doc(['Read']) });
      expect(
        registry.evaluate(
          { type: 'core.some', parameters: ['app.rules.canWrite', 'app.rules.canRemove'] },
          readOnly,
        ),
      ).toBe(false);
      expect(
        registry.evaluate({ type: 'core.not', parameters: ['app.rules.canWrite'] }, readOnly),
      ).toBe(true);
    });

    it('makes core.not a NOR over several arguments, matching upstream', () => {
      // Upstream `@alfresco/adf-extensions` is `args.every(arg => !evaluator(...))`.
      // NAND and NOR agree on one argument and disagree from two upwards, so the
      // mixed case below is the only one that distinguishes them.
      const writeOnly = context({ document: doc(['Write']) });
      expect(
        registry.evaluate(
          { type: 'core.not', parameters: ['app.rules.canWrite', 'app.rules.canRemove'] },
          writeOnly,
        ),
      ).toBe(false);

      const readOnly = context({ document: doc(['Read']) });
      expect(
        registry.evaluate(
          { type: 'core.not', parameters: ['app.rules.canWrite', 'app.rules.canRemove'] },
          readOnly,
        ),
      ).toBe(true);
    });

    it('uses the identity element for an empty parameter list', () => {
      expect(registry.evaluate({ type: 'core.every' }, EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(registry.evaluate({ type: 'core.some' }, EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
    });

    it('ignores parameters that are not rule references', () => {
      expect(
        registry.evaluate(
          { type: 'core.every', parameters: [42, null, 'app.rules.hasDocument'] },
          context({ document: doc([]) }),
        ),
      ).toBe(true);
    });
  });

  describe('error paths', () => {
    it('fails open on an unregistered rule id, so a typo cannot strip the UI', () => {
      expect(registry.has('app.rules.definitelyNotRegistered')).toBe(false);
      expect(
        registry.evaluate('app.rules.definitelyNotRegistered', EMPTY_EXTENSION_RULE_CONTEXT),
      ).toBe(true);
    });

    it('fails closed on an unregistered security-relevant id', () => {
      // The dangerous window is registration order: `hasAdministrationAccess`
      // is contributed by the shell's APP_INITIALIZER, so between injector
      // creation and that call the id is unknown. Failing open there would
      // offer Administration to every user.
      const bare = TestBed.inject(ExtensionRuleRegistry);
      expect(bare.has('app.rules.hasAdministrationAccess')).toBe(false);
      expect(bare.isFailClosed('app.rules.hasAdministrationAccess')).toBe(true);
      expect(bare.evaluate('app.rules.hasAdministrationAccess', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(
        false,
      );
    });

    it('lets Layer 2 declare its own fail-closed ids', () => {
      registry.declareFailClosed(['acme.rules.isAuditor']);
      expect(registry.evaluate('acme.rules.isAuditor', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
      expect(registry.evaluate('acme.rules.notDeclared', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
    });

    it('treats an absent rule as no gate at all', () => {
      expect(registry.evaluate(null, EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
      expect(registry.evaluate(undefined, EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
    });

    it('hands every evaluator a list, whatever the manifest wrote as parameters', () => {
      // The manifest reader checks a rule's `type` and nothing inside it, so
      // `"parameters": "File"` arrives here whatever its declared type says, mid slot resolution.
      const received: unknown[] = [];
      registry.registerRules({
        'test.capture': (_ctx, parameters) => {
          received.push(parameters);
          return true;
        },
      });
      for (const parameters of ['File', { 0: 'File' }, 42]) {
        const malformed = { type: 'test.capture', parameters } as unknown as ExtensionRule;
        expect(() => registry.evaluate(malformed, EMPTY_EXTENSION_RULE_CONTEXT)).not.toThrow();
      }
      expect(received).toEqual([[], [], []]);

      const composite = {
        type: 'core.some',
        parameters: 'app.rules.hasDocument',
      } as unknown as ExtensionRule;
      expect(registry.evaluate(composite, EMPTY_EXTENSION_RULE_CONTEXT)).toBe(false);
    });

    it('breaks a self-referential composite instead of overflowing the stack', () => {
      registry.registerRules({
        'test.recursive': (_ctx, _params, resolve) => resolve('test.recursive'),
      });
      expect(() => registry.evaluate('test.recursive', EMPTY_EXTENSION_RULE_CONTEXT)).not.toThrow();
      expect(registry.evaluate('test.recursive', EMPTY_EXTENSION_RULE_CONTEXT)).toBe(true);
    });

    it('breaks a mutually recursive pair of composites', () => {
      registry.registerRules({
        'test.ping': (_ctx, _params, resolve) => resolve('test.pong'),
        'test.pong': (_ctx, _params, resolve) => resolve('test.ping'),
      });
      expect(() => registry.evaluate('test.ping', EMPTY_EXTENSION_RULE_CONTEXT)).not.toThrow();
    });

    it('lets a later registration replace an id, which is how Layer 2 overrides ours', () => {
      registry.registerRules({ 'app.rules.canWrite': () => false });
      expect(registry.evaluate('app.rules.canWrite', context({ document: doc(['Write']) }))).toBe(
        false,
      );
    });
  });
});
