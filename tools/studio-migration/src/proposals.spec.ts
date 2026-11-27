/**
 * Accepting and rejecting a proposal (docs/business-apps/studio-migration.md, sections 3, 6 and
 * 8): what a person decides in `decisions.json` is what the converter writes, and the harness holds
 * the conversion to it. Nothing proposed is written unless a person accepted it; a rejected one is
 * reported with their reason; readiness needs every proposal decided, and the conversion made with
 * those decisions. Each rule has a control in `mutations.ts`, `PROPOSAL_MUTATIONS`, seen failing.
 */
import { loadCatalogue } from './catalogue';
import { constructsOf, identitiesOf, sharedIdentities } from './constructs';
import {
  convert,
  convertWithDecisions,
  packageBuildOf,
  type Conversion,
  type ReportEntry,
} from './convert';
import { decisionsFor, holdDecisions, type DecisionsFile } from './decisions';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MutationError, PROPOSAL_MUTATIONS } from './mutations';
import { summarise } from './report';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticBundleFiles, syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

/** The view layout's `dom-if` of the made-up package, a known pattern: its rule is proposed. */
const VIEW_IF = `condition:${UI}/document/claim/nuxeo-claim-view-layout.html#2`;
/** The field it guards, proposed with it. */
const TAGS = `layout-field:${UI}/document/claim/nuxeo-claim-view-layout.html#5`;

/**
 * What the made-up package lacks for proposals beyond fields: a button under a filter whose
 * expression is a known pattern, and a dashboard card an operation feeds, the favourites card.
 */
const PROPOSALS_CORPUS: Readonly<Record<string, string>> = {
  [`${UI}/nuxeo-Acme-Claims-proposals-bundle.html`]: `<!--
STUDIO CODE SPACE
-->
<nuxeo-slot-content name="reviewClaim" slot="DOCUMENT_ACTIONS" order="70">
  <template>
    <nuxeo-filter document="[[document]]" expression="this.hasFacet(document, 'Versionable')">
      <template><nuxeo-operation-button icon="icons:check" label="Review" operation="Claim.Approve" input="[[document]]" params='{"comment": "Reviewed"}'></nuxeo-operation-button></template>
    </nuxeo-filter>
  </template>
</nuxeo-slot-content>`,
  [`${UI}/nuxeo-home.html`]: (syntheticBundleFiles()[`${UI}/nuxeo-home.html`] ?? '').replace(
    '<nuxeo-card heading="My tasks">',
    '<nuxeo-card heading="Favourites"><nuxeo-operation op="Favorite.Fetch"></nuxeo-operation><nuxeo-page-provider provider="default_content_collection"></nuxeo-page-provider></nuxeo-card>\n      <nuxeo-card heading="My tasks">',
  ),
};
const BUTTON_IF = `condition:${UI}/nuxeo-Acme-Claims-proposals-bundle.html#1`;
const FAVOURITES = `dashboard-card:${UI}/nuxeo-home.html#3`;

function prepare(bundle?: Record<string, string>): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage(bundle ? { bundle } : {}));
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convert(pkg, read, catalogue, { allowList: ALLOW_LIST }),
  };
}

type Verdicts = Readonly<
  Record<
    string,
    | 'accept'
    | 'reject'
    | { readonly decision: string; readonly owner?: string; readonly reason?: string }
  >
>;

/** The decisions file of the conversion, every reported item decided, each proposal as given. */
function filled(input: HarnessInput, verdicts: Verdicts): DecisionsFile {
  const constructs = constructsOf(input.inventory);
  const { file } = decisionsFor(
    input.conversion.report,
    packageBuildOf(input.pkg),
    identitiesOf(input.inventory),
    sharedIdentities(constructs),
  );
  return {
    ...file,
    decisions: file.decisions.map((item) => {
      if (item.outcome !== 'proposed')
        return { ...item, owner: 'Migration lead', decision: `Kept as reported: ${item.label}` };
      const given = verdicts[item.id];
      if (given === undefined) return item;
      return typeof given === 'string'
        ? { ...item, owner: 'Dana Reviewer', decision: given, reason: `Checked: ${given}` }
        : { ...item, owner: 'Dana Reviewer', reason: 'Checked', ...given };
    }),
  };
}

/**
 * The run `migrate --from` makes of a filled file: the conversion made with it, and its decisions
 * carried beside it, as the `decisions` step carries them.
 */
