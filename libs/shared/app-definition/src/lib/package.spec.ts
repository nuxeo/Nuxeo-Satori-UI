import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from './checker';
import { placeFile, validateFile, type PackageContext, type PackageFile } from './package';
import { PACKAGED_REGISTRIES, withRegistered } from './registries';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const proposal = readFileSync(join(ROOT, 'docs', 'business-apps', 'app-definition-v2.md'), 'utf8');
const show = (findings: Finding[]): string[] =>
  findings.map((finding) => `${finding.path}: ${finding.message} [${finding.kind}]`);
const empty: PackageContext = { assets: new Set() };

describe("the proposal's examples", () => {
  // Every JSON example of docs/business-apps/app-definition-v2.md is a whole file, its path given
  // after the fence's language. Together they are one package, checked as a whole. No domain
  // module exists yet, so the one the examples turn on, `cases`, is registered for them.
  const examples = new Map(
    [...proposal.matchAll(/```json ([^\n]+)\n([\s\S]*?)```/g)].map((match) => [
      match[1],
      JSON.parse(match[2]) as unknown,
    ]),
  );
  const allowList = examples.get('allow-list.json') as { operations: string[] };
  const queues = new Set(
    [...examples.keys()].flatMap((path) => /^queues\/(.+)\.json$/.exec(path)?.[1] ?? []),
  );
  const context: PackageContext = {
    app: examples.get('app.json'),
    actions: examples.get('actions.json'),
    assets: new Set(),
    queues,
  };
  const options = {
    registries: withRegistered(PACKAGED_REGISTRIES, { modules: ['cases'] }),
    operations: new Set(allowList.operations),
  };
  const files = [...examples.keys()].filter((path) => path !== 'allow-list.json');

  it('show one file of each kind', () => {
    const kinds = files.map((path) => placeFile(path)?.file.kind);
    expect(kinds.sort()).toEqual([
      'actions',
      'app',
      'home',
      'labels',
      'module',
      'navigation',
      'queue',
      'task',
    ]);
  });

  it.each(files)('%s has no finding', (path) => {
    const placed = placeFile(path);
    if (!placed) throw new Error(`${path} is not a place in a package`);
    expect(show(validateFile(placed.file, examples.get(path), context, options))).toEqual([]);
  });

  it("name only the package's queues in the menu and the home", () => {
    expect(queues).toEqual(new Set(['unassigned-claims']));
    for (const path of ['navigation.json', 'home.json']) {
      const placed = placeFile(path);
      if (!placed) throw new Error(`${path} is not a place in a package`);
      const findings = validateFile(placed.file, examples.get(path), {
        ...context,
        queues: new Set(),
      });
      expect(show(findings).length).toBeGreaterThan(0);
      for (const finding of show(findings))
        expect(finding).toMatch(/the queue "unassigned-claims" is not in the package/);
    }
  });

  it('need the allow-list: without it, every operation in actions.json is refused', () => {
    const findings = validateFile({ kind: 'actions' }, examples.get('actions.json'), context, {
      registries: options.registries,
    });
    expect(show(findings)).toEqual([
      `actions[1].operation: the operation "Payers.RequestMedicalRecords" is not on this deployment's allow-list [unknown]`,
      `actions[2].operation: the operation "Payers.AssignToCurrentUser" is not on this deployment's allow-list [unknown]`,
    ]);
  });
});

describe('where a file sits', () => {
  it('says what it is, and where its package starts', () => {
    const cases: [string, PackageFile, string][] = [
      ['app.json', { kind: 'app' }, ''],
      [
        'pkg/bundle/agentic-ui-config/actions.json',
        { kind: 'actions' },
        'pkg/bundle/agentic-ui-config',
      ],
      ['p/layouts/Claim/view.layout.json', { kind: 'layout', type: 'Claim', mode: 'view' }, 'p'],
      ['p/tasks/review.approve.layout.json', { kind: 'task', name: 'review.approve' }, 'p'],
      ['p/queues/open.json', { kind: 'queue', id: 'open' }, 'p'],
      ['p/queues/app.json', { kind: 'queue', id: 'app' }, 'p'],
      ['p\\labels\\pt-BR.json', { kind: 'labels', locale: 'pt-BR' }, 'p'],
      ['p/modules/cases.json', { kind: 'module', module: 'cases' }, 'p'],
      ['p/home.json', { kind: 'home' }, 'p'],
      ['p/navigation.json', { kind: 'navigation' }, 'p'],
      ['p/queues/home.json', { kind: 'queue', id: 'home' }, 'p'],
    ];
    for (const [path, file, root] of cases) expect(placeFile(path)).toEqual({ file, root });
  });

  it('is nothing it knows outside those places', () => {
    for (const path of [
      'bootstrap.json',
      'manifest.json',
      'p/layouts/Claim/print.layout.json',
      'p/queues/open/claims.json',
      'p/claims.json',
    ])
      expect(placeFile(path)).toBeNull();
  });
});

