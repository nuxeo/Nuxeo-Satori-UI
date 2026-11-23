import { validateTaskForm } from '@agentic-ui/shared/app-definition';
import { loadCatalogue } from './catalogue';
import { constructsOf, countsOf } from './constructs';
import { convert, type Conversion, type ReportEntry } from './convert';
import { runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MUTATIONS, ruleHolders } from './mutations';
import { secondCount } from './second-count';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage, type SyntheticPackageOptions } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const TASK = `${UI}/workflow/claimreview/nuxeo-assessclaim-layout.html`;
const TABS = `${UI}/nuxeo-Acme-Claims-tabs-bundle.html`;
const VIEW = `${UI}/document/policy/nuxeo-policy-view-layout.html`;
const catalogue = loadCatalogue();

/** The made-up package with M2's corpus, and files added or replaced in its bundle. */
function prepare(bundle: Record<string, string> = {}, without: string[] = []): HarnessInput {
  const options: SyntheticPackageOptions = { bundle: { ...m2CorpusFiles(), ...bundle }, without };
  const pkg = readStudioPackage(syntheticPackage(options));
  const read = inventory(pkg);
  const allowList = new Set(['Claim.Approve']);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList,
    platformVersion: '0.2.0',
    conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
  };
}

const run = (input: HarnessInput, number: number) =>
  runHarness(input).checks.find((check) => check.number === number);

const entry = (conversion: Conversion, id: string): ReportEntry | undefined =>
  conversion.report.constructs.find((candidate) => candidate.id === id);

