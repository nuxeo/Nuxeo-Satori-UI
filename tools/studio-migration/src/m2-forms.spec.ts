import { validateTaskForm } from '@agentic-ui/shared/app-definition';
import { loadCatalogue } from './catalogue';
import { constructsOf, countsOf } from './constructs';
import { convert, type Conversion, type ReportEntry } from './convert';
import { runCheck, runHarness, type HarnessInput } from './harness';
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

/** What one check finds: that check alone, as the harness runs it, not the ten. */
const run = (input: HarnessInput, number: number) => runCheck(input, number);

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
      'var:escalate',
    ]);
    // A field bound two ways edits its value, as Web UI writes it back; one bound one way shows it.
    expect(task.fields.map((field) => field.edits)).toEqual([
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(read.files.find((file) => file.path === TASK)?.kind).toBe('task-layout');
  });

  it("gives a task layout's conditions no permissions, which Web UI's task page does not fetch", () => {
    const conditions = read.conditions.filter((condition) => condition.path === TASK);
    expect(conditions.map((condition) => condition.permissionsInScope)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Its nuxeo-connection writes the user, so a group test there is in scope.
    expect(conditions.map((condition) => condition.userInScope)).toEqual([true, true, true, true]);
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
    expect(first.get(`task-field ${TASK}`)).toBe(10);
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
            // The record's own property, which the task form shows read-only.
            { field: 'cl:number', label: 'Claim' },
            {
              field: 'var:reviewer',
              label: 'Reviewer',
              widget: 'user',
              visibleWhen: { type: 'app.rules.isType', parameters: ['Claim'] },
            },
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
    // The record's own field, and one under a type test of the record: Web UI's task page
    // fetches the task's target whole, with its type, state, facets and properties.
    expect(outcome(5)).toMatchObject({ outcome: 'converted' });
    expect(outcome(6)).toMatchObject({ outcome: 'converted' });
    expect(entry(input.conversion, `condition:${TASK}#1`)).toMatchObject({ outcome: 'converted' });
    expect(entry(input.conversion, `condition:${TASK}#2`)).toMatchObject({ outcome: 'converted' });
    expect(entry(input.conversion, `condition:${TASK}#3`)).toMatchObject({ outcome: 'proposed' });
    expect(outcome(8)).toMatchObject({ outcome: 'proposed' });
    // But without its permissions: a permission test never passes there.
    expect(entry(input.conversion, `condition:${TASK}#4`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('without its permissions'),
    });
    expect(outcome(10)).toMatchObject({ outcome: 'reported' });
    // And so is one joined with another test, which a rule of them all would still read.
    const joined = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<nuxeo-filter document="[[document]]" type="Claim" permission="Write, WriteProperties"><template>
<nuxeo-input role="widget" label="Escalate" value="{{task.variables.escalate}}"></nuxeo-input></template></nuxeo-filter>
</template></dom-module>`,
    });
    expect(entry(joined.conversion, `condition:${TASK}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('without its permissions'),
    });
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

  it("writes a block's card in an edit form of version 2, its field under a condition with its rule", () => {
    const rule = { type: 'app.rules.hasFacet', parameters: ['Versionable'] };
    // The block's fields only show their values, bound one way: read-only in the form.
    expect(input.conversion.app['layouts/Policy/edit.layout.json']).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [{ field: 'po:number', label: 'Policy number', required: true }],
        },
        {
          id: 'acme-policy-summary',
          fields: [
            { field: 'po:holder', label: 'Holder', readOnlyWhen: 'core.true' },
            { field: 'po:startDate', label: 'Start', widget: 'date', readOnlyWhen: 'core.true' },
            {
              field: 'po:premium',
              label: 'Premium',
              readOnlyWhen: 'core.true',
              visibleWhen: rule,
            },
          ],
        },
      ],
    });
    const edit = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    expect(entry(input.conversion, `block-field:${edit}#1.3`)).toMatchObject({
      outcome: 'converted',
      to: 'layouts/Policy/edit.layout.json',
    });
  });

  it('gives a block under a condition its rule in an edit form, and reports it in version 1', () => {
    const edit = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    const guarded = prepare({
      [edit]: `<dom-module id="nuxeo-policy-edit-layout"><template>
<nuxeo-input role="widget" value="{{document.properties.po:number}}" label="Policy number"></nuxeo-input>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><acme-policy-terms document="{{document}}"></acme-policy-terms></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(guarded.conversion.app['layouts/Policy/edit.layout.json']).toEqual({
      version: 2,
      cards: [
        { id: 'fields', fields: [{ field: 'po:number', label: 'Policy number' }] },
        {
          id: 'acme-policy-terms',
          visibleWhen: 'app.rules.canWrite',
          fields: [{ field: 'po:terms', label: 'Terms', readOnlyWhen: 'core.true' }],
        },
      ],
    });
    expect(entry(guarded.conversion, `block-use:${edit}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'layouts/Policy/edit.layout.json cards.acme-policy-terms',
    });
    // A condition that does not convert leaves the block out, and says why.
    const unconvertible = prepare({
      [edit]: `<dom-module id="nuxeo-policy-edit-layout"><template>
<nuxeo-filter document="[[document]]" path="/default-domain/archive"><template><acme-policy-terms document="{{document}}"></acme-policy-terms></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(entry(unconvertible.conversion, `block-use:${edit}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('no rule reads a path'),
    });
    // The metadata layout is version 1, which has no rules: reported, never shown to everyone.
    const metadata = `${UI}/document/policy/nuxeo-policy-metadata-layout.html`;
    const panel = prepare({
      [metadata]: `<dom-module id="nuxeo-policy-metadata-layout"><template>
<div role="widget"><label>Policy number</label><div>[[document.properties.po:number]]</div></div>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><acme-policy-terms document="[[document]]"></acme-policy-terms></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-metadata-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(panel.conversion.app['layouts/Policy/metadata.layout.json']).toEqual({
      version: 1,
      sections: [{ id: 'fields', fields: [{ field: 'po:number', label: 'Policy number' }] }],
    });
    expect(entry(panel.conversion, `block-use:${metadata}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('version 1 has no rules'),
    });
    expect(entry(panel.conversion, `block-field:${metadata}#1.1`)).toMatchObject({
      outcome: 'reported',
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

  it('makes a block of a task layout a card of the record, shown read-only by the task form', () => {
    const inTask = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<acme-policy-terms document="[[document]]"></acme-policy-terms></template></dom-module>`,
    });
    expect(inTask.conversion.app['tasks/ClaimReview.AssessClaim.layout.json']).toEqual({
      version: 2,
      cards: [{ id: 'acme-policy-terms', fields: [{ field: 'po:terms', label: 'Terms' }] }],
    });
    expect(run(inTask, 2)?.status).toBe('pass');
    expect(run(inTask, 10)?.status).toBe('pass');
  });
});

describe('the conversion of tabs', () => {
  const input = prepare();
  const view = input.conversion.app['layouts/Policy/view.layout.json'] as {
    tabs: Record<string, unknown>[];
  };

  it("adds each tab to its type's view file after the record page's own, in Web UI's order", () => {
    // The record page opens on its first tab, as Web UI's page opens on View: View stays first.
    expect(view.tabs.map((tab) => [tab.id, tab.label ?? tab.labelKey ?? null])).toEqual([
      ['view', null],
      ['terms', 'Terms'],
      ['cover', 'label.tab.cover'],
    ]);
    expect(entry(input.conversion, `slot-contribution:${TABS}#3`)).toMatchObject({
      outcome: 'converted',
      note: expect.stringContaining('before its View tab, at order 5'),
    });
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
      [9, 'pass'],
      [10, 'pass'],
    ]);
  });

  /** The input with one of the harness's mutations applied to its conversion. */
  const mutated = (name: string, on: HarnessInput = input): HarnessInput => {
    const mutation = MUTATIONS.find((candidate) => candidate.name === name);
    if (!mutation) throw new Error(name);
    return { ...on, conversion: mutation.apply(on.conversion).conversion };
  };

  /** An input no other test shares: its own package, conversion and catalogue. */
  const fresh = (): HarnessInput => ({ ...prepare(), catalogue: loadCatalogue() });

  // Every other test here asks one check what it finds, and runs that check alone: it must be the
  // check the ten give. The checks run alone on an input of their own, last first, and the ten on
  // another, in order. A check that changed what another check reads would then show, whichever
  // of the two runs first: on one input both sides would see the change.
  it.each([
    ['the conversion', (subject: HarnessInput) => subject],
    ['a conversion check 5 fails', (subject: HarnessInput) => mutated('drop-tab-rule', subject)],
  ])('give each check alone as the ten give it, on %s', (_, given) => {
    const subject = given(fresh());
    const alone = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((number) => runCheck(subject, number));
    expect(alone.reverse()).toEqual(runHarness(given(fresh())).checks);
    expect(runCheck(subject, 11)).toBeUndefined();
  });

  // One case a control: each runs the one check that catches it, which on a loaded runner is what
  // keeps a case well inside the time a test is given.
  describe("name what each of M2's controls broke", () => {
    it.each<[string, readonly unknown[]]>([
      [
        'drop-task-field',
        [
          "tasks/ClaimReview.AssessClaim.layout.json: var:decision is missing, though Web UI's task layout of ClaimReview.AssessClaim shows it",
        ],
      ],
      [
        'rename-task-variable',
        [
          'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.0: neither var_AssessClaim nor var_ClaimReview has a variable decisionRenamed, so var:decisionRenamed does not exist',
        ],
      ],
      [
        'var-in-layout',
        [
          'app/layouts/Claim/edit.layout.json cards[0].fields[0].field: "var:" names a task variable, which only a task form has',
        ],
      ],
      [
        'drop-block-card',
        [
          "layouts/Policy/edit.layout.json: po:holder is missing, though Web UI's edit layout of Policy shows it",
          "layouts/Policy/edit.layout.json: po:startDate is missing, though Web UI's edit layout of Policy shows it",
        ],
      ],
      [
        'drop-tab',
        [
          "layouts/Policy/view.layout.json tab terms: po:terms is missing, though Web UI's tab terms of Policy shows it",
        ],
      ],
      [
        'drop-tab-rule',
        [
          'layouts/Policy/view.layout.json: its tab terms shows to everyone, though Web UI shows the tab terms only while a condition passes',
        ],
      ],
      [
        'change-tab-label',
        [
          'layouts/Policy/view.layout.json: the tab cover: the app shows "Something else", where Web UI shows "Cover"',
        ],
      ],
      [
        'make-display-editable',
        [
          "tasks/ClaimReview.AssessClaim.layout.json: var:claimNumber is editable, but Web UI's div only shows it",
        ],
      ],
      [
        'drop-block-use-entry',
        [
          `dropped: the layout block acme-policy-summary, in ${VIEW} (block-use:${VIEW}#1)`,
          expect.stringMatching(/^coverage is [\d.]+%, not 100%$/),
        ],
      ],
    ])('%s', (name, expected) => {
      const mutation = MUTATIONS.find((candidate) => candidate.name === name);
      expect(run(mutated(name), mutation?.caughtBy ?? 0)?.findings).toEqual(expected);
    });
  });

  /** The rules M2 writes on a tab, a card or a field of a task form. */
  const formRules = (conversion: Conversion) =>
    ruleHolders(conversion).filter(
      (found) =>
        found.path.startsWith('tasks/') || found.path === 'layouts/Policy/view.layout.json',
    );
  const FORM_RULES = [
    'layouts/Policy/view.layout.json tabs.0.cards.2.visibleWhen',
    'layouts/Policy/view.layout.json tabs.1.visibleWhen',
    'layouts/Policy/view.layout.json tabs.2.visibleWhen',
    'layouts/Policy/view.layout.json tabs.0.cards.1.fields.2.visibleWhen',
    'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.4.visibleWhen',
    'tasks/ClaimReview.AssessClaim.layout.json cards.0.fields.5.visibleWhen',
  ];

  // The cases below break these rules one by one: a rule the conversion gains is not left out.
  it('find every rule of a tab, a card or a task form the cases below break', () => {
    expect(formRules(input.conversion).map((found) => `${found.path} ${found.at}`)).toEqual(
      FORM_RULES,
    );
  });

  // One case a rule and a change: each runs check 5 once. Twelve in one test ran the whole harness
  // twelve times, more than the time a test is given on a loaded runner.
  describe.each(['dropped', 'inverted'] as const)(
    'fail on every rule of a tab, a card or a task form %s, one by one',
    (change) => {
      it.each(FORM_RULES)('%s', (where) => {
        const found = formRules(input.conversion).find(
          (holder) => `${holder.path} ${holder.at}` === where,
        );
        if (!found) throw new Error(`no rule at ${where}`);
        if (change === 'dropped') delete found.holder['visibleWhen'];
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
        expect(run(broken, 5)?.status).toBe('fail');
      });
    },
  );

  it('fails on a block card moved out from under its rule, and on a tab no tab gives', () => {
    const moved = edit(input, 'layouts/Policy/view.layout.json', (file) => {
      const view = file.tabs.find((tab: { id: string }) => tab.id === 'view');
      const [terms] = view.cards.splice(2, 1);
      view.cards[0].fields.push(...terms.fields);
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it shows po:terms of the layout block acme-policy-terms outside the card acme-policy-terms and its rule, though Web UI shows the block only while a condition passes',
    ]);
    const invented = edit(input, 'layouts/Policy/view.layout.json', (file) => {
      file.tabs.push({ id: 'extra', cards: [{ id: 'extra.x', fields: ['po:number'] }] });
      return file;
    });
    expect(run(invented, 2)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it has a tab extra, which no tab of the package gives',
    ]);
  });

  it("fails on a task form no task layout gives, and on a property Web UI's task layout does not show", () => {
    const invented = edit(input, 'tasks/Other.Step.layout.json', () => ({ version: 2, cards: [] }));
    expect(run(invented, 2)?.findings).toEqual([
      'tasks/Other.Step.layout.json: the package has no task layout of that workflow and step',
    ]);
    const record = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields.push('cl:amount');
      return file;
    });
    expect(run(record, 2)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: it shows cl:amount, which Web UI's task layout of ClaimReview.AssessClaim does not",
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
      'layouts/Policy/view.layout.json: tabs.0.cards.0.fields.1.visibleWhen holds a rule that no condition of the package gives',
    ]);
  });

  it("fails when a task form's rule sits on a field of no condition", () => {
    const slipped = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[2].visibleWhen = 'app.rules.isLocked';
      return file;
    });
    expect(run(slipped, 5)?.findings).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.2.visibleWhen holds a rule that no condition of the package gives',
    ]);
    // Only a field read-only always is the display mode's; any other rule is a condition's.
    const ruled = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[4].readOnlyWhen = 'app.rules.isLocked';
      return file;
    });
    expect(run(ruled, 5)?.findings).toEqual([
      'tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.4.readOnlyWhen holds a rule that no condition of the package gives',
    ]);
    // A permission rule in a task form, whichever file its condition is in, never passes in Web UI.
    const permission = edit(input, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields[0].visibleWhen = {
        type: 'core.every',
        parameters: ['app.rules.canWrite'],
      };
      return file;
    });
    expect(run(permission, 5)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.0.visibleWhen reads a permission, which Web UI's task page does not fetch, so Web UI never shows what it guards there",
    ]);
  });

  it("fails on a guarded block's field moved under another block's rule", () => {
    const two = prepare({
      [VIEW]: `<dom-module id="nuxeo-policy-view-layout"><template>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><acme-policy-terms document="[[document]]"></acme-policy-terms></template></nuxeo-filter>
<nuxeo-filter document="[[document]]" facet="Versionable"><template><acme-policy-summary document="[[document]]"></acme-policy-summary></template></nuxeo-filter>
</template><script>Polymer({ is: 'nuxeo-policy-view-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    const moved = edit(two, 'layouts/Policy/view.layout.json', (file) => {
      const view = file.tabs.find((tab: { id: string }) => tab.id === 'view');
      const [terms] = view.cards.splice(0, 1);
      view.cards[0].fields.push(...terms.fields);
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it shows po:terms of the layout block acme-policy-terms outside the card acme-policy-terms and its rule, though Web UI shows the block only while a condition passes',
    ]);
  });

  it('holds a rule to its field though a block given no document names the same property', () => {
    const named = prepare({
      [VIEW]: `<dom-module id="nuxeo-policy-view-layout"><template>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><div role="widget"><label>Terms</label><div>[[document.properties.po:terms]]</div></div></template></nuxeo-filter>
<acme-policy-terms></acme-policy-terms>
</template><script>Polymer({ is: 'nuxeo-policy-view-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    const dropped = edit(named, 'layouts/Policy/view.layout.json', (file) => {
      const view = file.tabs.find((tab: { id: string }) => tab.id === 'view');
      delete view.cards[0].fields[0].visibleWhen;
      return file;
    });
    expect(run(dropped, 5)?.findings).toEqual([
      'layouts/Policy/view.layout.json: it shows po:terms to everyone, though Web UI shows it only while condition 1 passes',
    ]);
  });

  it('keeps a field Web UI edits editable however it is wrapped, and makes one it only shows read-only in an edit form', () => {
    const wrapped = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<div role="widget"><label>Notes</label><nuxeo-textarea value="{{task.variables.notes}}"></nuxeo-textarea></div>
<input role="widget" value="{{task.variables.decision::input}}">
</template></dom-module>`,
    });
    const form = wrapped.conversion.app['tasks/ClaimReview.AssessClaim.layout.json'] as {
      cards: { fields: unknown[] }[];
    };
    expect(form.cards[0].fields).toEqual([{ field: 'var:notes', label: 'Notes' }, 'var:decision']);
    expect(run(wrapped, 2)?.status).toBe('pass');
    // An edit form is version 2, which makes a field read-only: one Web UI only shows is, and
    // check 2 holds it so.
    const edit1 = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    expect(entry(input.conversion, `block-field:${edit1}#1.1`)).toMatchObject({
      outcome: 'converted',
      to: 'layouts/Policy/edit.layout.json',
    });
    const editable = edit(input, 'layouts/Policy/edit.layout.json', (file) => {
      expect(file.cards[1].fields[0]).toMatchObject({
        field: 'po:holder',
        readOnlyWhen: 'core.true',
      });
      delete file.cards[1].fields[0].readOnlyWhen;
      return file;
    });
    expect(run(editable, 2)?.findings).toEqual([
      "layouts/Policy/edit.layout.json: po:holder is editable, but Web UI's div only shows it",
    ]);
  });
});