describe('the checks across files', () => {
  const queue = (rowActions: string[], bulkActions: string[] = []) => ({
    version: 2,
    label: 'Open claims',
    pageProvider: 'payers_open_claims',
    columns: ['claim:number'],
    rowActions,
    bulkActions,
  });
  const actions = {
    version: 2,
    actions: [
      { id: 'payers.take', label: 'Take', on: ['row'], transition: 'take' },
      { id: 'payers.close', label: 'Close', on: ['bulk'], transition: 'close' },
      { id: 'payers.approve', label: 'Approve', transition: 'approve' },
    ],
  };
  const withActions: PackageContext = { actions, assets: new Set() };

  it("let a queue use the package's own actions, where they show", () => {
    const file: PackageFile = { kind: 'queue', id: 'open' };
    expect(show(validateFile(file, queue(['payers.take'], ['payers.close']), withActions))).toEqual(
      [],
    );
    expect(
      show(validateFile(file, queue(['payers.approve', 'payers.close']), withActions)),
    ).toEqual([
      'rowActions[0]: the row action "payers.approve" is not registered [unknown]',
      'rowActions[1]: the row action "payers.close" is not registered [unknown]',
    ]);
    expect(show(validateFile(file, queue(['payers.take']), empty))).toEqual([
      'rowActions[0]: the row action "payers.take" is not registered [unknown]',
    ]);
  });

  it("refuse a module's settings that app.json does not turn on, or with no app.json", () => {
    const file: PackageFile = { kind: 'module', module: 'cases' };
    const settings = { version: 2, settings: {} };
    const registries = withRegistered(PACKAGED_REGISTRIES, { modules: ['cases'] });
    const app = { version: 2, modules: ['cases'] };
    expect(show(validateFile(file, settings, { app, assets: new Set() }, { registries }))).toEqual(
      [],
    );
    expect(
      show(
        validateFile(file, settings, { app: { version: 2 }, assets: new Set() }, { registries }),
      ),
    ).toEqual([': app.json does not turn the module "cases" on [unknown]']);
    expect(show(validateFile(file, settings, empty, { registries }))).toEqual([
      ': no app.json turns the module "cases" on [unknown]',
    ]);
  });

  it('refuse a branding image the package does not have', () => {
    const app = {
      version: 2,
      id: 'claims',
      label: 'Claims',
      packageVersion: '1.0.0',
      platform: '^0.2.0',
      groups: ['members'],
      branding: { logo: { src: 'assets/logo.svg' }, favicon: { src: 'https://example.com/i.png' } },
    };
    expect(show(validateFile({ kind: 'app' }, app, empty))).toEqual([
      'branding.logo.src: the asset "assets/logo.svg" is not in the package [unknown]',
    ]);
    const assets = new Set(['assets/logo.svg']);
    expect(show(validateFile({ kind: 'app' }, app, { assets }))).toEqual([]);
  });

  it('find a branding image as the browser resolves its address', () => {
    const app = (src: string) => ({
      version: 2,
      id: 'claims',
      label: 'Claims',
      packageVersion: '1.0.0',
      platform: '^0.2.0',
      groups: ['members'],
      branding: { logo: { src } },
    });
    const assets = new Set(['assets/logo.svg', 'assets/logo mark.svg']);
    for (const src of ['assets/./logo.svg', 'assets/logo.svg?v=2', 'assets/logo%20mark.svg'])
      expect(show(validateFile({ kind: 'app' }, app(src), { assets }))).toEqual([]);
  });

  it('refuse a queue the home or the menu names that the package does not have', () => {
    const home = {
      version: 2,
      cards: [
        { id: 'open', label: 'Open', kpi: { pageProvider: 'payers_open' }, queue: 'open' },
        { id: 'closed', queue: 'closed' },
      ],
    };
    const navigation = { version: 2, entries: [{ id: 'open', queue: 'open' }] };
    const withOpen: PackageContext = { assets: new Set(), queues: new Set(['open']) };
    expect(show(validateFile({ kind: 'home' }, home, withOpen))).toEqual([
      'cards[1].queue: the queue "closed" is not in the package: no queues/closed.json [unknown]',
    ]);
    expect(show(validateFile({ kind: 'navigation' }, navigation, withOpen))).toEqual([]);
    expect(
      show(
        validateFile({ kind: 'navigation' }, navigation, { assets: new Set(), queues: new Set() }),
      ),
    ).toEqual([
      'entries[0].queue: the queue "open" is not in the package: no queues/open.json [unknown]',
    ]);
    // Read on its own, as the app reads home.json, the queues are not known, and not checked.
    expect(show(validateFile({ kind: 'home' }, home, empty))).toEqual([]);
  });

  describe("a language's labels", () => {
    const english: PackageContext = {
      assets: new Set(),
      labels: new Set(['payers.app.claims', 'payers.queue.mine']),
    };
    const french = (labels: Record<string, string>) => ({ version: 2, labels });

    it('accept a subset of English, since each key left out falls back to English', () => {
      const file: PackageFile = { kind: 'labels', locale: 'fr' };
      expect(
        show(validateFile(file, french({ 'payers.app.claims': 'Sinistres' }), english)),
      ).toEqual([]);
      // Every key, and none at all, are subsets too.
      expect(
        show(
          validateFile(
            file,
            french({ 'payers.app.claims': 'Sinistres', 'payers.queue.mine': 'Mes sinistres' }),
            english,
          ),
        ),
      ).toEqual([]);
      expect(show(validateFile(file, french({}), english))).toEqual([]);
    });

    it('refuse a key English lacks, by its key', () => {
      const file: PackageFile = { kind: 'labels', locale: 'nb' };
      expect(
        show(
          validateFile(
            file,
            french({ 'payers.app.claims': 'Krav', 'payers.app.claimz': 'Krav' }),
            english,
          ),
        ),
      ).toEqual([
        `labels["payers.app.claimz"]: labels/en.json has no text for "payers.app.claimz": a language's labels give a text only to a key English has [unknown]`,
      ]);
    });

    it('hold a regional English to English too, and English itself to nothing', () => {
      const extra = french({ 'payers.app.claimz': 'Claims' });
      expect(show(validateFile({ kind: 'labels', locale: 'en-GB' }, extra, english))).toHaveLength(
        1,
      );
      expect(show(validateFile({ kind: 'labels', locale: 'en' }, extra, english))).toEqual([]);
    });

    it('refuse every key where the package has no English labels', () => {
      const none: PackageContext = { assets: new Set(), labels: new Set() };
      expect(
        show(validateFile({ kind: 'labels', locale: 'es' }, french({ a: 'A' }), none)),
      ).toHaveLength(1);
    });

    it('are not held to English when read without their package', () => {
      expect(
        show(validateFile({ kind: 'labels', locale: 'es' }, french({ a: 'A' }), empty)),
      ).toEqual([]);
    });
  });

  it('refuse a file whose name does not say what it needs to', () => {
    const queueFile = queue([]);
    expect(show(validateFile({ kind: 'queue', id: 'open claims' }, queueFile, empty))).toEqual([
      `: the file name is the queue's id: 1 to 64 letters, digits, ".", "_" or "-" [structure]`,
    ]);
    const form = { version: 2, cards: [{ id: 'c', fields: ['var:comment'] }] };
    expect(show(validateFile({ kind: 'task', name: 'review' }, form, empty))).toEqual([
      ': the file name is <workflow>.<step>.layout.json, each of the two letters, digits, "_" or "-" [structure]',
    ]);
    const labels = { version: 2, labels: {} };
    expect(show(validateFile({ kind: 'labels', locale: 'english' }, labels, empty))).toEqual([
      ': the file name is a language tag, such as "en" or "pt-BR" [structure]',
    ]);
    expect(
      show(validateFile({ kind: 'module', module: 'Cases' }, { version: 2, settings: {} }, empty)),
    ).toContain(
      `: the file name is the module's id: lower-case letters, digits and "-" [structure]`,
    );
  });
});
