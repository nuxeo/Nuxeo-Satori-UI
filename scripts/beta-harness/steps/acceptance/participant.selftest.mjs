/**
 * Offline controls for the acceptance tests' shared checks (`participant.mjs`): what can be judged
 * without a server or a browser. Each control feeds in what a check must refuse, and what it must
 * pass, and fails when the check says otherwise.
 *
 *   node scripts/beta-harness/steps/acceptance/participant.selftest.mjs
 *
 * - The participant's package: unset, not a package, and the reference kit under another spelling
 *   and through a link, each refused; a package passed.
 * - The session's commit: unset and unknown refused, a commit passed.
 * - The checkout held to the package: in a scratch git repository, a change inside the package
 *   passes; a tracked file changed outside it, one committed since the session's commit, one
 *   deleted and one untracked are each named; a file git ignores is not.
 * - The bundle held to data: JSON, XML, XSD and the manifest pass; a script, a zip and a missing
 *   bundle are each named.
 * - A copy of the reference's layout found under another `$schema`, and one changed field not.
 * - The page held to its file: the file's cards in order with their headings pass, and a card with
 *   a rule left out; a card missing, another's, out of order, headed otherwise or with no text in
 *   the labels, a file of tabs and no file at all, each named.
 * - The 404s left to the registry: a home, a menu and actions the package does not hold, and the
 *   queues of a menu that is not its own; not one it holds, its own menu's queues, the labels, a
 *   layout, or another status.
 * - The queue: none the package's failure; two with none named and one named that is not there
 *   refused; one passed.
 *
 * Exit 0 when every control holds, 1 otherwise. Everything it writes is in a temporary directory,
 * removed at the end: nothing tracked is touched.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  changedOutside,
  codeInPackage,
  differsFromFile,
  participantPackage,
  participantQueue,
  sameJson,
  sessionBase,
  unheldFileErrors,
  withoutSchema,
} from './participant.mjs';

let failures = 0;
let count = 0;
function check(name, condition, detail = '') {
  count += 1;
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ''}`);
  }
}

/** `fn` run with `env` set, each `undefined` unset, and the environment put back after. */
function withEnv(env, fn) {
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(before))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'acceptance-selftest-'));
const write = (path, text = '{}\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
const git = (args) =>
  spawnSync(
    'git',
    ['-C', scratch, '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.com', ...args],
    { encoding: 'utf8' },
  );

try {
  // A scratch repository: a reference kit, a participant's package and a platform file.
  const repo = scratch;
  const reference = join(repo, 'business-apps', 'packages', 'reference-demo');
  const theirs = join(repo, 'business-apps', 'packages', 'rebuilt');
  write(join(reference, 'bundle', 'agentic-ui-config', 'app.json'));
  write(join(theirs, 'bundle', 'agentic-ui-config', 'app.json'));
  write(join(theirs, 'bundle', 'META-INF', 'MANIFEST.MF'), 'Manifest-Version: 1.0\n');
  write(join(theirs, 'bundle', 'OSGI-INF', 'rebuilt-config.xml'), '<component/>\n');
  write(join(repo, 'libs', 'platform', 'index.ts'), 'export const x = 1;\n');
  write(join(repo, '.gitignore'), 'ignored/\n');
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).stdout.trim();

  console.log("\nThe participant's package");
  const named = (value) =>
    withEnv({ ACCEPTANCE_PACKAGE: value }, () => participantPackage(repo, reference));
  check('unset, refused', typeof named(undefined).problem === 'string');
  check(
    'a folder with no bundle/agentic-ui-config, refused',
    typeof named('libs').problem === 'string',
  );
  check(
    'the reference kit, refused',
    typeof named('business-apps/packages/reference-demo').problem === 'string',
  );
  check(
    'the reference kit under another spelling, refused',
    typeof named('./business-apps/packages/../packages/reference-demo/').problem === 'string',
  );
  symlinkSync(reference, join(repo, 'linked'));
  check('the reference kit through a link, refused', typeof named('linked').problem === 'string');
  unlinkSync(join(repo, 'linked'));
  const ok = named('business-apps/packages/rebuilt');
  check(
    'a package, passed',
    ok.problem === undefined && typeof ok.dir === 'string',
    JSON.stringify(ok),
  );

  console.log("\nThe session's commit");
  const at = (value) => withEnv({ ACCEPTANCE_BASE: value }, () => sessionBase(repo));
  check('unset, refused', typeof at(undefined).problem === 'string');
  check('not a commit of the clone, refused', typeof at('no-such-ref').problem === 'string');
  check('a commit, passed', at('HEAD').commit === base, JSON.stringify(at('HEAD')));

  console.log('\nThe checkout, held to the package');
  const dir = ok.dir;
  write(join(theirs, 'bundle', 'agentic-ui-config', 'layouts', 'Member', 'view.layout.json'));
  check('a change inside the package passes', sameJson(changedOutside(repo, dir, base), []));
  write(join(repo, 'ignored', 'served.json'));
  check('a file git ignores is not counted', sameJson(changedOutside(repo, dir, base), []));
  write(join(repo, 'libs', 'platform', 'index.ts'), 'export const x = 2;\n');
  check(
    'a tracked file changed outside it is named',
    sameJson(changedOutside(repo, dir, base), ['libs/platform/index.ts']),
    JSON.stringify(changedOutside(repo, dir, base)),
  );
  git(['checkout', '--', 'libs/platform/index.ts']);
  write(join(repo, 'libs', 'platform', 'new.component.ts'), 'export class X {}\n');
  check(
    'an untracked file outside it is named',
    sameJson(changedOutside(repo, dir, base), ['libs/platform/new.component.ts']),
    JSON.stringify(changedOutside(repo, dir, base)),
  );
  git(['add', 'libs/platform/new.component.ts']);
  git(['commit', '-q', '-m', 'after the session started']);
  check(
    "a file committed since the session's commit is named",
    sameJson(changedOutside(repo, dir, base), ['libs/platform/new.component.ts']),
    JSON.stringify(changedOutside(repo, dir, base)),
  );
  git(['rm', '-q', 'libs/platform/index.ts']);
  check(
    'a file deleted outside it is named',
    sameJson(changedOutside(repo, dir, base), [
      'libs/platform/index.ts',
      'libs/platform/new.component.ts',
    ]),
    JSON.stringify(changedOutside(repo, dir, base)),
  );
  check(
    'git not answering gives null, not a pass',
    changedOutside(repo, dir, 'no-such-ref') === null,
  );

  console.log('\nThe bundle, held to data');
  check(
    'JSON, XML and the manifest pass',
    sameJson(codeInPackage(dir), []),
    JSON.stringify(codeInPackage(dir)),
  );
  write(join(theirs, 'bundle', 'agentic-ui-config', 'widget.js'), 'alert(1);\n');
  check(
    'a script is named',
    codeInPackage(dir).some((path) => path.endsWith('widget.js')),
    JSON.stringify(codeInPackage(dir)),
  );
  unlinkSync(join(theirs, 'bundle', 'agentic-ui-config', 'widget.js'));
  write(join(theirs, 'bundle', 'data', 'thing.zip'), 'PK');
  check(
    'a zip is named',
    codeInPackage(dir).some((path) => path.includes('thing.zip')),
    JSON.stringify(codeInPackage(dir)),
  );
  check('a package with no bundle is named', codeInPackage(join(repo, 'libs')).length === 1);

  console.log("\nA copy of the reference's layout");
  const layout = {
    $schema: '../../a.json',
    version: 2,
    cards: [{ id: 'member', fields: ['member:number'] }],
  };
  check(
    'found under another $schema',
    sameJson(withoutSchema(layout), withoutSchema({ ...layout, $schema: '../b.json' })),
  );
  check(
    'one changed field is not a copy',
    !sameJson(
      withoutSchema(layout),
      withoutSchema({ ...layout, cards: [{ id: 'member', fields: ['member:phone'] }] }),
    ),
  );

  console.log('\nThe page, held to its file');
  const file = {
    cards: [
      { id: 'member', labelKey: 'x.member' },
      { id: 'claims', label: 'Claims' },
      { id: 'secret', labelKey: 'x.secret', visibleWhen: { type: 'app.rules.inGroup' } },
    ],
  };
  const texts = { 'x.member': 'Member', 'x.secret': 'Restricted' };
  const drawn = (...cards) => ({ cards: cards.map(([id, heading]) => ({ id, heading })) });
  check(
    "the file's cards in order, with their headings, pass",
    differsFromFile(
      drawn(['member', 'Member'], ['claims', 'Claims'], ['secret', 'Restricted']),
      file,
      texts,
    ) === null,
  );
  check(
    'a card with a rule left out passes',
    differsFromFile(drawn(['member', 'Member'], ['claims', 'Claims']), file, texts) === null,
  );
  check(
    'a card that shows for everyone, missing, is named',
    /claims is not drawn/.test(differsFromFile(drawn(['member', 'Member']), file, texts) ?? ''),
  );
  check(
    "a card that is not the file's is named",
    /other is not the file's/.test(
      differsFromFile(
        drawn(['member', 'Member'], ['claims', 'Claims'], ['other', 'Other']),
        file,
        texts,
      ) ?? '',
    ),
  );
  check(
    "a card out of the file's order is named",
    /member is out of the file's order/.test(
      differsFromFile(drawn(['claims', 'Claims'], ['member', 'Member']), file, texts) ?? '',
    ),
  );
  check(
    'a card headed otherwise is named',
    /headed "Members"/.test(
      differsFromFile(drawn(['member', 'Members'], ['claims', 'Claims']), file, texts) ?? '',
    ),
  );
  check(
    "a card whose key has no text in the package's labels is named",
    /member has no heading/.test(
      differsFromFile(drawn(['member', null], ['claims', 'Claims']), file, {}) ?? '',
    ),
  );
  check(
    'a file of tabs is named, not half judged',
    /in tabs/.test(differsFromFile(drawn(), { tabs: [{ id: 't', cards: [] }] }, texts) ?? ''),
  );
  check(
    'no layout file at all is named',
    /no such layout file/.test(differsFromFile(drawn(), null, texts) ?? ''),
  );

  console.log('\nThe files the package does not hold, and the app asks for');
  const config = ok.config;
  // Judged as the runner's `expectNoConsoleErrors` judges an ignore list: a string is contained, a
  // pattern is matched.
  const ignored = (text) =>
    unheldFileErrors(config).some((each) =>
      typeof each === 'string' ? text.includes(each) : each.test(text),
    );
  check(
    "a home, a menu and actions the package does not hold: their 404 is the registry's to answer",
    ['home.json', 'navigation.json', 'actions.json'].every((file) =>
      ignored(`HTTP 404 /agentic-ui-config/${file}`),
    ),
  );
  check(
    "with no menu of its own, the registry's menu's queues: their 404 is the registry's too",
    ignored('HTTP 404 /agentic-ui-config/queues/unassigned-claims.json'),
  );
  check(
    'the labels, a layout and any other answer than 404 stay judged',
    !ignored('HTTP 404 /agentic-ui-config/labels/en.json') &&
      !ignored('HTTP 404 /agentic-ui-config/layouts/Member/view.layout.json') &&
      !ignored('HTTP 500 /agentic-ui-config/home.json') &&
      !ignored('HTTP 404 /nuxeo/api/v1/search/pp/member_claims/execute'),
  );
  write(join(config, 'navigation.json'));
  check(
    'a menu the package holds: its 404, and those of the queues it names, stay judged',
    !ignored('HTTP 404 /agentic-ui-config/navigation.json') &&
      !ignored('HTTP 404 /agentic-ui-config/queues/unassigned-claims.json'),
    JSON.stringify(unheldFileErrors(config).map(String)),
  );

  console.log('\nThe queue');
  const queueOf = (value) => withEnv({ ACCEPTANCE_QUEUE: value }, () => participantQueue(config));
  check(
    "none: the package's failure, not a precondition",
    queueOf(undefined).none === true && queueOf(undefined).id === undefined,
    JSON.stringify(queueOf(undefined)),
  );
  write(join(config, 'queues', 'mine.json'));
  check('one, passed', queueOf(undefined).id === 'mine', JSON.stringify(queueOf(undefined)));
  write(join(config, 'queues', 'all.json'));
  check(
    'two with none named, refused, as a precondition',
    typeof queueOf(undefined).problem === 'string' && queueOf(undefined).none === undefined,
  );
  check('one named, passed', queueOf('all').id === 'all');
  check('one named that is not there, refused', typeof queueOf('other').problem === 'string');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${count - failures} of ${count} controls held.`);
process.exit(failures === 0 ? 0 : 1);
