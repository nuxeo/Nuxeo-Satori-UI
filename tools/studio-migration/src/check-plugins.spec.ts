/**
 * Check 9, on the made-up corpus's two custom elements (`testing/m3-corpus.ts`) and the two plugins
 * the code track wrote for them, `libs/extensions/acme-claim-exposure` and `acme-claim-escalate`:
 * the plugins as they are pass what runs here, and each of check 9's controls (`PLUGIN_MUTATIONS`)
 * fails it. The controls that check 9 sees only by running a plugin are run, each from a copy of the
 * plugin's files with the control applied, as `check --run-plugins` runs one.
 *
 * Lint, build and typecheck run through Nx in `check --run-plugins`, and in CI as the repository's
 * gates; they are too slow for this spec, so it holds check 9 to a failing gate as it reports one.
 */
import { loadCatalogue } from './catalogue';
import { checkPlugins, componentOf } from './check-plugins';
import { convert } from './convert';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MutationError, PLUGIN_MUTATIONS, type PluginSubject } from './mutations';
import { observedProblem } from './observed';
import { runPlugin, type PluginRun } from './plugin-run';
import { scanConfiguration, scanPlugin, scanPublicApi } from './plugin-scan';
import { readPlugins, WORKSPACE, type PluginSource } from './plugins';
import { readStudioPackage } from './studio-package';
import { M3_ELEMENTS, M3_OBSERVED, m3CorpusFiles } from './testing/m3-corpus';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

function prepare(
  bundle: Record<string, string>,
): HarnessInput & { plugins: NonNullable<HarnessInput['plugins']> } {
  const pkg = readStudioPackage(syntheticPackage({ bundle }));
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convert(pkg, read, catalogue, { allowList: ALLOW_LIST }),
    plugins: readPlugins(WORKSPACE, read, { observed: M3_OBSERVED }),
  };
}

const m3 = prepare(m3CorpusFiles());
const subject: PluginSubject = {
  conversion: m3.conversion,
  plugins: m3.plugins.sources,
  source: m3,
};
const withSubject = (broken: PluginSubject, runs?: Record<string, PluginRun>): HarnessInput => ({
  ...m3,
  conversion: broken.conversion,
  plugins: { ...m3.plugins, sources: broken.plugins, ...(runs ? { runs } : {}) },
});

describe('check 9, on what needs no run', () => {
  it('reads the two plugins the code track wrote, one for each element', () => {
    expect(m3.plugins.sources.map((source) => [source.element, source.library])).toEqual(
      M3_ELEMENTS.map((element) => [element, `libs/extensions/${element}`]),
    );
    expect(m3.plugins.template?.path).toBe('apps/nuxeo-satori-template/src/app/app.config.ts');
    expect(observedProblem(M3_OBSERVED)).toBeNull();
  });

  it('finds nothing wrong in them, and runs in part until they are run', () => {
    const result = runCheck(m3, 9);
    expect(result?.findings).toEqual([]);
    expect(result?.status).toBe('partial');
    expect(result?.reason).toContain("acme-claim-exposure's tests, gates and values were not run");
  });

  it('finds each element’s interface on its plugin', () => {
    for (const source of m3.plugins.sources)
      expect(componentOf(source, source.element)).not.toBeNull();
    const escalate = m3.plugins.sources.find((source) => source.element === 'acme-claim-escalate');
    expect(componentOf(escalate as PluginSource, 'acme-claim-escalate')).toEqual({
      path: 'src/lib/acme-claim-escalate/acme-claim-escalate.ts',
      inputs: ['document', 'reason'],
      outputs: ['claimEscalated', 'documentUpdated', 'notify'],
    });
  });

  it('passes a package with no custom element, its configuration holding no code', () => {
    for (const corpus of [prepare({}), prepare(m2CorpusFiles())]) {
      const result = runCheck(corpus, 9);
      expect([result?.status, result?.findings]).toEqual(['pass', []]);
    }
  });

  it('waits, rather than failing, for a plugin not written yet', () => {
    const result = runCheck({ ...m3, plugins: { ...m3.plugins, sources: [] } }, 9);
    expect(result?.status).toBe('partial');
    expect(result?.reason).toContain(
      'the plugin of acme-claim-exposure, libs/extensions/acme-claim-exposure, is not written yet',
    );
    expect(runCheck({ ...m3, plugins: undefined }, 9)?.reason).toContain(
      'the plugins were not read',
    );
  });

  it('keeps a plugin that passes check 9 a proposal, which stands in the way until a person accepts it', () => {
    const entries = m3.conversion.report.constructs.filter(
      (entry) => entry.kind === 'custom-element',
    );
    expect(entries.map((entry) => entry.outcome)).toEqual(['proposed', 'proposed']);
    expect(runHarness(m3).blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\d+ proposals wait for a person to accept or reject them$/),
      ]),
    );
  });

  it('holds a run to a gate that fails, and to tests left unwritten', () => {
    const passing: PluginRun = {
      tests: { passed: 8, failed: [], unwritten: [] },
      gates: {
        lint: { passed: true, output: '' },
        build: { passed: false, output: 'error TS2322: Type is not assignable' },
      },
    };
    const runs = Object.fromEntries(M3_ELEMENTS.map((element) => [element, passing]));
    const findings = checkPlugins({ ...m3, plugins: { ...m3.plugins, runs } }).findings;
    expect(findings).toContain(
      'libs/extensions/acme-claim-exposure fails build: error TS2322: Type is not assignable',
    );
    const unwritten = checkPlugins({
      ...m3,
      plugins: {
        ...m3.plugins,
        runs: { 'acme-claim-exposure': { tests: { passed: 0, failed: [], unwritten: ['x'] } } },
      },
    }).findings;
    expect(unwritten).toEqual(
      expect.arrayContaining([
        "libs/extensions/acme-claim-exposure's own test is still to write, or skipped: x",
        "libs/extensions/acme-claim-exposure's own tests hold no test that passes",
      ]),
    );
  });
});

