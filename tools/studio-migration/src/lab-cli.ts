/**
 * `lab`: lab mode, the harness against a real server (README, **Lab mode**).
 *
 *   lab <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>]
 *       [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
 *
 * Each document, by its id or its path, is opened in Web UI and in the new app in Chromium, as the
 * user `NUXEO_USER` and `NUXEO_PASS` name, and the requests each sends are held to the
 * request-log rule (`lab.ts`), in the harness's report format, document by document. Given a
 * Studio package and its conversion, it also runs check 3's server half on the server's model,
 * and says whether checks 5, 6 and 7 can run their server halves there: they need the package
 * installed on the server, for Web UI, and its conversion served to the new app.
 *
 * It writes only into a new or empty `--out`: `lab.txt`, what it prints; `lab.json`, the same as
 * data, with what each app sent; and a screenshot of each app on each document. It writes nothing
 * to the server: every request either app sends goes through `lab-browser.ts`'s refusal first.
 *
 * Exit codes: 0, every document compared and none differs; 1, a difference, a failed check, a
 * document not compared, or something could not be read or written; 2, the command was wrong, or
 * the environment is: the credentials, Playwright, a server that does not answer as the user, or a
 * document whose requests did not all run as the user. With `--control`, 0 once the rule reported
 * the control's finding on a document, and 1 when it reported it on none.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCatalogue } from './catalogue';
import { checkModelParts } from './check-model';
import { readPackage, type CliIo } from './cli';
import { ConversionError, readConversion } from './convert';
import { checkResultLines, runCheck, type CheckResult, type HarnessInput } from './harness';
import { inventory } from './inventory';
import {
  compareDocument,
  type AppRecording,
  type DocumentComparison,
  type LabDocument,
} from './lab';
import {
  LAB_CONTROLS,
  labControl,
  launchChromium,
  recordApp,
  type LabControl,
  type LabCredentials,
  type LabTarget,
  type PwBrowser,
} from './lab-browser';
import {
  LabServerError,
  confirmPlatform,
  resolveDocument,
  servedConversion,
  servedPackage,
  serverReads,
  whoAmI,
  type ServerReads,
  type Served,
} from './lab-server';
import { StudioPackageError } from './studio-package';
import { ZipError } from './zip';

export const LAB_USAGE = `usage:
  studio-migration lab <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>]
      [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
  a document is its id, or its path, which starts with /; the controls:
${LAB_CONTROLS.map((control) => `    ${control.name}: ${control.description}`).join('\n')}
`;

export const LAB_FORMAT = 'studio-migration-lab/1';

/** Where lab mode looks when it is not told: the local server and the new app's dev server. */
export const LAB_DEFAULTS = {
  nuxeo: 'http://localhost:8080',
  app: 'http://localhost:4200/',
} as const;

/** What lab mode reaches outside itself, so that a test can stand in for each. */
export interface LabDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly launch: () => Promise<PwBrowser | string>;
  readonly record: typeof recordApp;
  readonly reads: (origin: string, authorization: string | null) => ServerReads;
}

export const LAB_DEPS: LabDeps = {
  env: process.env,
  launch: launchChromium,
  record: recordApp,
  reads: (origin, authorization) => serverReads(origin, authorization),
};

const VALUED = ['--out', '--app', '--web-ui', '--nuxeo', '--package', '--conversion', '--control'];