describe("tabs as Web UI's slots register them", () => {
  const bundle = (items: string): Record<string, string> => ({
    [TABS]: items,
  });
  const page = (name: string) =>
    `<nuxeo-slot-content name="${name}Page" slot="DOCUMENT_VIEWS_PAGES"><template><nuxeo-filter document="[[document]]" type="Policy"><template><acme-policy-terms name="${name}" document="[[document]]"></acme-policy-terms></template></nuxeo-filter></template></nuxeo-slot-content>`;
  const item = (name: string, extra = '') =>
    `<nuxeo-slot-content name="${name}Item" slot="DOCUMENT_VIEWS_ITEMS"${extra}><template><nuxeo-filter document="[[document]]" type="Policy"><template><nuxeo-page-item name="${name}" label="${name}"></nuxeo-page-item></template></nuxeo-filter></template></nuxeo-slot-content>`;
  const tabs = (input: HarnessInput) =>
    (
      (input.conversion.app['layouts/Policy/view.layout.json'] as { tabs?: { id: string }[] })
        .tabs ?? []
    ).map((tab) => tab.id);
  const note = (input: HarnessInput, index: number) =>
    entry(input.conversion, `slot-contribution:${TABS}#${index}`);

  it('shows nothing of a disabled contribution', () => {
    const disabled = prepare(bundle(item('a', ' disabled') + page('a')));
    expect(tabs(disabled)).toEqual([]);
    expect(note(disabled, 1)).toMatchObject({
      outcome: 'reported',
      note: 'It is disabled, so Web UI shows nothing of it: it is left out',
    });
    expect(note(disabled, 2)?.note).toContain('No tab of the package opens it');
  });

  it('lets a later contribution of the same name replace, change or yield to an earlier one', () => {
    const replaced = prepare(
      bundle(
        item('a') +
          `<nuxeo-slot-content name="aItem" slot="DOCUMENT_VIEWS_ITEMS"><template><nuxeo-filter document="[[document]]" type="Policy"><template><nuxeo-page-item name="b" label="b"></nuxeo-page-item></template></nuxeo-filter></template></nuxeo-slot-content>` +
          page('a') +
          page('b'),
      ),
    );
    expect(tabs(replaced)).toEqual(['view', 'b']);
    expect(note(replaced, 1)?.note).toContain('replaces it');
    const hidden = prepare(
      bundle(
        item('a') +
          '<nuxeo-slot-content name="aItem" slot="DOCUMENT_VIEWS_ITEMS" disabled></nuxeo-slot-content>' +
          page('a'),
      ),
    );
    expect(tabs(hidden)).toEqual([]);
    expect(note(hidden, 1)?.note).toBe(
      'It is disabled, so Web UI shows nothing of it: it is left out',
    );
    expect(note(hidden, 2)?.note).toContain('only changes the earlier contribution');
    const ignored = prepare(
      bundle(
        item('a', ' priority="5"') +
          `<nuxeo-slot-content name="aItem" slot="DOCUMENT_VIEWS_ITEMS"><template><nuxeo-page-item name="b"></nuxeo-page-item></template></nuxeo-slot-content>` +
          page('a'),
      ),
    );
    expect(tabs(ignored)).toEqual(['view', 'a']);
    expect(note(ignored, 2)?.note).toContain('has a higher priority');
    const stock = prepare(
      bundle(
        '<nuxeo-slot-content name="documentPermissionsItem" slot="DOCUMENT_VIEWS_ITEMS" disabled></nuxeo-slot-content>',
      ),
    );
    expect(note(stock, 1)?.note).toContain("Web UI's own named documentPermissionsItem");
  });

  it("orders a tab with no order at 0, as Web UI's slot does, after the record page's own", () => {
    const unordered = prepare(bundle(item('a', ' order="30"') + item('b') + page('a') + page('b')));
    expect(tabs(unordered)).toEqual(['view', 'b', 'a']);
    expect(note(unordered, 2)?.note).toContain('at order 0');
  });

  it('reports a tab on a type it cannot be written for, and says why for each', () => {
    const both = prepare(
      bundle(
        item('a').replace('type="Policy"', 'type="Policy, Party"') +
          page('a').replace('type="Policy"', 'type="Policy, Party"'),
      ),
    );
    expect(tabs(both)).toEqual(['view', 'a']);
    expect(note(both, 1)).toMatchObject({
      outcome: 'reported',
      to: 'layouts/Policy/view.layout.json tabs.a',
      note: expect.stringContaining(
        'Web UI shows it on Party too, where the package writes no view layout of Party',
      ),
    });
    const preview = prepare({
      ...bundle(item('a') + page('a')),
      [VIEW]: `<dom-module id="nuxeo-policy-view-layout"><template><nuxeo-document-viewer role="widget" document="[[document]]"></nuxeo-document-viewer></template><script>Polymer({ is: 'nuxeo-policy-view-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(note(preview, 1)?.note).toContain(
      "the view layout of Policy shows only the document's preview",
    );
  });
});

describe('task layouts, read as Web UI reads them', () => {
  it('reports a permission test of a block a task layout uses, and a required field of the record', () => {
    const task = prepare({
      [`${UI}/acme-blocks/acme-secure.html`]: `<dom-module id="acme-secure"><template>
<nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><div role="widget"><label>Terms</label><div>[[document.properties.po:terms]]</div></div></template></nuxeo-filter>
<div role="widget"><label>Holder</label><div>[[document.properties.po:holder]]</div></div>
</template><script>Polymer({ is: 'acme-secure', behaviors: [Nuxeo.LayoutBehavior] });</script></dom-module>`,
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<acme-secure document="[[document]]"></acme-secure>
<nuxeo-input role="widget" label="Title" value="{{document.properties.dc:title}}" required></nuxeo-input>
</template></dom-module>`,
    });
    expect(task.conversion.app['tasks/ClaimReview.AssessClaim.layout.json']).toEqual({
      version: 2,
      cards: [
        { id: 'acme-secure', fields: [{ field: 'po:holder', label: 'Holder' }] },
        { id: 'fields', fields: [{ field: 'dc:title', label: 'Title' }] },
      ],
    });
    expect(entry(task.conversion, `block-field:${TASK}#1.1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining('without its permissions'),
    });
    expect(entry(task.conversion, `task-field:${TASK}#1`)).toMatchObject({
      outcome: 'reported',
      to: 'tasks/ClaimReview.AssessClaim.layout.json',
      note: expect.stringContaining('Written without its required flag'),
    });
    expect(run(task, 2)?.status).toBe('pass');
    expect(run(task, 10)?.status).toBe('pass');
    // Check 2 fails it when the report does not say so.
    const unsaid = {
      ...task,
      conversion: {
        ...task.conversion,
        report: {
          ...task.conversion.report,
          constructs: task.conversion.report.constructs.map((construct) =>
            construct.id === `task-field:${TASK}#1`
              ? { ...construct, outcome: 'converted' as const, note: undefined }
              : construct,
          ),
        },
      },
    };
    expect(run(unsaid, 2)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: dc:title is required in Web UI, which a task form cannot say of the record's property, and the report does not say so",
    ]);
    // Its rule written after all fails check 5, though the block's condition decides it.
    const ruled = edit(task, 'tasks/ClaimReview.AssessClaim.layout.json', (file) => {
      file.cards[0].fields.unshift({
        field: 'po:terms',
        label: 'Terms',
        visibleWhen: 'app.rules.canWrite',
      });
      return file;
    });
    expect(run(ruled, 5)?.findings).toEqual([
      "tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.0.visibleWhen reads a permission, which Web UI's task page does not fetch, so Web UI never shows what it guards there",
    ]);
  });

  it('reads an edit only from an input bound two ways to the path itself', () => {
    const bound = prepare({
      [TASK]: `<dom-module id="nuxeo-assessclaim-layout"><template>
<nuxeo-user-tag role="widget" label="Reviewer" user="{{task.variables.reviewer}}"></nuxeo-user-tag>
<nuxeo-date role="widget" label="Follow up" datetime="{{task.variables.followUp}}"></nuxeo-date>
<nuxeo-input role="widget" label="Notes" value="{{task.variables.notes}}" readonly></nuxeo-input>
<nuxeo-input role="widget" label="Decision" value="{{format(task.variables.decision)}}"></nuxeo-input>
<input role="widget" value="{{task.variables.override::input}}">
</template></dom-module>`,
    });
    expect(
      bound.inventory.taskLayouts.find((t) => t.path === TASK)?.fields.map((f) => f.edits),
    ).toEqual([false, false, false, false, true]);
    const edit1 = `${UI}/document/policy/nuxeo-policy-edit-layout.html`;
    const native = prepare({
      [edit1]: `<dom-module id="nuxeo-policy-edit-layout"><template>
<input role="widget" value="{{document.properties.po:holder::input}}">
</template><script>Polymer({ is: 'nuxeo-policy-edit-layout', behaviors: [Nuxeo.LayoutBehavior], properties: { /** @doctype Policy */ document: { type: Object } } });</script></dom-module>`,
    });
    expect(entry(native.conversion, `layout-field:${edit1}#1`)).toMatchObject({
      outcome: 'converted',
    });
  });
});
