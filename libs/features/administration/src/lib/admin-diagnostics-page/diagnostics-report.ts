/**
 * The diagnostics page's report, as `GET /nuxeo/agentic-ui-apps/diagnostics.json` answers an
 * administrator (`DiagnosticsReport` in `nuxeo-agentic-core`), read defensively: what is not the
 * shape the page draws is dropped, never guessed.
 *
 * The server builds it to name no person and no secret, and cleans every message of addresses,
 * key-shaped strings, a URL's credentials and a home directory's owner; the page shows what it is
 * sent and adds nothing of the browser's.
 */

/** The report's format, which the server writes and the page refuses any other. */
export const DIAGNOSTICS_FORMAT = 'nuxeo-agentic-ui-diagnostics/1';

/** Where the report is read, below the app registry's servlet: after sign-in, administrators only. */
export const DIAGNOSTICS_PATH = '/nuxeo/agentic-ui-apps/diagnostics.json';

export interface DiagnosticsPackage {
  readonly name: string;
  readonly version: string | null;
  readonly state: string;
  /** `app`, the platform package; `kit`, one that depends on it; `add-on`, any other. */
  readonly role: 'app' | 'kit' | 'add-on';
  /** Always `not-recorded` on Nuxeo LTS 2025, whose package manager keeps no signature. */
  readonly signature: string;
}

/** The ids of the server checks, which the page names and explains. */
export const DIAGNOSTICS_CHECKS = [
  'retention',
  'template-rendering',
  'ai',
  'deployment-layer',
  'development-overrides',
  'operation-allow-list',
] as const;
export type DiagnosticsCheckId = (typeof DIAGNOSTICS_CHECKS)[number];

export interface DiagnosticsCheck {
  readonly id: DiagnosticsCheckId;
  /** `present` or `absent`; `on` or `off`; `intact` or `replaced`. */
  readonly status: string;
  /** How many operations it counted, for `ai` and `operation-allow-list`. */
  readonly operations: number | null;
  /** For `deployment-layer`: whether an administrator may approve their own change. */
  readonly selfApproval: boolean;
}

export interface DiagnosticsProvenance {
  readonly component: string | null;
  readonly bundle: string | null;
  readonly source: string | null;
  /** Whether it came with the platform itself rather than from an installed package. */
  readonly packaged: boolean;
}

export interface DiagnosticsFragment extends DiagnosticsProvenance {
  readonly name: string;
}

export interface DiagnosticsLayout extends DiagnosticsProvenance {
  readonly type: string;
  readonly mode: string;
}

export interface DiagnosticsAppLayers {
  readonly id: string;
  readonly packageVersion: string | null;
  readonly platform: string | null;
  /** The app's package: where its `app.json` came from, and its files. */
  readonly package: DiagnosticsProvenance & { readonly files: readonly string[] };
  /** The deployment layer: whether it is on, and each file whose live version is served. */
  readonly deployment: {
    readonly enabled: boolean;
    readonly files: readonly { readonly path: string; readonly version: number }[];
  };
}

export interface DiagnosticsMessage extends DiagnosticsProvenance {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly scope: string;
  /** The app it is about, or `null` for the server-wide configuration. */
  readonly app: string | null;
  readonly message: string;
}