function decidedRun(input: HarnessInput, file: DecisionsFile): HarnessInput {
  const earlier = { raw: JSON.parse(JSON.stringify(file)) as unknown, file: 'earlier.json' };
  const conversion = convertWithDecisions(
    input.pkg,
    input.inventory,
    catalogue,
    { allowList: ALLOW_LIST },
    earlier,
  );
  const constructs = constructsOf(input.inventory);
  const carried = decisionsFor(
    conversion.report,
    packageBuildOf(input.pkg),
    identitiesOf(input.inventory),
    sharedIdentities(constructs),
    earlier,
  ).file;
  return { ...input, conversion: { ...conversion, decisions: carried } };
}

const entry = (conversion: Conversion, id: string): ReportEntry | undefined =>
  conversion.report.constructs.find((candidate) => candidate.id === id);

/** Every field of the view layout of Claim, by its property. */
function viewFields(conversion: Conversion): Map<string, Record<string, unknown>> {
  const view = conversion.app['layouts/Claim/view.layout.json'] as {
    cards: { fields: (string | Record<string, unknown>)[] }[];
  };
  return new Map(
    view.cards
      .flatMap((card) => card.fields)
      .map((field) =>
        typeof field === 'string' ? [field, { field }] : [String(field['field']), field],
      ),
  );
}

describe('a proposal nobody has decided', () => {
  const input = prepare();

  it('is written nowhere, and stays a proposal with what it proposes', () => {
    expect(viewFields(input.conversion).has('cl:tags')).toBe(false);
    expect(entry(input.conversion, VIEW_IF)).toMatchObject({
      outcome: 'proposed',
      proposal: true,
      rule: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
    });
    expect(entry(input.conversion, VIEW_IF)).not.toHaveProperty('applied');
    expect(entry(input.conversion, VIEW_IF)).not.toHaveProperty('to');
    // What it guards is proposed with it, and takes no decision of its own.
    expect(entry(input.conversion, TAGS)).toMatchObject({ outcome: 'proposed' });
    expect(entry(input.conversion, TAGS)).not.toHaveProperty('proposal');
  });

  it('stands in the way of readiness, with what it guards', () => {
    expect(runHarness(input).blockers).toContain(
      '2 proposals wait for a person to accept or reject them',
    );
  });

  it('is written nowhere when its decision names no one, or gives no reason', () => {
    for (const verdict of [
      { decision: 'accept', owner: '' },
      { decision: 'accept', reason: '   ' },
    ]) {
      const run = decidedRun(input, filled(input, { [VIEW_IF]: verdict }));
      expect(viewFields(run.conversion).has('cl:tags')).toBe(false);
      expect(entry(run.conversion, VIEW_IF)).not.toHaveProperty('applied');
      const blockers = runHarness(run).blockers;
      expect(blockers).toContain(
        "1 proposal is accepted or rejected with no one's name, or no reason",
      );
      expect(blockers).toContain('1 proposals wait for a person to accept or reject them');
    }
  });

  it('is written nowhere when its decision is neither accept nor reject', () => {
    const file = filled(input, { [VIEW_IF]: { decision: 'yes, show it' } });
    // Held as it is, the file says why it takes none of it.
    expect(
      runHarness({ ...input, conversion: { ...input.conversion, decisions: file } }).blockers,
    ).toContain(
      `decisions.json: ${VIEW_IF}: its decision is "yes, show it", and a proposal is decided "accept" or "reject"`,
    );
    // Carried, it is not carried: the proposal waits, and nothing of it is written.
    const run = decidedRun(input, file);
    expect(viewFields(run.conversion).has('cl:tags')).toBe(false);
    expect(runHarness(run).blockers).toContain(
      '2 proposals wait for a person to accept or reject them',
    );
  });
});