export async function lab(
  argv: readonly string[],
  io: CliIo,
  deps: LabDeps = LAB_DEPS,
): Promise<number> {
  const values = new Map<string, string>();
  const references: string[] = [];
  let wrong = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (VALUED.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--') || values.has(arg)) wrong = true;
      else values.set(arg, value);
    } else if (arg.startsWith('--')) wrong = true;
    else references.push(arg);
  }
  const out = values.get('--out');
  const packageFile = values.get('--package');
  const conversionDirectory = values.get('--conversion');
  if (
    wrong ||
    out === undefined ||
    references.length === 0 ||
    (packageFile === undefined) !== (conversionDirectory === undefined)
  ) {
    io.err(LAB_USAGE);
    return 2;
  }
  let control: LabControl | undefined;
  if (values.has('--control')) {
    const read = labControl(values.get('--control') ?? '');
    if (typeof read === 'string') {
      io.err(`${read}\n`);
      return 2;
    }
    control = read;
  }
  let target: LabTarget;
  try {
    const nuxeo = new URL(values.get('--nuxeo') ?? LAB_DEFAULTS.nuxeo).origin;
    target = {
      nuxeo,
      webUi: new URL(values.get('--web-ui') ?? `${nuxeo}/nuxeo/ui/`).href,
      app: new URL(values.get('--app') ?? LAB_DEFAULTS.app).href,
    };
  } catch (error) {
    io.err(`${(error as Error).message}\n${LAB_USAGE}`);
    return 2;
  }
  const directory = resolve(out);
  if (
    existsSync(directory) &&
    (!statSync(directory).isDirectory() || readdirSync(directory).length > 0)
  ) {
    io.err(`${directory} is not a new or empty directory: lab mode writes over nothing\n`);
    return 1;
  }

  // No default, as everywhere in this repository (scripts/beta-harness/nuxeo-credentials.mjs).
  const username = deps.env['NUXEO_USER'];
  const password = deps.env['NUXEO_PASS'];
  if (!username || !password) {
    io.err(
      'NUXEO_USER and NUXEO_PASS must both be set to open the documents as a user; there is deliberately no default.\n' +
        '  A local Nuxeo in Docker uses its documented default administrator account.\n',
    );
    return 2;
  }
  const credentials: LabCredentials = { username, password };
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const nuxeo = deps.reads(target.nuxeo, authorization);

  try {
    const who = await whoAmI(nuxeo, username);
    if (who !== null) {
      io.err(`Nothing was opened: ${who}. Check NUXEO_USER and NUXEO_PASS, and --nuxeo.\n`);
      return 2;
    }
    const documents: LabDocument[] = [];
    for (const reference of references) {
      const document = await resolveDocument(nuxeo, reference);
      if (typeof document === 'string') {
        io.err(`${document}\n`);
        return 1;
      }
      documents.push(document);
    }
    const server = await serverName(nuxeo);

    // The server halves of the harness, for a package and its conversion.
    let halves: { readonly title: string; readonly checks: readonly CheckResult[] } | undefined;
    let harnessInput: HarnessInput | undefined;
    let served: { readonly pkg: Served; readonly conversion: Served } | undefined;
    if (packageFile !== undefined && conversionDirectory !== undefined) {
      const pkg = readPackage(io, packageFile);
      harnessInput = {
        pkg,
        inventory: inventory(pkg),
        catalogue: loadCatalogue(),
        conversion: readConversion(conversionDirectory),
      };
      served = {
        pkg: await servedPackage(nuxeo, target.webUi, pkg),
        conversion: await servedConversion(
          deps.reads(target.app, null),
          target.app,
          harnessInput.conversion,
        ),
      };
    }

    const browser = await deps.launch();
    if (typeof browser === 'string') {
      io.err(`${browser}\n`);
      return 2;
    }
    mkdirSync(directory, { recursive: true });
    const compared: { comparison: DocumentComparison; web: AppRecording; app: AppRecording }[] = [];
    try {
      for (const [index, document] of documents.entries()) {
        const number = index + 1;
        const web = await deps.record(browser, 'web-ui', target, credentials, document, {
          screenshot: { out: directory, file: `${number}-web-ui.png` },
        });
        const app = await deps.record(browser, 'new-app', target, credentials, document, {
          screenshot: { out: directory, file: `${number}-new-app.png` },
          ...(control ? { control } : {}),
        });
        compared.push({ comparison: compareDocument(document, web, app), web, app });
      }
    } finally {
      await browser.close();
    }

    if (harnessInput && served) {
      halves = {
        title: `The server halves, for ${harnessInput.pkg.descriptor.name} ${harnessInput.pkg.descriptor.version} and the conversion in ${conversionDirectory}`,
        checks: await serverHalves(
          nuxeo,
          harnessInput,
          served,
          compared.map((entry) => entry.comparison),
        ),
      };
    }

    const text = labText({
      target,
      server,
      username,
      control,
      compared: compared.map((entry) => entry.comparison),
      halves,
    });
    writeFileSync(join(directory, 'lab.txt'), text, { flag: 'wx' });
    writeFileSync(
      join(directory, 'lab.json'),
      `${JSON.stringify(
        {
          format: LAB_FORMAT,
          target,
          server,
          user: username,
          ...(control ? { control } : {}),
          documents: compared.map(({ comparison, web, app }) => ({
            document: comparison.document,
            checks: comparison.checks,
            listing: comparison.listing,
            recordings: { 'web-ui': web, 'new-app': app },
          })),
          ...(halves ? { serverHalves: halves.checks } : {}),
          ...(served ? { served } : {}),
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    );
    io.out(text);
    const shots = compared.flatMap((entry) => [entry.web.screenshot, entry.app.screenshot]);
    io.out(
      `Written to ${directory}: lab.txt, lab.json and ${shots.filter(Boolean).length} of ${shots.length} screenshots.\n`,
    );

    if (compared.some((entry) => entry.comparison.identityFailed)) return 2;
    // A control run is the control's: 0 once the rule reported it, 1 when it did not.
    if (control)
      return compared.some((entry) => controlReported(control, entry.comparison)) ? 0 : 1;
    const failed = [
      ...compared.flatMap((entry) => entry.comparison.checks),
      ...(halves?.checks ?? []),
    ].some((check) => check.status === 'fail');
    // A document that could not be compared is never a pass: what it would have found is unknown.
    return failed || compared.some((entry) => notCompared(entry.comparison)) ? 1 : 0;
  } catch (error) {
    if (
      error instanceof LabServerError ||
      error instanceof ZipError ||
      error instanceof StudioPackageError ||
      error instanceof ConversionError
    ) {
      io.err(`${error.message}\n`);
      return error instanceof LabServerError ? 2 : 1;
    }
    throw error;
  }
}

/** The server's distribution, as `/capabilities` names it, for the report's header. */
async function serverName(nuxeo: ServerReads): Promise<string> {
  const answer = await nuxeo.get('/nuxeo/api/v1/capabilities');
  try {
    const server = (
      JSON.parse(answer.body.toString('utf8')) as { server?: Record<string, unknown> }
    ).server;
    if (server && typeof server['distributionVersion'] === 'string')
      return `${String(server['distributionName'] ?? 'nuxeo')} ${server['distributionVersion']}`;
  } catch {
    // Said below.
  }
  return `a server that does not name its version (/capabilities answered ${answer.status})`;
}

/**
 * Checks 3, 5, 6 and 7 as lab mode can run them on this server. 3 runs whole: the package's own
 * model as `check` holds it, and what rests on the platform confirmed on the server. 5 does not
 * run here. 6 and 7 stand on the documents' comparisons only when Web UI serves the package and the
 * new app its conversion.
 */
export async function serverHalves(
  nuxeo: ServerReads,
  input: HarnessInput,
  served: { readonly pkg: Served; readonly conversion: Served },
  documents: readonly DocumentComparison[],
): Promise<CheckResult[]> {
  const parts = checkModelParts(input);
  const confirmed =
    parts.platform.length > 0 ? await confirmPlatform(nuxeo, parts.platform, parts.model) : [];
  const model: string[] = [...parts.findings, ...confirmed];
  const installed = served.pkg.total > 0 && served.pkg.same === served.pkg.total;
  const conversionServed =
    served.conversion.total > 0 && served.conversion.same === served.conversion.total;
  const where = [
    installed
      ? null
      : `the Studio package installed on this server, for Web UI to run it (Web UI serves ${served.pkg.same} of its ${served.pkg.total} files as the package holds them${served.pkg.examples.length ? `: ${served.pkg.examples[0]}` : ''})`,
    conversionServed
      ? null
      : `its conversion served to the new app (${served.conversion.same} of its ${served.conversion.total} layout files are served as the conversion holds them${served.conversion.examples.length ? `: ${served.conversion.examples[0]}` : ''})`,
  ].filter((part): part is string => part !== null);
  const conditions = runCheck(input, 5);
  const five: CheckResult =
    conditions && conditions.status !== 'partial'
      ? conditions
      : {
          number: 5,
          name: 'Conditions',
          status: 'not run',
          findings: [],
          reason: `Evaluating each condition in Web UI needs ${where.length ? `${where.join(' and ')}, and ` : ''}test users in and out of each group, which lab mode never creates: it writes nothing`,
        };
  const fromDocuments = (number: 6 | 7, name: string, rest: string): CheckResult => {
    if (where.length > 0)
      return {
        number,
        name,
        status: 'not run',
        findings: [],
        reason: `It needs ${where.join(' and ')}`,
      };
    const own = documents.map((comparison) =>
      comparison.checks.filter((check) => check.number === number),
    );
    const findings = own.flatMap((checks, index) =>
      checks.flatMap((check) =>
        check.findings.map((finding) => `document ${index + 1}: ${finding}`),
      ),
    );
    const notRun = own.some((checks) => checks.some((check) => check.status === 'not run'));
    return {
      number,
      name,
      status: findings.length > 0 ? 'fail' : notRun ? 'not run' : 'partial',
      findings,
      reason: notRun ? 'Not every document could be compared: each says why' : rest,
    };
  };
  return [
    {
      number: 3,
      name: 'Model',
      status: model.length > 0 ? 'fail' : 'pass',
      findings: model,
    },
    five,
    fromDocuments(
      6,
      'What people see',
      `On ${given(documents.length)}: the values are not compared yet`,
    ),
    fromDocuments(
      7,
      'What the server is asked',
      `On ${given(documents.length)}, their pages only: the lists and buttons are not recorded yet`,
    ),
  ];
}

/** A document whose request logs could not be held to the rule: as another user, or unread. */
function notCompared(comparison: DocumentComparison): boolean {
  return comparison.checks.some((check) => check.number === 7 && check.status === 'not run');
}

function given(count: number): string {
  return count === 1 ? 'the document given' : `the ${count} documents given`;
}

/** What lab mode prints, and writes to `lab.txt`. */
export function labText(run: {
  readonly target: LabTarget;
  readonly server: string;
  readonly username: string;
  readonly control?: LabControl;
  readonly compared: readonly DocumentComparison[];
  readonly halves?: { readonly title: string; readonly checks: readonly CheckResult[] };
}): string {
  const lines = [
    `Lab mode: Web UI at ${run.target.webUi} and the new app at ${run.target.app}, on ${run.target.nuxeo} (${run.server}), as ${run.username}`,
  ];
  if (run.control)
    lines.push(
      `Control: ${run.control.kind}=${run.control.kind === 'withhold-property' ? run.control.xpath : run.control.schemas}, put into the new app's side; the rule must report it`,
    );
  for (const [index, comparison] of run.compared.entries()) {
    const { document } = comparison;
    lines.push(
      '',
      `Document ${index + 1} of ${run.compared.length}: ${document.type} "${document.title}", ${document.path} (${document.uid})`,
      ...checkResultLines(comparison.checks),
      ...comparison.listing.map((line) => `  ${line}`),
    );
  }
  if (run.halves) lines.push('', `${run.halves.title}:`, ...checkResultLines(run.halves.checks));
  const differing = run.compared.filter((comparison) =>
    comparison.checks.some((check) => check.status === 'fail'),
  ).length;
  const uncompared = run.compared.filter(notCompared).length;
  lines.push(
    '',
    `Lab verdict: ${differing} of ${run.compared.length} ${run.compared.length === 1 ? 'document' : 'documents'} with a difference under the request-log rule${
      uncompared ? `; ${uncompared} not compared, each saying why` : ''
    }`,
  );
  const { control } = run;
  if (control) {
    const reported = run.compared.filter((comparison) =>
      controlReported(control, comparison),
    ).length;
    lines.push(
      reported > 0
        ? `The control was reported, by the finding it causes, on ${reported} of ${run.compared.length}.`
        : 'The control was reported on none: either it found nothing to break there, or the rule missed it.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Whether the rule reported the finding a control causes, rather than any finding: a document can
 * differ for another reason, which says nothing of the control.
 */
export function controlReported(control: LabControl, comparison: DocumentComparison): boolean {
  const findings = comparison.checks.find((check) => check.number === 7)?.findings ?? [];
  return control.kind === 'withhold-property'
    ? findings.some(
        (finding) =>
          finding.startsWith(`Web UI shows ${control.xpath} (`) &&
          finding.endsWith('the new app does not fetch it'),
      )
    : findings.some((finding) => {
        // The finding names what the new app asked instead, or a schema it left out of it.
        const asked = control.schemas.split(',').sort().join(', ');
        const missing =
          /^Web UI asks for the document with the schema (\S+), the new app does not$/.exec(
            finding,
          )?.[1];
        return (
          finding ===
            `Web UI asks for the document with every schema (*), the new app only with ${asked}` ||
          (missing !== undefined && !control.schemas.split(',').includes(missing))
        );
      });
}