export interface DiagnosticsReport {
  readonly generatedAt: string;
  readonly platform: { readonly product: string | null; readonly version: string | null };
  readonly app: {
    readonly package: string;
    readonly version: string | null;
    readonly core: string | null;
  };
  readonly packages: {
    readonly recorded: boolean;
    readonly problem: string | null;
    readonly entries: readonly DiagnosticsPackage[];
  };
  readonly checks: readonly DiagnosticsCheck[];
  readonly configuration: {
    readonly builtAt: string | null;
    readonly developmentOverrides: boolean;
    readonly bootstrap: readonly DiagnosticsFragment[];
    readonly manifest: readonly DiagnosticsFragment[];
    readonly layouts: readonly DiagnosticsLayout[];
  };
  readonly apps: readonly DiagnosticsAppLayers[];
  readonly diagnostics: readonly DiagnosticsMessage[];
  readonly omitted: { readonly info: number; readonly beyondLimit: number };
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

function provenance(value: Json): DiagnosticsProvenance {
  return {
    component: text(value['component']),
    bundle: text(value['bundle']),
    source: text(value['source']),
    packaged: value['packaged'] === true,
  };
}

function layer(layers: readonly unknown[], name: string): Json {
  return (layers.find((entry) => isObject(entry) && entry['layer'] === name) as Json) ?? {};
}

function packages(value: unknown): DiagnosticsReport['packages'] {
  const raw = isObject(value) ? value : {};
  const entries: DiagnosticsPackage[] = [];
  for (const entry of list(raw['entries'])) {
    if (!isObject(entry) || text(entry['name']) === null) continue;
    const role = entry['role'];
    entries.push({
      name: text(entry['name'])!,
      version: text(entry['version']),
      state: text(entry['state']) ?? '',
      role: role === 'app' || role === 'kit' ? role : 'add-on',
      signature: text(entry['signature']) ?? 'not-recorded',
    });
  }
  return { recorded: raw['recorded'] === true, problem: text(raw['problem']), entries };
}

function checks(value: unknown): DiagnosticsCheck[] {
  const known = new Set<string>(DIAGNOSTICS_CHECKS);
  const read: DiagnosticsCheck[] = [];
  for (const entry of list(value)) {
    if (!isObject(entry) || typeof entry['id'] !== 'string' || !known.has(entry['id'])) continue;
    read.push({
      id: entry['id'] as DiagnosticsCheckId,
      status: text(entry['status']) ?? '',
      operations: typeof entry['operations'] === 'number' ? count(entry['operations']) : null,
      selfApproval: entry['selfApproval'] === true,
    });
  }
  return read;
}

function app(entry: Json): DiagnosticsAppLayers | null {
  const id = text(entry['id']);
  if (id === null) return null;
  const layers = list(entry['layers']);
  const packaged = layer(layers, 'package');
  const deployment = layer(layers, 'deployment');
  return {
    id,
    packageVersion: text(entry['packageVersion']),
    platform: text(entry['platform']),
    package: {
      ...provenance(packaged),
      files: list(packaged['files']).filter((file): file is string => typeof file === 'string'),
    },
    deployment: {
      enabled: deployment['enabled'] === true,
      files: list(deployment['files'])
        .filter(isObject)
        .filter((file) => text(file['path']) !== null)
        .map((file) => ({ path: text(file['path'])!, version: count(file['version']) })),
    },
  };
}

function message(entry: unknown): DiagnosticsMessage | null {
  if (!isObject(entry)) return null;
  const level = entry['level'];
  if (level !== 'error' && level !== 'warning') return null;
  return {
    ...provenance(entry),
    level,
    code: text(entry['code']) ?? '',
    scope: text(entry['scope']) ?? '',
    app: text(entry['app']),
    message: text(entry['message']) ?? '',
  };
}

/** The report, or `null` when the answer is not one: another format, or not an object. */
export function readDiagnosticsReport(raw: unknown): DiagnosticsReport | null {
  if (!isObject(raw) || raw['format'] !== DIAGNOSTICS_FORMAT) return null;
  const platform = isObject(raw['platform']) ? raw['platform'] : {};
  const appInfo = isObject(raw['app']) ? raw['app'] : {};
  const configuration = isObject(raw['configuration']) ? raw['configuration'] : {};
  const layers = list(configuration['layers']);
  const fragments = (name: string): DiagnosticsFragment[] =>
    list(layer(layers, name)['fragments'])
      .filter(isObject)
      .map((fragment) => ({ ...provenance(fragment), name: text(fragment['name']) ?? '' }));
  const omitted = isObject(raw['diagnosticsOmitted']) ? raw['diagnosticsOmitted'] : {};
  return {
    generatedAt: text(raw['generatedAt']) ?? '',
    platform: { product: text(platform['product']), version: text(platform['version']) },
    app: {
      package: text(appInfo['package']) ?? 'nuxeo-agentic-ui',
      version: text(appInfo['version']),
      core: text(appInfo['core']),
    },
    packages: packages(raw['packages']),
    checks: checks(raw['checks']),
    configuration: {
      builtAt: text(configuration['builtAt']),
      developmentOverrides: configuration['developmentOverrides'] === true,
      bootstrap: fragments('bootstrap'),
      manifest: fragments('manifest'),
      layouts: list(layer(layers, 'layouts')['layouts'])
        .filter(isObject)
        .map((layout) => ({
          ...provenance(layout),
          type: text(layout['type']) ?? '',
          mode: text(layout['mode']) ?? '',
        })),
    },
    apps: list(raw['apps'])
      .filter(isObject)
      .map(app)
      .filter((entry): entry is DiagnosticsAppLayers => entry !== null),
    diagnostics: list(raw['diagnostics'])
      .map(message)
      .filter((entry): entry is DiagnosticsMessage => entry !== null),
    omitted: { info: count(omitted['info']), beyondLimit: count(omitted['beyondLimit']) },
  };
}

const where = (provenance: DiagnosticsProvenance): string =>
  [provenance.bundle, provenance.source].filter((part) => part !== null).join(' ');

/**
 * The "copy for support" text: the report as plain lines, one fact a line, in a fixed form a
 * support engineer reads in any language. Its field names are identifiers, not prose, so it is the
 * same whichever language the page is shown in. It holds what the report holds and nothing more.
 */
export function supportText(report: DiagnosticsReport): string {
  const lines: string[] = [];
  const add = (line: string) => lines.push(line);
  add(`${DIAGNOSTICS_FORMAT}`);
  add(`generatedAt: ${report.generatedAt}`);
  add(`platform: ${report.platform.product ?? '?'} ${report.platform.version ?? '?'}`);
  add(`app: ${report.app.package} ${report.app.version ?? '?'} core=${report.app.core ?? '?'}`);
  add(
    `packages: recorded=${report.packages.recorded}${report.packages.problem ? ` problem=${report.packages.problem}` : ''}`,
  );
  for (const entry of report.packages.entries) {
    add(
      `  ${entry.name} ${entry.version ?? '?'} role=${entry.role} state=${entry.state} signature=${entry.signature}`,
    );
  }
  add('checks:');
  for (const check of report.checks) {
    const extra = [
      check.operations !== null ? `operations=${check.operations}` : null,
      check.id === 'deployment-layer' ? `selfApproval=${check.selfApproval}` : null,
    ].filter((part) => part !== null);
    add(`  ${check.id}: ${check.status}${extra.length ? ` ${extra.join(' ')}` : ''}`);
  }
  add(
    `configuration: builtAt=${report.configuration.builtAt ?? '?'} developmentOverrides=${report.configuration.developmentOverrides}`,
  );
  for (const [name, fragments] of [
    ['bootstrap', report.configuration.bootstrap],
    ['manifest', report.configuration.manifest],
  ] as const) {
    for (const fragment of fragments) add(`  ${name}: ${fragment.name} ${where(fragment)}`);
  }
  for (const layout of report.configuration.layouts) {
    add(`  layout: ${layout.type}/${layout.mode} ${where(layout)}`);
  }
  add('apps:');
  for (const entry of report.apps) {
    add(`  ${entry.id} ${entry.packageVersion ?? '?'} platform=${entry.platform ?? '?'}`);
    add(`    package: ${where(entry.package)} files=${entry.package.files.join(',')}`);
    add(
      `    deployment: ${entry.deployment.enabled ? 'on' : 'off'}${entry.deployment.files
        .map((file) => ` ${file.path}=v${file.version}`)
        .join('')}`,
    );
  }
  add(
    `diagnostics: ${report.diagnostics.length} listed, info=${report.omitted.info} beyondLimit=${report.omitted.beyondLimit}`,
  );
  for (const entry of report.diagnostics) {
    add(`  ${entry.level} ${entry.scope} ${entry.code}: ${entry.message} [${where(entry)}]`);
  }
  return `${lines.join('\n')}\n`;
}
