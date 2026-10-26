/**
 * Overrides that override nothing.
 *
 * ## Why this exists
 *
 * An `overrides` entry is an exception, exactly like an allowlist entry: it records "we force this
 * version because the one our tree asked for was vulnerable or broken". When the dependency that
 * pulled the package in goes away, the entry stays behind and keeps reading as protection. After
 * Angular 22 and Nx 23 (NXSAT-670), five security pins — `adm-zip`, `axios`, `hono`, `tar` and
 * `websocket-driver` — named packages that were no longer installed at all, and every gate was
 * green, because nothing compared `overrides` against the tree. NXSAT-672 removed them and added
 * this check so the next upgrade cannot leave the same residue unnoticed.
 *
 * Removing such an entry is free: npm does not record `overrides` in the lockfile, and an entry
 * for a package that is not in the tree constrains nothing, so the lock does not move.
 *
 * ## What counts as stale
 *
 * - A top-level entry whose package has no copy in the lock. With a version selector in the key
 *   (`"brace-expansion@^5.0.0"`), a declared dependency request must also match the selector,
 *   because a pin aimed at a major line nobody requests is just as dead as a pin on a package
 *   nobody installs. The installed version may be outside the selector when the override forces it.
 * - A nested entry (`"parent": { "child": "1.2.3" }`) whose child cannot be reached from the parent
 *   through declared dependencies. npm applies a nested override to the parent's whole subtree,
 *   not only its direct dependencies, so the walk is transitive. Peer dependencies count: the
 *   `@hylandsoftware/satori-ui` entry exists precisely to satisfy a peer. A selector on the child
 *   must match the request of some edge to it inside that subtree.
 * - When a parent is itself absent only the parent is reported; its children go with it.
 *
 * ## What this does NOT do
 *
 * - It does not flag an override whose value equals what the tree would resolve anyway. Such a
 *   pin forces nothing today but still holds a floor if a dependent's range later widens, and
 *   telling the two apart is a judgement, not a lookup.
 * - The walk is by package name, not by lock path, so a child reachable from one copy of the
 *   parent counts as reachable from every copy. That can only under-report: it never fails an
 *   entry that does reach something.
 * - Without `semver` (it is resolved from npm's own tree and never required), a version selector
 *   is ignored and only the package name is checked — again under-reporting, never over.
 */

/**
 * Split an `overrides` key into the package it addresses and the version selector it carries.
 *
 * npm lets an override key carry a range — `"brace-expansion@^5.0.0": "5.0.12"` — so that a pin
 * reaches one major line of a package without touching the others. That form is the only way to
 * patch a transitive package whose tree holds several incompatible majors: a bare
 * `"brace-expansion"` key would drag eslint's and glob's v1 copies up to v5, whose CJS build
 * dropped the default export, and break them.
 *
 * Storing the raw key recorded `"brace-expansion@^5.0.0"`, a string no package is ever called, so
 * the pin was reported as an unresolvable edge — the exact "24 deliberate security pins look like
 * corruption" failure `lockfile-integrity.mjs` describes, just one key syntax later. Discarding the
 * selector and keeping only the name fixed that and broke the other side, waiving majors npm
 * never overrode; the selector has to be kept, which is why this returns both halves.
 *
 * Scoped names carry their own leading `@`, so the separator is the LAST `@` rather than the
 * first, and a key with no separator is a bare name with no selector.
 *
 * @param {string} key
 * @returns {{ name: string, range: string | null }}
 */
export function parseOverrideKey(key) {
  const at = key.lastIndexOf('@');
  return at > 0 ? { name: key.slice(0, at), range: key.slice(at + 1) } : { name: key, range: null };
}

const EDGE_KINDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const REQUEST_KINDS = [...EDGE_KINDS, 'devDependencies'];

/**
 * Every installed copy of every package, by name.
 *
 * @param {Record<string, any>} packages  the lockfile's `packages` map
 * @returns {{ index: Map<string, { version: string | undefined, edges: { name: string, spec: string }[] }[]>, requests: Map<string, string[]> }}
 */