describe('a proposal a person accepted', () => {
  const input = prepare();
  const run = decidedRun(input, filled(input, { [VIEW_IF]: 'accept' }));

  it('writes its rule on what it guards, as a converted condition’s is written', () => {
    expect(viewFields(run.conversion).get('cl:tags')).toEqual({
      field: 'cl:tags',
      label: 'Tags',
      visibleWhen: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
    });
    expect(entry(run.conversion, TAGS)).toMatchObject({
      outcome: 'converted',
      to: 'layouts/Claim/view.layout.json',
    });
  });

  it('stays a proposal in the report, with what the conversion did of it and where', () => {
    expect(entry(run.conversion, VIEW_IF)).toMatchObject({
      outcome: 'proposed',
      proposal: true,
      applied: 'accept',
      to: 'the visibleWhen of layouts/Claim/view.layout.json cl:tags',
    });
  });

  it('is held by check 5 as a converted rule is, on every row of its truth table', () => {
    expect(runCheck(run, 5)).toMatchObject({ findings: [] });
    expect(runCheck(run, 2)).toMatchObject({ findings: [] });
    const blockers = runHarness(run).blockers;
    expect(blockers.filter((line) => /proposal/.test(line))).toEqual([]);
  });

  it('counts as accepted in the report, by whom and why', () => {
    const summary = summarise(run);
    expect(summary.all.accepted).toBe(1);
    expect(summary.proposed.find((item) => item.id === VIEW_IF)).toMatchObject({
      status: 'accepted',
      owner: 'Dana Reviewer',
      reason: 'Checked: accept',
      applied: 'accept',
    });
  });

  it('writes the rule of a task form’s field, and of an action, once accepted', () => {
    const corpus = prepare({ ...m2CorpusFiles(), ...PROPOSALS_CORPUS });
    const ids = corpus.conversion.report.constructs
      .filter((candidate) => candidate.outcome === 'proposed' && candidate.proposal === true)
      .map((candidate) => candidate.id);
    const taskIf = ids.find((id) => id.startsWith(`condition:${UI}/workflow/`));
    expect(ids).toEqual(expect.arrayContaining([VIEW_IF, BUTTON_IF, FAVOURITES]));
    if (!taskIf) throw new Error("M2's corpus proposes the task layout's dom-if");
    const verdicts = Object.fromEntries(
      [VIEW_IF, BUTTON_IF, taskIf].map((id) => [id, 'accept' as const]),
    );
    const accepted = decidedRun(corpus, filled(corpus, { ...verdicts, [FAVOURITES]: 'reject' }));
    const task = JSON.stringify(
      accepted.conversion.app['tasks/ClaimReview.AssessClaim.layout.json'],
    );
    expect(task).toContain('"field":"var:versionNote"');
    expect(task).toContain(
      '"visibleWhen":{"type":"app.rules.hasFacet","parameters":["Versionable"]}',
    );
    const actions = accepted.conversion.app['actions.json'] as {
      actions: Record<string, unknown>[];
    };
    expect(actions.actions.find((action) => action['label'] === 'Review')).toMatchObject({
      operation: 'Claim.Approve',
      visibleWhen: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
    });
    for (const check of [2, 5, 7])
      expect([check, runCheck(accepted, check)?.findings]).toEqual([check, []]);
    // Undecided, neither is written.
    const before = JSON.stringify(corpus.conversion.app);
    expect(before).not.toContain('var:versionNote');
    expect(before).not.toContain('"label":"Review"');
  });
});

describe('a proposal a person rejected', () => {
  const input = prepare();
  const run = decidedRun(input, filled(input, { [VIEW_IF]: 'reject' }));

  it('writes nothing, and reports what it guards, for a decision of its own', () => {
    expect(viewFields(run.conversion).has('cl:tags')).toBe(false);
    expect(entry(run.conversion, VIEW_IF)).toMatchObject({
      outcome: 'proposed',
      applied: 'reject',
    });
    expect(entry(run.conversion, VIEW_IF)).not.toHaveProperty('to');
    expect(entry(run.conversion, TAGS)).toMatchObject({
      outcome: 'reported',
      note: 'Condition 2 of its file does not convert: A person rejected the rule proposed for it, {"type":"app.rules.hasFacet","parameters":["Versionable"]}, so nothing it guards is written under it',
    });
    expect(runCheck(run, 5)).toMatchObject({ findings: [] });
  });

  it('is reported with the person’s reason', () => {
    const summary = summarise(run);
    expect(summary.all.rejected).toBe(1);
    expect(summary.proposed.find((item) => item.id === VIEW_IF)).toMatchObject({
      status: 'rejected',
      owner: 'Dana Reviewer',
      reason: 'Checked: reject',
    });
    // What it guards is now a reported item, which takes an owner and a decision.
    expect(summary.reported.map((item) => item.id)).toContain(TAGS);
  });

  it('decides a card an operation feeds, which can be rejected and not accepted', () => {
    const corpus = prepare(PROPOSALS_CORPUS);
    const rejected = decidedRun(corpus, filled(corpus, { [FAVOURITES]: 'reject' }));
    expect(entry(rejected.conversion, FAVOURITES)).toMatchObject({
      outcome: 'proposed',
      proposal: true,
      applied: 'reject',
    });
    expect(JSON.stringify(rejected.conversion.app)).not.toContain('default_content_collection');
    const accepted = filled(corpus, { [FAVOURITES]: 'accept' });
    const held = holdDecisions(
      corpus.conversion.report,
      accepted,
      packageBuildOf(corpus.pkg),
      identitiesOf(corpus.inventory),
    );
    expect(held.findings).toContain(
      `decisions.json: ${FAVOURITES} proposes nothing the converter can write yet, so it cannot be accepted: reject it, with your reason, or leave it for the mapping agent`,
    );
    expect(held.verdicts.has(FAVOURITES)).toBe(false);
  });
});

