import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLayoutV2 } from './lib/layout-v2';
import { readContentModel } from './lib/content-model';
import { validateQueue } from './lib/queue';
import { PACKAGED_REGISTRIES } from './lib/registries';
import { withPackageActions } from './lib/package';
import { validate, validateDeploymentFile } from './server-validator';
import { OUTPUT, PARITY, REPO, buildOutputs, outOfDate } from './server-validator-build.mjs';

const KIT = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const model = read(join(KIT, 'content-model.json'));
const actions = read(join(KIT, 'bundle', 'agentic-ui-config', 'actions.json'));
const claimView = read(
  join(KIT, 'bundle', 'agentic-ui-config', 'layouts', 'Claim', 'view.layout.json'),
);
const myClaims = read(join(KIT, 'bundle', 'agentic-ui-config', 'queues', 'my-claims.json'));

describe('the validator the server runs', () => {
  it('is, with its parity corpus, what this source builds now', async () => {
    const stale = outOfDate(await buildOutputs(validateDeploymentFile));
    expect(stale.map(({ path }) => path)).toEqual([]);
  });

  it('is told apart from what it would be after a change to the source', async () => {
    // The check above compares bytes: a validator that answered otherwise would build another
    // corpus. Broken on purpose, the comparison sees it.
    const outputs = await buildOutputs((request) => ({
      findings: [{ path: '', kind: 'structure', message: `changed: ${request.path}` }],
    }));
    expect(outOfDate(outputs).map(({ path }) => path)).toEqual([PARITY]);
    expect(
      outOfDate([{ path: OUTPUT, text: '// another script\n' }]).map(({ path }) => path),
    ).toEqual([OUTPUT]);
  });
});

describe('validateDeploymentFile', () => {
  const read = readContentModel(model);
  if (!read.model) throw new Error('the kit model reads');

  it('gives a layout file the findings validateLayoutV2 gives it, in its mode, held to the model', () => {
    const broken = { version: 2, cards: [{ id: 'a', fields: ['zz:nope'] }], bogus: 1 };
    const answer = validateDeploymentFile({
      path: 'layouts/Claim/edit.layout.json',
      content: broken,
      model,
    });
    expect(answer).toEqual({
      findings: validateLayoutV2(broken, {
        mode: 'edit',
        model: read.model,
        type: 'Claim',
        registries: PACKAGED_REGISTRIES,
      }),
    });
    expect('findings' in answer && answer.findings.length).toBe(2);
    expect(
      validateDeploymentFile({ path: 'layouts/Claim/view.layout.json', content: claimView, model }),
    ).toEqual({
      findings: [],
    });
  });

  it("gives a queue the findings validateQueue gives it with the app's own actions", () => {
    expect(
      validateDeploymentFile({ path: 'queues/my-claims.json', content: myClaims, model, actions }),
    ).toEqual({
      findings: validateQueue(myClaims, {
        registries: withPackageActions(PACKAGED_REGISTRIES, actions),
      }),
    });
    const without = validateDeploymentFile({
      path: 'queues/my-claims.json',
      content: myClaims,
      model,
    });
    // Without the app's own actions, each of them the queue names is unknown, and nothing else is.
    const own = ((myClaims as { rowActions?: string[] }).rowActions ?? []).filter(
      (id) => !id.startsWith('app.'),
    );
    expect(own.length).toBeGreaterThan(0);
    expect('findings' in without && without.findings.map((finding) => finding.kind)).toEqual(
      own.map(() => 'unknown'),
    );
  });

  it.each([
    'home.json',
    'navigation.json',
    'actions.json',
    'app.json',
    'labels/en.json',
    'tasks/PayersClaimReview.determine.layout.json',
    'layouts/Claim/metadata.layout.json',
    'x/layouts/Claim/view.layout.json',
    '../layouts/Claim/view.layout.json',
  ])('refuses %s, which no deployment layer holds', (path) => {
    const answer = validateDeploymentFile({ path, content: {}, model });
    expect(answer).toHaveProperty('refused');
  });

  it('refuses a file it cannot hold to the model', () => {
    const answer = validateDeploymentFile({
      path: 'layouts/Claim/view.layout.json',
      content: claimView,
      model: { doctypes: {} },
    });
    expect('refused' in answer && answer.refused).toMatch(/content model cannot be read/);
  });

  it('knows what the deployment registers, and refuses a list that is not one of ids', () => {
    const file = {
      version: 2,
      cards: [{ id: 'a', visibleWhen: 'acme.rules.custom', fields: ['dc:title'] }],
    };
    const path = 'layouts/Claim/view.layout.json';
    expect(validateDeploymentFile({ path, content: file, model })).not.toEqual({ findings: [] });
    expect(
      validateDeploymentFile({
        path,
        content: file,
        model,
        registered: { rules: ['acme.rules.custom'] },
      }),
    ).toEqual({ findings: [] });
    expect(
      validateDeploymentFile({
        path,
        content: file,
        model,
        registered: { rules: [''] },
      }),
    ).toHaveProperty('refused');
  });

  it('refuses a template longer than the record page draws, and reads one of many braces in one pass', () => {
    const named = (text: string) => ({
      version: 2,
      cards: [
        { id: 'a', fields: [{ id: 'n', computed: { type: 'core.template', parameters: [text] } }] },
      ],
    });
    const path = 'layouts/Claim/view.layout.json';
    const long = validateDeploymentFile({ path, content: named('x'.repeat(1001)), model });
    expect('findings' in long && long.findings.map((finding) => finding.message)).toEqual([
      'the computation "core.template" takes a text of at most 1000 characters, not 1001',
    ]);
    // A thousand braces that close nothing: read once each, not once from each of them.
    const started = performance.now();
    const braces = validateDeploymentFile({ path, content: named('{'.repeat(1000)), model });
    expect(performance.now() - started).toBeLessThan(500);
    expect(braces).toEqual({ findings: [] });
    expect(
      validateDeploymentFile({ path, content: named('{dc:title} {x}'), model }),
    ).toHaveProperty('findings', [
      {
        path: 'cards[0].fields[0].computed.parameters[0]',
        kind: 'parameter',
        message: 'the placeholder {x} is not a property, <prefix>:<name>',
      },
    ]);
  });

  it('answers JSON text with JSON text, and refuses text that is not JSON', () => {
    expect(JSON.parse(validate('not json'))).toEqual({ refused: 'the request is not JSON' });
    expect(
      JSON.parse(validate(JSON.stringify({ path: 'home.json', content: {}, model }))),
    ).toHaveProperty('refused');
  });
});