function indexLock(packages) {
  const index = new Map();
  const requests = new Map();
  for (const [path, entry] of Object.entries(packages ?? {})) {
    if (!entry) continue;
    for (const kind of REQUEST_KINDS) {
      for (const [name, spec] of Object.entries(entry[kind] ?? {})) {
        requests.set(name, [...(requests.get(name) ?? []), spec]);
      }
    }
    if (path === '') continue;
    const edges = EDGE_KINDS.flatMap((kind) =>
      Object.entries(entry[kind] ?? {}).map(([name, spec]) => ({ name, spec })),
    );
    const at = path.lastIndexOf('node_modules/');
    // An npm alias (`"foo": "npm:bar@1"`) sits at `node_modules/foo` with `name: "bar"`. Its
    // dependents' edges say `foo`, so it is indexed under both names; indexing only `name` would
    // break the walk at the alias and report a reachable child as stale.
    const names = new Set(
      [at >= 0 ? path.slice(at + 'node_modules/'.length) : null, entry.name].filter(Boolean),
    );
    for (const name of names) {
      index.set(name, [...(index.get(name) ?? []), { version: entry.version, edges }]);
    }
  }
  return { index, requests };
}

/**
 * The `overrides` entries that reach no installed package.
 *
 * @param {Record<string, unknown>} overrides  `package.json` `overrides`
 * @param {Record<string, any>} packages        `package-lock.json` `packages`
 * @param {{ validRange: Function, intersects: Function } | null} [semver]
 * @returns {{ stale: { key: string, reason: string }[], checked: number }}
 */
export function staleOverrides(overrides, packages, semver = null) {
  const { index, requests } = indexLock(packages);
  const stale = [];
  let checked = 0;

  const copiesOf = (name) => index.get(name) ?? [];

  const requestMatches = (spec, range) => {
    if (!range || !semver || !semver.validRange(range) || !semver.validRange(spec)) return true;
    return semver.intersects(spec, range, { includePrerelease: true });
  };

  const hasApplicableRequest = (name, range) => {
    if (!range || !semver?.validRange(range)) return copiesOf(name).length > 0;
    return (requests.get(name) ?? []).some((spec) => requestMatches(spec, range));
  };

  /**
   * Is any copy of `name` (requested within `range`) in the dependency subtree of `scope`?
   *
   * The scope's own selector is not re-checked here: a top-level scope was checked by
   * `hasApplicableRequest` and a nested one by this function, one level up, before its children
   * are visited.
   */
  const reachable = (scope, name, range) => {
    if (copiesOf(name).length === 0) return false;
    const seen = new Set();
    const queue = copiesOf(scope.name).flatMap((c) => c.edges);
    while (queue.length) {
      const edge = queue.shift();
      if (edge.name === name && requestMatches(edge.spec, range)) return true;
      if (seen.has(edge.name)) continue;
      seen.add(edge.name);
      for (const copy of copiesOf(edge.name)) queue.push(...copy.edges);
    }
    return false;
  };

  const walk = (node, path, scope) => {
    for (const [key, value] of Object.entries(node)) {
      // `"."` pins the scope package itself, whose presence was checked one level up.
      if (key === '.') continue;
      checked += 1;
      const { name, range } = parseOverrideKey(key);
      const label = [...path, key].join(' > ');
      const where = range ? `${name} within ${range}` : name;
      if (!scope && (copiesOf(name).length === 0 || !hasApplicableRequest(name, range))) {
        stale.push({
          key: label,
          reason: `no installed copy or applicable dependency request for ${where} in the lock`,
        });
        continue;
      }
      if (scope && !reachable(scope, name, range)) {
        stale.push({
          key: label,
          reason: `${where} is not applicable in the dependency subtree of ${scope.name}`,
        });
        continue;
      }
      if (value && typeof value === 'object') walk(value, [...path, key], { name, range });
    }
  };

  walk(overrides ?? {}, [], null);
  return { stale, checked };
}

/* --------------------------------------------------------------------- controls ---- */