describe('the scan, on its own', () => {
  const plugin = (files: Record<string, string>): PluginSource => ({
    element: 'acme-x',
    library: 'libs/extensions/acme-x',
    files,
  });

  it('reads every spelling of writing HTML, binding a source, and reaching the network', () => {
    const template = [
      '<div [innerHTML]="a"></div>',
      '<div bind-innerHTML="a"></div>',
      '<iframe [attr.srcdoc]="a"></iframe>',
      '<img [src]="url" alt="">',
      '<img bind-src="url" alt="">',
      '<img src="{{ url }}" alt="">',
      '<img src="/nuxeo/api/v1/id/x/@blob/file:content" alt="">',
      '<button onclick="go()">x</button>',
    ].join('\n');
    const code = [
      "import { HttpClient, HttpErrorResponse } from '@angular/common/http';",
      "import { Something } from 'left-pad';",
      'export class A {',
      '  run(el: HTMLElement, text: string) {',
      '    el.innerHTML = text;',
      "    el['outerHTML'] = text;",
      '    void fetch("/x");',
      '    void window.fetch("/x");',
      '    void new Function(text);',
      '    eval(text);',
      "    setTimeout('go()', 1);",
      '    return localStorage.getItem("k") ?? document.cookie;',
      '  }',
      '  fetch(): void {}',
      '}',
    ].join('\n');
    const findings = scanPlugin(plugin({ 'src/lib/x/x.html': template, 'src/lib/x/x.ts': code }));
    const of = (pattern: RegExp): number => findings.filter((line) => pattern.test(line)).length;
    expect(of(/writes data as HTML/)).toBe(5);
    expect(of(/binds|names a Nuxeo URL/)).toBe(4);
    expect(of(/runs text as code/)).toBe(4);
    expect(of(/takes HttpClient from @angular\/common\/http/)).toBe(1);
    expect(of(/HttpErrorResponse/)).toBe(0);
    expect(of(/with fetch/)).toBe(2);
    expect(of(/imports left-pad/)).toBe(1);
    expect(of(/storage or cookies/)).toBe(2);
  });

  it("keeps a blob URL the component makes and revokes, and a spec's own HTTP testing", () => {
    expect(
      scanPlugin(
        plugin({
          'src/lib/x/x.html': '<img [src]="preview()" alt="">',
          'src/lib/x/x.ts': 'const a = URL.createObjectURL(blob); URL.revokeObjectURL(a);',
          'src/lib/x/x.spec.ts': "import { HttpClient } from '@angular/common/http'; eval('1');",
        }),
      ),
    ).toEqual([]);
  });

  it("holds the public API to its own names, and Angular's and the platform's types", () => {
    const files = {
      'src/index.ts': [
        "export { provideX, X_IDS } from './lib/extensions';",
        "export * from './lib/all';",
        "export { Observable } from 'rxjs';",
        "export { XComponent } from './lib/x';",
      ].join('\n'),
      'src/lib/extensions.ts': [
        "import type { EnvironmentProviders } from '@angular/core';",
        "import type { TranslateService } from '@ngx-translate/core';",
        'export const X_IDS = Object.freeze({ components: [] });',
        'export function provideX(): EnvironmentProviders { return null as never; }',
        'export function leak(service: TranslateService) { return service; }',
      ].join('\n'),
      'src/lib/x.ts': 'export class XComponent {}',
    };
    expect(scanPublicApi(plugin(files))).toEqual([
      'libs/extensions/acme-x/src/index.ts exports everything of ./lib/all: name each export',
      "libs/extensions/acme-x/src/index.ts re-exports rxjs, another package: a plugin's public API is its own",
      'libs/extensions/acme-x/src/index.ts exports the class XComponent: a host reaches a component by its ID, and nothing else of the plugin is a class to share',
    ]);
    const leaking = { ...files, 'src/index.ts': "export { leak } from './lib/extensions';" };
    expect(scanPublicApi(plugin(leaking))).toEqual([
      'libs/extensions/acme-x/src/index.ts exports leak, whose return type is not written: write it, so that the API is what it says',
      "libs/extensions/acme-x/src/index.ts exports leak, whose type names TranslateService, from @ngx-translate/core: a public API names Angular's and the platform's types only",
    ]);
  });

  it('finds code in configuration, and leaves a translation its placeholders', () => {
    expect(
      scanConfiguration(
        {
          'labels/en.json': { version: 2, labels: { a: 'Shown {{count}} times' } },
          'home.json': { cards: [{ label: 'Approve this. Then close it.' }] },
          'layouts/T/view.layout.json': {
            cards: [{ label: '[[document.title]]' }, { label: '<script>x()</script>' }],
          },
        },
        [],
      ),
    ).toEqual([
      "app/layouts/T/view.layout.json at cards[0].label holds a Polymer binding: configuration names a plugin's ID, never its code",
      "app/layouts/T/view.layout.json at cards[1].label holds markup: configuration names a plugin's ID, never its code",
    ]);
  });
});