/** The input with one file of the converted app definition replaced, or removed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edit(input: HarnessInput, path: string, change: (file: any) => unknown): HarnessInput {
  const file = JSON.parse(JSON.stringify(input.conversion.app[path] ?? null));
  const changed = change(file);
  const app: Record<string, unknown> = { ...input.conversion.app };
  if (changed === undefined) delete app[path];
  else app[path] = changed;
  return { ...input, conversion: { ...input.conversion, app } };
}

describe('the inventory of task layouts, tabs and layout blocks', () => {
  const { inventory: read } = prepare();

  it('reads a task layout, with its fields bound to the task variables as var:', () => {
    const [task] = read.taskLayouts.filter((candidate) => candidate.path === TASK);
    expect(task).toMatchObject({
      element: 'nuxeo-assessclaim-layout',
      workflow: 'claimreview',
      step: 'assessclaim',
      variables: 'var_assessclaim',
    });
    expect(task.fields.map((field) => field.binding)).toEqual([
      'var:decision',
      'var:followUp',
      'var:notes',
      'var:priority',
      'cl:number',
      'var:reviewer',
      'var:override',
      'var:versionNote',
      'var:claimNumber',
    ]);
    expect(read.files.find((file) => file.path === TASK)?.kind).toBe('task-layout');
  });

  it("gives a task layout's conditions no document, which Web UI gives it as an id alone", () => {
    const conditions = read.conditions.filter((condition) => condition.path === TASK);
    expect(conditions.map((condition) => condition.documentInScope)).toEqual([false, false, false]);
    // Its nuxeo-connection writes the user, so a group test there is in scope.
    expect(conditions.map((condition) => condition.userInScope)).toEqual([true, true, true]);
  });

  it('knows a layout block by what it is, wherever it sits, and only then', () => {
    expect(read.blocks.map((block) => block.element)).toEqual([
      'acme-policy-summary',
      'acme-policy-terms',
      'acme-policy-cover',
      'acme-unused',
    ]);
    // A file of no known kind that is not an element with the layout behaviour stays one.
    const other = prepare({
      [`${UI}/acme-blocks/acme-plain.html`]:
        '<dom-module id="acme-plain"><template></template><script>Polymer({ is: "acme-plain" });</script></dom-module>',
    }).inventory;
    expect(other.files.find((file) => file.path.endsWith('acme-plain.html'))?.kind).toBe(
      'unrecognised',
    );
    expect(other.blocks.map((block) => block.element)).not.toContain('acme-plain');
    // Two elements in one file: which one the layouts use is not the file's to say.
    const two = prepare({
      [`${UI}/acme-blocks/acme-two.html`]:
        '<dom-module id="acme-one"><script>Polymer({ is: "acme-one", behaviors: [Nuxeo.LayoutBehavior] });</script></dom-module><dom-module id="acme-two"></dom-module>',
    }).inventory;
    expect(two.files.find((file) => file.path.endsWith('acme-two.html'))?.kind).toBe(
      'unrecognised',
    );
  });

  it('records each use of a block: where it sits among the fields, its condition and its document', () => {
    const uses = read.blockUses.filter((use) => use.path === VIEW);
    expect(
      uses.map(({ element, after, conditions, document }) => [
        element,
        after,
        conditions,
        document,
      ]),
    ).toEqual([
      ['acme-policy-summary', 1, [], true],
      ['acme-policy-terms', 1, [0], true],
    ]);
    const metadata = read.blockUses.filter((use) =>
      use.path.endsWith('nuxeo-policy-metadata-layout.html'),
    );
    expect(metadata.map((use) => use.document)).toEqual([false]);
    // A tab's page holds its block.
    const page = read.slotContributions.find(
      (contribution) => contribution.path === TABS && contribution.name === 'policyCoverPage',
    );
    expect(page?.uses).toEqual([0]);
  });

  it('counts the uses of blocks, and their fields, a second way, and both counts agree', () => {
    const { pkg, inventory: parsed } = prepare();
    const first = countsOf(constructsOf(parsed));
    const second = secondCount(pkg, parsed);
    expect(first.get(`block-use ${VIEW}`)).toBe(2);
    expect(first.get(`block-field ${VIEW}`)).toBe(4);
    expect(first.get(`task-field ${TASK}`)).toBe(9);
    expect(second).toEqual(first);
  });
});

describe('the conversion of task layouts into task forms', () => {
  const input = prepare();
  const form = input.conversion.app['tasks/ClaimReview.AssessClaim.layout.json'];

  it("writes the step's form under the names the package gives their case, and it validates", () => {
    expect(form).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [
            {
              field: 'var:decision',
              label: 'Decision',
              widget: 'vocabulary',
              parameters: { directory: 'claim_decision' },
              required: true,
            },
            { field: 'var:followUp', label: 'Follow up', widget: 'date' },
            { field: 'var:notes', labelKey: 'label.task.notes', widget: 'long-text' },
            {
              field: 'var:override',
              label: 'Override',
              visibleWhen: { type: 'app.rules.inGroup', parameters: ['supervisors'] },
            },
            // Web UI only shows it: the form shows it read-only, and sends none of it.
            { field: 'var:claimNumber', label: 'Claim number', readOnlyWhen: 'core.true' },
          ],
        },
      ],
    });
    expect(validateTaskForm(form)).toEqual([]);
    expect(entry(input.conversion, `task-layout:${TASK}#layout`)).toMatchObject({
      outcome: 'converted',
      to: expect.stringContaining("with the step's own buttons"),
    });
  });

  it('reports what Web UI shows nothing of, or what does not convert, and never guesses', () => {
    const outcome = (index: number) => entry(input.conversion, `task-field:${TASK}#${index}`);
    expect(outcome(4)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('nuxeo-select'),
    });
    expect(outcome(5)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('targetDocumentIds[0]'),
    });
    // Under a test of the document, which in a task layout decides on an id alone.
    expect(outcome(6)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('targetDocumentIds[0]'),
    });
    expect(entry(input.conversion, `condition:${TASK}#1`)).toMatchObject({ outcome: 'reported' });
    expect(entry(input.conversion, `condition:${TASK}#2`)).toMatchObject({ outcome: 'converted' });
    // A dom-if calling a filter function on that document is reported too, not proposed.
    expect(entry(input.conversion, `condition:${TASK}#3`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('targetDocumentIds[0]'),
    });
    expect(outcome(8)).toMatchObject({ outcome: 'reported' });
  });

  it("reports a task layout whose names' case the package does not give", () => {
    const legacy = `${UI}/workflow/legacyreview/nuxeo-task1a2-layout.html`;
    expect(entry(input.conversion, `task-layout:${legacy}#layout`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('the package names no workflow legacyreview'),
    });
    expect(Object.keys(input.conversion.app).filter((path) => path.startsWith('tasks/'))).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json',
    ]);
    // Two schemas differing in case only would make the case a guess.
    const twice = prepare({
      'OSGI-INF/acme-twice.xml':
        '<component name="x"><extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema"><schema name="var_ASSESSCLAIM" src="data/schemas/var_AssessClaim.xsd"/></extension></component>',
    });
    expect(entry(twice.conversion, `task-layout:${TASK}#layout`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('differ in case only'),
    });
  });

  it("takes a workflow's case from the workflows the package imports, too", () => {
    const imported = prepare({
      [`${UI}/workflow/legacyreview/nuxeo-task1a2-layout.html`]: `<dom-module id="nuxeo-task1a2-layout"><template>
<nuxeo-textarea role="widget" label="Comment" value="{{task.variables.comment}}"></nuxeo-textarea></template></dom-module>`,
      'OSGI-INF/acme-legacy.xml': `<component name="legacy">
<extension target="org.nuxeo.ecm.platform.routing.service" point="routeModelImporter"><template-resource id="LegacyReview" path="data/LegacyReview.zip"/></extension>
<extension target="org.nuxeo.ecm.core.schema.TypeService" point="schema"><schema name="var_Task1a2" src="data/schemas/var_Task1a2.xsd"/></extension></component>`,
      'data/schemas/var_Task1a2.xsd':
        '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="comment" type="xs:string"/></xs:schema>',
    });
    expect(imported.conversion.app['tasks/LegacyReview.Task1a2.layout.json']).toEqual({
      version: 2,
      cards: [
        { id: 'fields', fields: [{ field: 'var:comment', label: 'Comment', widget: 'long-text' }] },
      ],
    });
  });

  it('writes the form of a step whose layout shows no field, as Web UI shows none', () => {
    const empty = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template></template></dom-module>`,
    });
    expect(empty.conversion.app['tasks/ClaimReview.AssessClaim.layout.json']).toEqual({
      version: 2,
      cards: [],
    });
    expect(run(empty, 10)?.status).toBe('pass');
  });
});

describe('the conversion of layout blocks into cards', () => {
  const input = prepare();
  const view = input.conversion.app['layouts/Policy/view.layout.json'] as {
    tabs: { id: string; cards: { id: string; visibleWhen?: unknown; fields: unknown[] }[] }[];
  };
  const viewTab = view.tabs.find((tab) => tab.id === 'view');

  it("makes each block a card where it sits among the layout's fields, with its condition's rule", () => {
    expect(
      viewTab?.cards.map((card) => [card.id, card.visibleWhen ?? null, card.fields.length]),
    ).toEqual([
      ['fields', null, 1],
      ['acme-policy-summary', null, 3],
      ['acme-policy-terms', 'app.rules.canWrite', 1],
    ]);
    expect(entry(input.conversion, `condition:${VIEW}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'the visibleWhen of layouts/Policy/view.layout.json tabs.view.cards.acme-policy-terms',
    });
  });

  it("writes a block's section in version 1, and leaves its field under a condition pending", () => {
    expect(input.conversion.app['layouts/Policy/edit.layout.json']).toEqual({
      version: 1,
      sections: [
        {
          id: 'fields',
          fields: [{ field: 'po:number', label: 'Policy number', required: true }],
        },
        {
          id: 'acme-policy-summary',
          fields: [
            { field: 'po:holder', label: 'Holder' },
            { field: 'po:startDate', label: 'Start' },
          ],
        },
      ],
    });
    const edit = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    expect(entry(input.conversion, `block-field:${edit}#1.3`)).toMatchObject({
      outcome: 'pending',
    });
  });

  it('leaves a block under a condition pending in version 1, which has no rules', () => {
    const edit = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    const guarded = prepare({
      [edit]: `<dom-module id="nuxeo-policy-edit-layout"><template>
<nuxeo-input role="widget" value="{{document.properties.po:number}}" label="Policy number"></nuxeo-input>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><acme-policy-terms document="{{document}}"></acme-policy-terms></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(guarded.conversion.app['layouts/Policy/edit.layout.json']).toEqual({
      version: 1,
      sections: [{ id: 'fields', fields: [{ field: 'po:number', label: 'Policy number' }] }],
    });
    expect(entry(guarded.conversion, `block-use:${edit}#1`)).toMatchObject({ outcome: 'pending' });
    expect(entry(guarded.conversion, `block-field:${edit}#1.1`)).toMatchObject({
      outcome: 'pending',
    });
    // Pending whether or not its condition converts, as a field of version 1 under one is.
    const unconvertible = prepare({
      [edit]: `<dom-module id="nuxeo-policy-edit-layout"><template>
<nuxeo-filter document="[[document]]" path="/default-domain/archive"><template><acme-policy-terms document="{{document}}"></acme-policy-terms></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(entry(unconvertible.conversion, `block-use:${edit}#1`)).toMatchObject({
      outcome: 'pending',
      note: expect.stringContaining('version 1 has no rules'),
    });
  });

  it('keeps a property once, where Web UI shows it to everyone, though a block under a condition shows it first', () => {
    const twice = prepare({
      [VIEW]: `<dom-module id="nuxeo-policy-view-layout"><template>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><acme-policy-terms document="[[document]]"></acme-policy-terms></template></nuxeo-filter>
<div role="widget"><label>Terms</label><div>[[document.properties.po:terms]]</div></div>
</template><script>Polymer({ is: 'nuxeo-policy-view-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(entry(twice.conversion, `block-field:${VIEW}#1.1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('another field of the layout shows it to everyone'),
    });
    expect(entry(twice.conversion, `layout-field:${VIEW}#1`)).toMatchObject({
      outcome: 'converted',
    });
    expect(run(twice, 2)?.status).toBe('pass');
    expect(run(twice, 5)?.status).toBe('partial');
  });

  it('reports a block given no document, a block inside a block, and a block used nowhere', () => {
    const metadata = `${UI}/document/policy/nuxeo-policy-metadata-layout.html`;
    expect(entry(input.conversion, `block-use:${metadata}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining("not given the page's document"),
    });
    expect(
      entry(input.conversion, `block-use:${UI}/acme-blocks/acme-policy-cover.html#1`),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('another layout block'),
    });
    expect(
      entry(input.conversion, `layout-block:${UI}/acme-blocks/acme-unused.html#block`),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('uses it'),
    });
    expect(
      entry(input.conversion, `layout-block:${UI}/acme-blocks/acme-policy-terms.html#block`),
    ).toMatchObject({
      outcome: 'converted',
    });
  });

  it('reports a block in a task layout, whose document is an id alone', () => {
    const inTask = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<acme-policy-terms document="[[document]]"></acme-policy-terms></template></dom-module>`,
    });
    expect(entry(inTask.conversion, `block-use:${TASK}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('targetDocumentIds[0]'),
    });
  });
});

describe('the conversion of tabs', () => {
  const input = prepare();
  const view = input.conversion.app['layouts/Policy/view.layout.json'] as {
    tabs: Record<string, unknown>[];
  };

  it("adds each tab to its type's view file in Web UI's order, after the record page's own at 10", () => {
    expect(view.tabs.map((tab) => [tab.id, tab.label ?? tab.labelKey ?? null])).toEqual([
      ['terms', 'Terms'],
      ['view', null],
      ['cover', 'label.tab.cover'],
    ]);
    expect(view.tabs[2]).toMatchObject({
      labelKey: 'label.tab.cover',
      cards: [{ id: 'cover.acme-policy-cover' }],
    });
  });

  it("carries the item's and the page's conditions as the tab's rule", () => {
    const cover = view.tabs[2];
    expect(cover.visibleWhen).toEqual({
      type: 'core.every',
      parameters: [
        { type: 'app.rules.isType', parameters: ['Policy'] },
        {
          type: 'core.every',
          parameters: [
            { type: 'app.rules.isType', parameters: ['Policy'] },
            { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
          ],
        },
      ],
    });
  });

  it('reports what has no tab of version 2, and says why', () => {
    const note = (index: number) =>
      entry(input.conversion, `slot-contribution:${TABS}#${index}`)?.note;
    expect(note(5)).toContain('shows on every type');
    expect(note(7)).toContain('no rule reads a path');
    expect(note(9)).toContain('writes no view layout');
    expect(note(11)).toContain('No page the package contributes');
    expect(note(12)).toContain('No tab of the package opens it');
  });

  it("reports a tab named as Web UI's own, and a page that is not a block", () => {
    const own = prepare({
      [TABS]: `<nuxeo-slot-content name="a" slot="DOCUMENT_VIEWS_ITEMS"><template>
<nuxeo-filter document="[[document]]" type="Policy"><template><nuxeo-page-item name="history" label="H"></nuxeo-page-item></template></nuxeo-filter></template></nuxeo-slot-content>
<nuxeo-slot-content name="b" slot="DOCUMENT_VIEWS_ITEMS"><template>
<nuxeo-filter document="[[document]]" type="Policy"><template><nuxeo-page-item name="custom" label="C"></nuxeo-page-item></template></nuxeo-filter></template></nuxeo-slot-content>
<nuxeo-slot-content name="c" slot="DOCUMENT_VIEWS_PAGES"><template><acme-code name="custom" document="[[document]]"></acme-code></template></nuxeo-slot-content>`,
    });
    const note = (index: number) =>
      entry(own.conversion, `slot-contribution:${TABS}#${index}`)?.note;
    expect(note(1)).toContain("Web UI's own history tab");
    expect(note(2)).toContain('is no layout block of the package');
    expect(note(3)).toContain('is no layout block of the package');
    expect(own.conversion.app['layouts/Policy/view.layout.json']).not.toHaveProperty('tabs');
  });
});

describe('the checks on task forms, tabs and layout blocks', () => {
  const input = prepare();

  it('pass on the conversion, with what needs the migration server in part', () => {
    expect(runHarness(input).checks.map((check) => [check.number, check.status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'partial'],
      [4, 'pass'],
      [5, 'partial'],
      [6, 'partial'],
      [7, 'partial'],
      [8, 'pass'],
      [9, 'not run'],
      [10, 'pass'],
    ]);
  });

  it("name what each of M2's controls broke", () => {
    const findings = (name: string, number?: number) => {
      const mutation = MUTATIONS.find((candidate) => candidate.name === name);
      if (!mutation) throw new Error(name);
      return run(
        { ...input, conversion: mutation.apply(input.conversion).conversion },
        number ?? mutation.caughtBy,
      )?.findings;
    };
    expect(findings('drop-task-field')).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: var:decision is missing, though Web UI's task layout of ClaimReview.AssessClaim shows it",
    ]);
    expect(findings('rename-task-variable')).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.0: neither var_AssessClaim nor var_ClaimReview has a variable decisionRenamed, so var:decisionRenamed does not exist',
    ]);
    expect(findings('var-in-layout')).toEqual([
      'app/layouts/Claim/view.layout.json cards[0].fields[0].field: "var:" names a task variable, which only a task form has',
    ]);
    expect(findings('drop-block-card')).toEqual([
      "layouts/Policy/edit.layout.json: po:holder is missing, though Web UI's edit layout of Policy shows it",
      "layouts/Policy/edit.layout.json: po:startDate is missing, though Web UI's edit layout of Policy shows it",
    ]);
    expect(findings('drop-tab')).toEqual([
      "layouts/Policy/view.layout.json tab terms: po:terms is missing, though Web UI's tab terms of Policy shows it",
    ]);
    expect(findings('drop-tab-rule')).toEqual([
      'layouts/Policy/view.layout.json: its tab terms shows to everyone, though Web UI shows the tab terms only while a condition passes',
    ]);
    expect(findings('change-tab-label')).toEqual([
      'layouts/Policy/view.layout.json: the tab cover: the app shows "Something else", where Web UI shows "Cover"',
    ]);
    expect(findings('make-display-editable')).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: var:claimNumber is editable, but Web UI's div only shows it",
    ]);
    expect(findings('drop-block-use-entry')).toEqual([
      `dropped: the layout block acme-policy-summary, in ${VIEW} (block-use:${VIEW}#1)`,
      expect.stringMatching(/^coverage is [\d.]+%, not 100%$/),
    ]);
  });

  it('fail on every rule of a tab, a card or a task form dropped or inverted, one by one', () => {
    const holders = ruleHolders(input.conversion).filter(
      (found) =>
        found.path.startsWith('tasks/') || found.path === 'layouts/Policy/view.layout.json',
    );
    expect(holders.map((found) => `${found.path} ${found.at}`)).toEqual([
      'layouts/Policy/view.layout.json tabs.0.visibleWhen',
      'layouts/Policy/view.layout.json tabs.1.cards.2.visibleWhen',
      'layouts/Policy/view.layout.json tabs.2.visibleWhen',
      'layouts/Policy/view.layout.json tabs.1.cards.1.fields.2.visibleWhen',
      'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.3.visibleWhen',
    ]);
    for (const change of ['drop', 'invert'] as const)
      for (const found of ruleHolders(input.conversion).filter((holder) =>
        holders.some((other) => other.path === holder.path && other.at === holder.at),
      )) {
        if (change === 'drop') delete found.holder['visibleWhen'];
        else
          found.holder['visibleWhen'] = {
            type: 'core.not',
            parameters: [found.holder['visibleWhen']],
          };
        const broken = {
          ...input,
          conversion: {
            ...input.conversion,
            app: { ...input.conversion.app, [found.path]: found.file },
          },
        };
        expect([change, found.at, run(broken, 5)?.status]).toEqual([change, found.at, 'fail']);
      }
  });

  it('fails on a block card moved out from under its rule, and on a tab no tab gives', () => {
    const moved = edit(input, 'layouts/Policy/view.layout.json', (file) => {
      const view = file.tabs.find((tab: { id: string }) => tab.id === 'view');
      const [terms] = view.cards.splice(2, 1);
      view.cards[0].fields.push(...terms.fields);
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it shows po:terms of the layout block acme-policy-terms to everyone, though Web UI shows the block only while a condition passes',
    ]);
    const invented = edit(input, 'layouts/Policy/view.layout.json', (file) => {
      file.tabs.push({ id: 'extra', cards: [{ id: 'extra.x', fields: ['po:number'] }] });
      return file;
    });
    expect(run(invented, 2)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it has a tab extra, which no tab of the package gives',
    ]);
  });

  it('fails on a task form no task layout gives, and on a document field in a task form', () => {
    const invented = edit(input, 'tasks/Other.Step.layout.json', () => ({ version: 2, cards: [] }));
    expect(run(invented, 2)?.findings).toEqual([
      'tasks/Other.Step.layout.json: the package has no task layout of that workflow and step',
    ]);
    const record = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields.push('cl:number');
      return file;
    });
    expect(run(record, 2)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: it shows cl:number, which Web UI's task layout of ClaimReview.AssessClaim does not",
    ]);
  });

  it("holds a task variable's widget to its type, and a required flag to Web UI's", () => {
    const wrong = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[1] = { field: 'var:followUp', label: 'Follow up', widget: 'boolean' };
      return file;
    });
    expect(run(wrong, 3)?.findings).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.1: the boolean widget does not show var:followUp, which is a date',
    ]);
    const optional = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      delete file.cards[0].fields[0].required;
      return file;
    });
    expect(run(optional, 2)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: var:decision is not required, but Web UI's is required",
    ]);
  });

  it('fails on a field Web UI edits made read-only, and on a rule moved to another card', () => {
    const frozen = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[2].readOnlyWhen = 'core.true';
      return file;
    });
    expect(run(frozen, 2)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: var:notes is read-only, but Web UI's nuxeo-textarea edits it",
    ]);
    const moved = edit(input, 'layouts/Policy/view.layout.json', (file) => {
      const view = file.tabs.find((tab: { id: string }) => tab.id === 'view');
      const [premium] = view.cards[1].fields.splice(2, 1);
      view.cards[0].fields.push(premium);
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      'layouts/Policy/view.layout.json: tabs.1.cards.0.fields.1.visibleWhen holds a rule that no condition of the package gives',
    ]);
  });

  it("fails when a task form's rule sits on a field of no condition", () => {
    const slipped = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[2].visibleWhen = 'app.rules.canWrite';
      return file;
    });
    expect(run(slipped, 5)?.findings).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.2.visibleWhen holds a rule that no condition of the package gives',
    ]);
    // Only a field read-only always is the display mode's; any other rule is a condition's.
    const ruled = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[4].readOnlyWhen = 'app.rules.canWrite';
      return file;
    });
    expect(run(ruled, 5)?.findings).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.4.readOnlyWhen holds a rule that no condition of the package gives',
    ]);
  });
});
