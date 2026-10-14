import { TestBed } from '@angular/core/testing';

import type { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import { SURFACE_RULE_EVALUATORS } from './surface-rules';
import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
  type ExtensionRuleContext,
} from './extension-rules';

function doc(type: string, facets?: string[]): NuxeoDocument {
  return {
    uid: 'uid-1',
    title: 'Doc',
    type,
    path: '/default-domain/doc',
    lastModified: '2026-10-06T00:00:00.000Z',
    properties: {},
    ...(facets ? { facets } : {}),
  };
}

const on = (document: NuxeoDocument | null): ExtensionRuleContext => ({
  ...EMPTY_EXTENSION_RULE_CONTEXT,
  document,
});
const isType = (...parameters: unknown[]): ExtensionRule => ({
  type: 'app.rules.isType',
  parameters,
});
const hasFacet = (...parameters: unknown[]): ExtensionRule => ({
  type: 'app.rules.hasFacet',
  parameters,
});
/** `"parameters": "File"`, brackets forgotten — manifest JSON reaches the registry unvalidated. */
const notAList = (type: string, parameters: unknown): ExtensionRule =>
  ({ type, parameters }) as unknown as ExtensionRule;

describe('document type rules', () => {
  let registry: ExtensionRuleRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionRuleRegistry);
    registry.registerRules(DOCUMENT_RULE_EVALUATORS);
    registry.registerRules(SURFACE_RULE_EVALUATORS);
  });

  describe('app.rules.isType', () => {
    it('is true when the focused document is one of the listed types', () => {
      expect(registry.evaluate(isType('Case', 'Claim'), on(doc('Claim')))).toBe(true);
    });

    it('is false for any other type, and matches case-sensitively', () => {
      expect(registry.evaluate(isType('Case', 'Claim'), on(doc('Member')))).toBe(false);
      expect(registry.evaluate(isType('claim'), on(doc('Claim')))).toBe(false);
    });

    it('is false with no document in focus', () => {
      expect(registry.evaluate(isType('File'), on(null))).toBe(false);
    });

    // Error path: a misconfigured rule hides its entry rather than showing it everywhere.
    it('is false with no parameters, and ignores non-string ones', () => {
      expect(registry.evaluate('app.rules.isType', on(doc('File')))).toBe(false);
      expect(registry.evaluate(isType(), on(doc('File')))).toBe(false);
      expect(registry.evaluate(isType(42, null, { type: 'File' }), on(doc('File')))).toBe(false);
      expect(registry.evaluate(isType(42, 'File'), on(doc('File')))).toBe(true);
      expect(registry.evaluate(notAList('app.rules.isType', 'File'), on(doc('File')))).toBe(false);
    });
  });

  describe('app.rules.hasFacet', () => {
    it('is true when the document carries any listed facet', () => {
      expect(
        registry.evaluate(hasFacet('Versionable', 'Folderish'), on(doc('Folder', ['Folderish']))),
      ).toBe(true);
    });

    it('is false when it carries none of them, or reports no facets at all', () => {
      expect(registry.evaluate(hasFacet('Folderish'), on(doc('File', ['Versionable'])))).toBe(
        false,
      );
      expect(registry.evaluate(hasFacet('Folderish'), on(doc('File')))).toBe(false);
    });

    it('is false with no document in focus', () => {
      expect(registry.evaluate(hasFacet('Folderish'), on(null))).toBe(false);
    });

    // Error path: same contract as isType.
    it('is false with no parameters, and ignores non-string ones', () => {
      const folder = on(doc('Folder', ['Folderish']));
      expect(registry.evaluate('app.rules.hasFacet', folder)).toBe(false);
      expect(registry.evaluate(hasFacet(true, ['Folderish']), folder)).toBe(false);
      expect(registry.evaluate(notAList('app.rules.hasFacet', 'Folderish'), folder)).toBe(false);
    });
  });

  describe('app.rules.isNote', () => {
    const withFlags = (document: NuxeoDocument | null, flags: Record<string, boolean>) => ({
      ...on(document),
      flags,
    });

    it.each<[string, NuxeoDocument | null]>([
      ['a Note', doc('Note')],
      ['a File', doc('File')],
      ['a type named like it in another case', doc('note')],
      ['a subtype-looking name', doc('NoteTemplate')],
      ['no document', null],
    ])('answers as isType(["Note"]) for %s', (_label, document) => {
      expect(registry.evaluate('app.rules.isNote', on(document))).toBe(
        registry.evaluate(isType('Note'), on(document)),
      );
    });

    it('is true for a Note and false otherwise', () => {
      expect(registry.evaluate('app.rules.isNote', on(doc('Note')))).toBe(true);
      expect(registry.evaluate('app.rules.isNote', on(doc('File')))).toBe(false);
      expect(registry.evaluate('app.rules.isNote', on(null))).toBe(false);
    });

    // The rule used to read `flags.note`; a stale or forged flag must not decide it now.
    it('reads the document, not a note flag', () => {
      expect(registry.evaluate('app.rules.isNote', withFlags(doc('File'), { note: true }))).toBe(
        false,
      );
      expect(registry.evaluate('app.rules.isNote', withFlags(doc('Note'), {}))).toBe(true);
    });
  });

  it('composes inside core.every, core.some and core.not like any other rule', () => {
    const claim = on(doc('Claim', ['Versionable']));

    expect(
      registry.evaluate(
        { type: 'core.every', parameters: [isType('Claim'), hasFacet('Versionable')] },
        claim,
      ),
    ).toBe(true);
    expect(
      registry.evaluate(
        { type: 'core.some', parameters: [isType('Case'), hasFacet('Versionable')] },
        claim,
      ),
    ).toBe(true);
    expect(registry.evaluate({ type: 'core.not', parameters: [isType('Claim')] }, claim)).toBe(
      false,
    );
    expect(registry.evaluate({ type: 'core.not', parameters: [isType('Case')] }, claim)).toBe(true);
  });
});

describe('app.rules.hasFile', () => {
  let registry: ExtensionRuleRegistry;
  const withContent = (content: unknown): NuxeoDocument => ({
    ...doc('File'),
    properties: { 'file:content': content },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ExtensionRuleRegistry);
    registry.registerRules(DOCUMENT_RULE_EVALUATORS);
  });

  it('is true for a document holding a main file, whatever its facets', () => {
    // A Picture holds a file and has no `Downloadable` facet, which is why the facet is not the test.
    const picture = { ...withContent({ name: 'photo.jpg' }), type: 'Picture', facets: ['Picture'] };
    expect(registry.evaluate('app.rules.hasFile', on(picture))).toBe(true);
  });

  it.each([
    ['no file', withContent(null)],
    ['no file property at all', doc('Note')],
    ['a string where the blob should be', withContent('photo.jpg')],
    ['a list where the blob should be', withContent([{ name: 'photo.jpg' }])],
  ])('is false with %s', (_case, document) => {
    expect(registry.evaluate('app.rules.hasFile', on(document))).toBe(false);
  });

  it('is false with no document in focus', () => {
    expect(registry.evaluate('app.rules.hasFile', on(null))).toBe(false);
  });
});