describe('each control of check 9 fails it', () => {
  const pristine = JSON.stringify(subject);

  it('lists at least the controls the code track asks for', () => {
    expect(PLUGIN_MUTATIONS.map((mutation) => mutation.name)).toEqual(
      expect.arrayContaining([
        'plugin-writes-html',
        'plugin-drops-value',
        'plugin-test-fails',
        'plugin-bypasses-http',
        'code-in-configuration',
        'drop-element-entry',
      ]),
    );
  });

  for (const mutation of PLUGIN_MUTATIONS.filter((candidate) => !candidate.needsRun)) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const broken = mutation.apply(subject).subject;
      // It broke a copy: the plugins the next control is given are whole.
      expect(JSON.stringify(subject)).toBe(pristine);
      const result = runCheck(withSubject(broken), 9);
      expect(result?.status).toBe('fail');
      expect(result?.findings.length).toBeGreaterThan(0);
      expect(runHarness(withSubject(broken)).blockers).toContain('check 9 failed');
    });
  }

  it('says so, rather than failing some other way, when there is nothing of its kind to break', () => {
    const bare = prepare({});
    for (const mutation of PLUGIN_MUTATIONS) {
      try {
        mutation.apply({ conversion: bare.conversion, plugins: [], source: bare });
      } catch (error) {
        expect([mutation.name, (error as Error).name]).toEqual([mutation.name, MutationError.name]);
      }
    }
  });

  it.each<[string, string]>([
    [
      'plugin-writes-html',
      'libs/extensions/acme-claim-exposure/src/lib/acme-claim-exposure/acme-claim-exposure.html:3: it writes data as HTML, with [innerhtml]="number()"',
    ],
    ['plugin-bypasses-http', 'takes HttpClient from @angular/common/http'],
    ['drop-element-entry', 'the report lists no plugin for the custom element acme-claim-exposure'],
    [
      'code-in-configuration',
      'app/layouts/Claim/view.layout.json at cards[1].fields[0].computed.args[0] holds markup',
    ],
    ['plugin-runs-eval', 'it runs text as code, with eval'],
    ['plugin-binds-nuxeo-src', 'it binds [src]="document()?.properties?.[\'file:content\']"'],
    ['plugin-third-party-api', 're-exports rxjs, another package'],
    [
      'plugin-from-changed-element',
      'the custom element acme-claim-escalate has changed since its plugin was written',
    ],
    [
      'plugin-own-test-config',
      "libs/extensions/acme-claim-escalate/vite.config.mts is not the template's",
    ],
  ])('names what broke: %s', (name, expected) => {
    const mutation = PLUGIN_MUTATIONS.find((candidate) => candidate.name === name);
    const findings = runCheck(
      withSubject((mutation as (typeof PLUGIN_MUTATIONS)[number]).apply(subject).subject),
      9,
    )?.findings;
    expect(findings?.some((line) => line.includes(expected))).toBe(true);
  });
});