const FIXTURE_LOCK = {
  '': {
    name: 'fixture',
    version: '0.0.0',
    dependencies: { a: '^1.0.0', d: '^5.0.0', '@s/p': '^3.0.0' },
  },
  'node_modules/a': { version: '1.0.0', dependencies: { b: '^2.0.0' } },
  'node_modules/b': { version: '2.1.0', dependencies: { c: '^1.0.0' } },
  'node_modules/c': { version: '1.4.0' },
  'node_modules/d': { version: '5.0.1' },
  'node_modules/x': { version: '1.0.0', dependencies: { d: '^1.0.0' } },
  'node_modules/x/node_modules/d': { version: '1.2.0' },
  'node_modules/@s/p': { version: '3.0.0', peerDependencies: { c: '*' } },
  'node_modules/y': { version: '1.0.0', dependencies: { al: 'npm:real@^1.0.0' } },
  'node_modules/al': { name: 'real', version: '1.0.0', dependencies: { c: '^1.0.0' } },
};

const FORCED_OUTSIDE_SELECTOR_LOCK = {
  '': { name: 'fixture', version: '0.0.0', dependencies: { d: '^1.0.0', x: '^1.0.0' } },
  'node_modules/d': { version: '2.0.0' },
  'node_modules/x': { version: '1.0.0', dependencies: { d: '^1.0.0' } },
  'node_modules/x/node_modules/d': { version: '2.0.0' },
};

/**
 * `[name, overrides, stale keys expected, needs semver, lock]`. A control that needs `semver` expects
 * nothing to be found without it, because the selector is then ignored by design.
 *
 * @type {[string, Record<string, unknown>, string[], boolean?, Record<string, any>?][]}
 */
const CONTROLS = [
  ['installed package', { c: '1.4.1' }, []],
  ['installed scoped package', { '@s/p': '3.0.1' }, []],
  ['scoped package with a matching selector', { '@s/p@^3.0.0': '3.0.1' }, []],
  ['selector matching the hoisted copy', { 'd@^5.0.0': '5.0.2' }, []],
  ['selector matching only a nested copy', { 'd@^1.0.0': '1.2.1' }, []],
  [
    'selector request with a forced version outside it',
    { 'd@^1.0.0': '2.0.0' },
    [],
    true,
    FORCED_OUTSIDE_SELECTOR_LOCK,
  ],
  [
    'nested selector request with a forced version outside it',
    { x: { 'd@^1.0.0': '2.0.0' } },
    [],
    true,
    FORCED_OUTSIDE_SELECTOR_LOCK,
  ],
  ['nested, direct child', { a: { b: '2.1.1' } }, []],
  ['nested, transitive child', { a: { c: '1.4.1' } }, []],
  ['nested, reached through a peer', { '@s/p': { c: '1.4.1' } }, []],
  ['nested, "." pinning the parent itself', { a: { '.': '1.0.1' } }, []],
  ['npm alias, by its real name', { real: '1.0.1' }, []],
  ['nested, reached through an npm alias', { y: { c: '1.4.1' } }, []],
  ['absent package', { zzz: '1.0.0' }, ['zzz']],
  ['absent scoped package', { '@s/q': '1.0.0' }, ['@s/q']],
  ['selector has no matching dependency request', { 'd@^9.0.0': '9.0.1' }, ['d@^9.0.0'], true],
  [
    'nested selector no request in the subtree matches',
    { x: { 'd@^9.0.0': '9.0.1' } },
    ['x > d@^9.0.0'],
    true,
  ],
  ['nested child outside a leaf parent', { c: { a: '1.0.1' } }, ['c > a']],
  ['nested child outside a parent that has a subtree', { b: { a: '1.0.1' } }, ['b > a']],
  ['absent parent reports the parent only', { zzz: { c: '1.4.1' } }, ['zzz']],
  ['only the stale entry of a mixed set', { c: '1.4.1', zzz: '1.0.0' }, ['zzz']],
];

/**
 * Run the controls. An empty array means every control behaved as specified.
 *
 * @param {{ validRange: Function, intersects: Function } | null} [semver]
 * @returns {string[]}
 */
export function selfCheck(semver = null) {
  const failures = [];
  for (const [name, overrides, expected, needsSemver, lock = FIXTURE_LOCK] of CONTROLS) {
    const want = needsSemver && !semver ? [] : expected;
    const got = staleOverrides(overrides, lock, semver).stale.map((s) => s.key);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`${name}: found [${got.join(', ')}], expected [${want.join(', ')}]`);
    }
  }
  return failures;
}

export const CONTROL_COUNT = {
  negative: CONTROLS.filter((c) => c[2].length === 0).length,
  positive: CONTROLS.filter((c) => c[2].length > 0).length,
};
