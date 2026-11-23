import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CORE_RULE_EVALUATORS,
  DOCUMENT_RULE_EVALUATORS,
  PACKAGED_NAV_ITEMS,
} from '@nuxeo/satori-platform/extensions';

import { readNavigation, type NavigationRegistered, type ReadNavigation } from './navigation-file';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'app-definition-v2.md'), 'utf8');
/** The proposal's `navigation.json`, as the app is to read it. */
const example = JSON.parse(
  /```json navigation\.json\n([\s\S]*?)```/.exec(proposal)?.[1] ?? 'null',
) as Record<string, unknown>;

/** What the app registers: the core and document rules, and the platform's menu entries. */
const REGISTERED: NavigationRegistered = {
  rules: [...Object.keys(CORE_RULE_EVALUATORS), ...Object.keys(DOCUMENT_RULE_EVALUATORS)],
  pages: PACKAGED_NAV_ITEMS.map((item) => item.id),
};

const read = (entries: unknown[], keys: Record<string, unknown> = {}, registered = REGISTERED) =>
  readNavigation({ version: 2, entries, ...keys }, registered);
const ids = (result: ReadNavigation): string[] =>
  'entries' in result ? result.entries.map((entry) => entry.id) : ['refused'];
const queue = (id: string, keys: Record<string, unknown> = {}) => ({
  id,
  queue: 'unassigned-claims',
  ...keys,
});

describe('readNavigation', () => {
  it("reads the proposal's menu whole: the home, a queue and two platform pages", () => {
    const result = readNavigation(example, REGISTERED);
    expect('entries' in result && result.problems).toEqual([]);
    expect('entries' in result && result.entries).toEqual([
      {
        id: 'home',
        label: 'Home',
        labelKey: null,
        icon: 'home',
        order: null,
        queue: null,
        page: 'home',
        visibleWhen: null,
      },
      {
        id: 'unassigned',
        label: null,
        labelKey: null,
        icon: 'inbox',
        order: null,
        queue: 'unassigned-claims',
        page: null,
        visibleWhen: {
          type: 'app.rules.inGroup',
          parameters: ['claims-adjusters', 'claims-supervisors'],
        },
      },
      expect.objectContaining({ id: 'tasks', page: 'app.navbar.tasks' }),
      expect.objectContaining({ id: 'search', page: 'app.navbar.search' }),
    ]);
  });

  it("reads the development server's sample whole", () => {
    const sample = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '..', '..', 'samples', 'documents', 'navigation.json'),
        'utf8',
      ),
    );
    const result = readNavigation(sample, REGISTERED);
    expect('entries' in result && result.problems).toEqual([]);
    expect(ids(result)).toEqual(['home', 'documents', 'tasks']);
  });

  it('refuses the whole menu on a structure finding, so the platform shows its own', () => {
    expect(ids(read([{ id: 'a', queue: 'q', page: 'home' }]))).toEqual(['refused']);
    expect(ids(readNavigation({ version: 1, entries: [] }, REGISTERED))).toEqual(['refused']);
    expect(ids(read([{ id: 'a', page: 'home' }]))).toEqual(['refused']);
  });

  it('leaves out an entry a finding names, and ignores a key of its own', () => {
    const result = read(
      [
        queue('a', { colour: 'red' }),
        { id: 'b', label: 'Gone', page: 'acme.navbar.missing' },
        queue('c', { visibleWhen: { type: 'app.rules.inGroup', parameters: [{ field: 'x:y' }] } }),
        queue('d'),
      ],
      { theme: 'dark' },
    );
    expect(ids(result)).toEqual(['d']);
    expect('entries' in result && result.problems).toEqual([
      expect.stringMatching(/^theme: .*; ignored$/),
      expect.stringMatching(/^entries\[0\]\.colour: .*; entries\[0\] left out$/),
      expect.stringMatching(/^entries\[1\]\.page: .*; entries\[1\] left out$/),
      expect.stringMatching(/^entries\[2\]\.visibleWhen.*; entries\[2\] left out$/),
    ]);
  });

  it("knows a page a manifest or Layer 2 code registers, as this build's menu does", () => {
    const entries = [{ id: 'reports', label: 'Reports', page: 'acme.navbar.reports' }];
    expect(ids(read(entries))).toEqual([]);
    expect(
      ids(
        read(entries, {}, { ...REGISTERED, pages: [...REGISTERED.pages, 'acme.navbar.reports'] }),
      ),
    ).toEqual(['reports']);
  });

  it('leaves out an entry whose rule this build cannot answer, rather than show it to everyone', () => {
    const inGroup = { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] };
    // Registered here: the entry stays.
    expect(ids(read([queue('a', { visibleWhen: inGroup })]))).toEqual(['a']);
    // A build made without the document rules: the registry would pass it.
    const result = read(
      [queue('a', { visibleWhen: inGroup })],
      {},
      {
        ...REGISTERED,
        rules: Object.keys(CORE_RULE_EVALUATORS),
      },
    );
    expect(ids(result)).toEqual([]);
    expect('entries' in result && result.problems).toEqual([
      'entries[0].visibleWhen names the rule "app.rules.inGroup", which this build does not register; entries[0] left out',
    ]);
  });
});