/**
 * The plugins run, as `check --run-plugins` runs them: each from a copy of its files, with its own
 * tests and the harness's spec. The two as written, and each control check 9 sees only by running.
 * They run side by side; each is a Vitest run of an Angular library, so this takes a while.
 */
describe('check 9, on the plugins run', () => {
  const RUNS = 300_000;
  const running = PLUGIN_MUTATIONS.filter((mutation) => mutation.needsRun);
  const runs = new Map<string, Record<string, PluginRun>>();

  const runAll = async (plugins: readonly PluginSource[]): Promise<Record<string, PluginRun>> => {
    const results: Record<string, PluginRun> = {};
    for (const source of plugins)
      results[source.element] = await runPlugin(WORKSPACE, source, {
        observed: M3_OBSERVED,
        element: m3.inventory.customElements.find((element) => element.name === source.element),
      });
    return results;
  };

  beforeAll(async () => {
    const jobs: [string, Promise<Record<string, PluginRun>>][] = [
      ['as written', runAll(subject.plugins)],
      ...running.map(
        (mutation) =>
          [mutation.name, runAll(changedOnly(mutation.apply(subject).subject))] as [
            string,
            Promise<Record<string, PluginRun>>,
          ],
      ),
    ];
    for (const [name, job] of jobs) runs.set(name, await job);
  }, RUNS);

  /** Only the plugins a control changed need running again: the others ran as written. */
  function changedOnly(broken: PluginSubject): PluginSource[] {
    return broken.plugins.filter(
      (plugin) =>
        JSON.stringify(plugin) !==
        JSON.stringify(subject.plugins.find((other) => other.element === plugin.element)),
    );
  }

  it('passes both plugins as written: their own tests, and the values the elements show', () => {
    const written = runs.get('as written') ?? {};
    for (const element of M3_ELEMENTS) {
      expect([element, written[element]?.tests.failed, written[element]?.tests.unwritten]).toEqual([
        element,
        [],
        [],
      ]);
      expect(written[element]?.tests.passed).toBeGreaterThan(0);
      expect(written[element]?.seen?.length).toBe(M3_OBSERVED.elements[element].records.length);
    }
    const result = runCheck(withSubject(subject, written), 9);
    expect(result?.findings).toEqual([]);
    // Lint, build and typecheck did not run here, so it is in part: `check --run-plugins` runs them.
    expect(result?.status).toBe('partial');
    expect(result?.reason).toContain(
      "acme-claim-exposure's lint, test, build and typecheck were not run",
    );
    // What the harness's spec read is what the elements show, word for word.
    expect(written['acme-claim-exposure']?.seen?.[0]?.shows).toBe(
      'Claim number CL-1001 Outstanding 9000.00 Reserve ratio 25% High exposure',
    );
    expect(written['acme-claim-escalate']?.seen?.[0]?.clicks?.[0]).toEqual(
      expect.objectContaining({
        found: true,
        asks: [
          expect.objectContaining({
            operation: 'Claim.Escalate',
            input: 'doc:claim-cl-1001',
            params: { reason: 'manual' },
          }),
        ],
      }),
    );
  });

  for (const mutation of running) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const broken = mutation.apply(subject).subject;
      const result = runCheck(
        withSubject(broken, { ...runs.get('as written'), ...runs.get(mutation.name) }),
        9,
      );
      expect(result?.status).toBe('fail');
      expect(result?.findings.length).toBeGreaterThan(0);
    });
  }

  it.each<[string, string]>([
    [
      'plugin-drops-value',
      'acme-claim-exposure, on claim-cl-1001: the plugin shows "Claim number Outstanding 9000.00',
    ],
    ['plugin-test-fails', 'own test fails: acme-claim-escalate, as a plugin'],
    ['plugin-todo-left', 'own test is still to write, or skipped'],
    ['plugin-asks-other-operation', 'asks Claim.Escalate.Other on "doc:claim-cl-1001"'],
    [
      'plugin-registers-more',
      'registers acme.rules.alwaysAllowed among the rules, beside its component',
    ],
  ])('names what broke: %s', (name, expected) => {
    const mutation = PLUGIN_MUTATIONS.find((candidate) => candidate.name === name);
    const broken = (mutation as (typeof PLUGIN_MUTATIONS)[number]).apply(subject).subject;
    const findings = runCheck(
      withSubject(broken, { ...runs.get('as written'), ...runs.get(name) }),
      9,
    )?.findings;
    expect(findings?.some((line) => line.includes(expected))).toBe(true);
  });
});