describe('readiness and the conversion the decisions were made for', () => {
  const input = prepare();

  it('says a conversion was made with other decisions than decisions.json holds now', () => {
    // Accepted in the file after the run that made the conversion, as a person fills it in.
    const after = {
      ...input,
      conversion: { ...input.conversion, decisions: filled(input, { [VIEW_IF]: 'accept' }) },
    };
    const blockers = runHarness(after).blockers;
    expect(blockers).toContain(
      `the conversion was made with 1 of its proposals decided otherwise than decisions.json decides them now, such as ${VIEW_IF}: convert it again with the decisions, as migrate --from does`,
    );
    // And check 5 holds the accepted rule's field to be written.
    expect(runCheck(after, 5)?.findings).toEqual([
      "layouts/Claim/view.layout.json: cl:tags is missing, though Web UI's view layout of Claim shows it while a condition passes, and its rule converts",
    ]);
  });

  it('has no proposal in the way once each is decided and the conversion made with it', () => {
    const run = decidedRun(input, filled(input, { [VIEW_IF]: 'accept' }));
    expect(
      runHarness(run).blockers.filter((line) =>
        /proposal|decisions\.json|reported item/.test(line),
      ),
    ).toEqual([]);
  });
});

// The controls of the proposals: each writes what a person decided otherwise, and check 5 fails.
describe('each deliberate breakage of the proposals fails check 5', () => {
  const corpus = prepare({ ...m2CorpusFiles(), ...PROPOSALS_CORPUS });
  const taskIf = corpus.conversion.report.constructs.find(
    (candidate) =>
      candidate.proposal === true && candidate.id.startsWith(`condition:${UI}/workflow/`),
  )?.id as string;
  // One accepted, one rejected, one undecided: each control has what it breaks.
  const run = decidedRun(corpus, filled(corpus, { [VIEW_IF]: 'accept', [taskIf]: 'reject' }));
  const pristine = JSON.stringify(run.conversion);

  it('has a conversion its checks pass, each proposal accepted, rejected or waiting', () => {
    expect(taskIf).toBeDefined();
    expect(entry(run.conversion, BUTTON_IF)).not.toHaveProperty('applied');
    for (const check of [2, 5, 7])
      expect([check, runCheck(run, check)?.findings]).toEqual([check, []]);
  });

  for (const mutation of PROPOSAL_MUTATIONS) {
    it(`${mutation.name}: ${mutation.description}`, () => {
      const { conversion, changed } = mutation.apply(run.conversion, run);
      expect(JSON.stringify(run.conversion)).toBe(pristine);
      expect(changed.length).toBeGreaterThan(0);
      const result = runCheck({ ...run, conversion }, mutation.caughtBy);
      expect(result?.status).toBe('fail');
      expect(runHarness({ ...run, conversion }).blockers).toContain(
        `check ${mutation.caughtBy} failed`,
      );
    });
  }

  it.each([
    [
      'write-undecided-proposal',
      ['actions.json: actions.4.visibleWhen holds a rule that no condition of the package gives'],
    ],
    [
      'write-rejected-proposal',
      [
        'tasks/ClaimReview.AssessClaim.layout.json: cards.0.fields.6.visibleWhen holds a rule that no condition of the package gives',
      ],
    ],
    [
      'drop-accepted-proposal',
      [
        "layouts/Claim/view.layout.json: cl:tags is missing, though Web UI's view layout of Claim shows it while a condition passes, and its rule converts",
      ],
    ],
  ])('%s names what broke', (name, findings) => {
    const mutation = PROPOSAL_MUTATIONS.find((candidate) => candidate.name === name);
    if (!mutation) throw new Error(name);
    const broken = mutation.apply(run.conversion, run).conversion;
    expect(runCheck({ ...run, conversion: broken }, 5)?.findings).toEqual(findings);
  });

  it('refuses without the package, and says so where there is nothing to break', () => {
    for (const mutation of PROPOSAL_MUTATIONS)
      expect(() => mutation.apply(run.conversion)).toThrow(/--package/);
    // Nothing decided: nothing accepted to leave out, nothing rejected to write.
    const blank = prepare();
    for (const name of ['write-rejected-proposal', 'drop-accepted-proposal'])
      expect(() =>
        PROPOSAL_MUTATIONS.find((m) => m.name === name)?.apply(blank.conversion, blank),
      ).toThrow(MutationError);
  });
});
