/**
 * The configuration's own checks, at the package pipeline's step 2 (`pipeline.mjs`): what a
 * configuration package can say that the server takes and the application then ignores, which the
 * builder, `build.mjs`, cannot see because it checks what the server checks.
 *
 * - **A key the application does not read**, in a Layer 0 (`bootstrap`) or Layer 1 (`manifest`)
 *   fragment: refused, by its file and its place. The application ignores an unknown key without a
 *   word, so `brandings` or `featureToggle` reads as a customisation that did not work. Held to the
 *   platform's own schemas, the ones the `config-package` generator writes into every package for
 *   the editor (`tools/satori-generators/src/config-package/files/schema/`), which
 *   `config-package-schema.spec.ts` holds to the keys the application reads: an object whose schema
 *   says `"additionalProperties": false` takes only the keys it lists, down through `$ref`,
 *   `oneOf`, `anyOf`, `items` and a preset's `bootstrap` and `manifest`. Only keys are checked here,
 *   not values: a value of the wrong type is the application's to read, as before.
 *   Nuxeo-Satori-Config makes this check of its packages' top-level keys in `check-deployable.mjs`;
 *   this one goes down.
 * - **A name Satori itself uses:** a fragment named `defaults`, which Satori's own fragments are
 *   named in both layers, so that one of that name replaces them on the server; and a package named
 *   `defaults` or `nuxeo-agentic-ui`, Satori's own package (`reservedName`, which step 3 asks). The
 *   `config-package` generator refuses the same names (`SATORI_NAMES`, in `generator.ts` and
 *   `create.mjs`), which the tool's controls hold this list to.
 * - **A file of version 2's with no `app.json`** (`versionTwoFiles`): one nothing would check or
 *   serve, for the tool, which builds a package with no app definition as configuration alone.
 *
 * A fragment's body is read as the builder reads it: the file its `src` names inside `bundle/`, or
 * its inline `<json>`. One the builder will refuse, a file that is not there or JSON that does not
 * parse, is passed over here, for step 4 to refuse with its own reason.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { attributesOf, TAG } from '../verify-package-zip.mjs';

/** A byte-order mark, which JSON.parse refuses and the builder's decoder drops. */
const BOM = /^\uFEFF/;

/**
 * The names Satori itself uses, and why each is refused: the `config-package` generator's
 * `SATORI_NAMES`, word for word.
 */
export const SATORI_NAMES = new Map([
  [
    'defaults',
    'the name of Satori\u2019s own packaged fragments in both layers, so a package of this name replaces them on the server',
  ],
  [
    'nuxeo-agentic-ui',
    'Satori\u2019s own Marketplace package, which every configuration package depends on',
  ],
]);

/** Why `name` is a name Satori itself uses, or `null` when it is not one. */
export function reservedName(name) {
  return SATORI_NAMES.get(name) ?? null;
}

/** The two layers a fragment may be in, each held to the schema of its name. */
const LAYERS = ['bootstrap', 'manifest'];

/**
 * The fragments' findings, in the validator's form, `<file>: <place>: <why> [<kind>]`.
 *
 * @param directory the package
 * @param components `componentsOf(directory)`: each component the manifest names, readable inside
 *   `bundle/`, `{ component, xml, kept }`, its markup blanked and kept as `pipeline.mjs` reads it
 * @param schemas `{ bootstrap, manifest }`, the files of the two layers' JSON Schemas
 */
export function configurationFindings(directory, components, schemas) {
  const findings = [];
  const say = (file, place, message, kind) =>
    findings.push(`${file}: ${place}: ${message} [${kind}]`);
  const bundle = resolve(directory, 'bundle');
  const root = {};
  for (const layer of LAYERS) root[layer] = JSON.parse(readFileSync(schemas[layer], 'utf8'));
  for (const { component, xml, kept } of components) {
    const componentFile = join(bundle, ...component.split('/'));
    for (const [from, to] of configurationExtensions(xml)) {
      const extension = xml.slice(from, to);
      const extensionKept = kept.slice(from, to);
      for (const match of extension.matchAll(new RegExp(`<fragment${TAG}`, 'g'))) {
        const { name, layer, src, enabled } = attributesOf(match[1]);
        const taken = name === undefined ? null : reservedName(name.trim());
        if (taken !== null)
          say(
            componentFile,
            `fragment "${name}"`,
            `"${name.trim()}" is a name Satori itself uses: ${taken}. Name the fragment after the package`,
            'clash',
          );
        // A disabled entry has no body, and a layer the server does not have is the builder's.
        if (enabled !== undefined && enabled.toLowerCase() !== 'true') continue;
        if (!LAYERS.includes(layer)) continue;
        const value =
          src !== undefined
            ? bodyOf(bundle, src)
            : inlineBody(
                extension.slice(match.index),
                extensionKept.slice(match.index),
                match[0].length,
              );
        if (value === null) continue;
        const where = src !== undefined ? join(bundle, ...src.split('/')) : componentFile;
        const what =
          src !== undefined
            ? `a ${layer} fragment`
            : `the inline ${layer} fragment "${name ?? ''}"`;
        unknownKeys(value, { $ref: `${layer}.schema.json` }, root, null, (place, key, known) =>
          say(
            where,
            place === '' ? key : `${place}.${key}`,
            `"${key}" is not a key ${what} has there, so the application would ignore it in silence${near(key, known)}`,
            'unknown',
          ),
        );
      }
    }
  }
  return findings;
}

/**
 * The files under `root` that only an app definition reads, as paths from `root`: the registry's
 * files, a domain module's, and a layout of version 2, by its `"version"`. A package with any of
 * them and no `app.json` has an app definition nothing checks.
 */
export function versionTwoFiles(root) {
  if (!isDirectory(root)) return [];
  const found = [];
  for (const path of filesUnder(root).sort()) {
    if (APP_FILES.some((place) => place.test(path)) || path.startsWith('modules/')) {
      found.push(path);
      continue;
    }
    if (!path.startsWith('layouts/') || !path.endsWith('.json')) continue;
    try {
      const content = JSON.parse(
        readFileSync(join(root, ...path.split('/')), 'utf8').replace(BOM, ''),
      );
      if (isRecord(content) && content.version === 2) found.push(path);
    } catch {
      // Not JSON: the builder refuses it at step 4.
    }
  }
  return found;
}

/** The files of an app definition the registry serves besides `app.json`: version 1 has none. */
const APP_FILES = [
  /^home\.json$/,
  /^navigation\.json$/,
  /^actions\.json$/,
  /^queues\/[^/]+\.json$/,
  /^labels\/[^/]+\.json$/,
  /^tasks\/[^/]+\.layout\.json$/,
];

/**
 * Each key of `value` the schema `node` does not take, said as `(place, key, known)`, with the keys
 * it does take there, down through every key it takes. `root` holds both layers' schemas, by layer,
 * for a `$ref` to a file; `schema` is the file `node` is in, for a `$ref` within it.
 */
function unknownKeys(value, node, root, schema, say, place = '') {
  const alternatives = resolved(node, root, schema);
  if (Array.isArray(value)) {
    for (const { node: each, schema: file } of alternatives)
      if (isRecord(each.items))
        value.forEach((item, index) =>
          unknownKeys(item, each.items, root, file, say, `${place}[${index}]`),
        );
    return;
  }
  if (!isRecord(value)) return;
  const objects = alternatives.filter(({ node: each }) => objectSchema(each));
  if (objects.length === 0) return;
  const known = [
    ...new Set(
      objects.flatMap(({ node: each }) =>
        isRecord(each.properties) ? Object.keys(each.properties) : [],
      ),
    ),
  ];
  for (const [key, inner] of Object.entries(value)) {
    // The first alternative that takes the key reads it: a key none takes is unknown.
    const taking = objects.find(({ node: each }) => takes(each, key));
    if (taking === undefined) {
      say(place, key, known);
      continue;
    }
    const next =
      isRecord(taking.node.properties) && Object.hasOwn(taking.node.properties, key)
        ? taking.node.properties[key]
        : taking.node.additionalProperties;
    if (isRecord(next))
      unknownKeys(inner, next, root, taking.schema, say, place === '' ? key : `${place}.${key}`);
  }
}

/**
 * `node` with its `$ref` followed, as the alternatives it allows (`oneOf`, `anyOf`, `allOf`), each
 * with the schema file it is in. A reference is `#/definitions/<name>`, in the same file, or
 * `bootstrap.schema.json` or `manifest.schema.json`, a layer's: the only forms the schemas use. One
 * of another form, or that loops, takes nothing away: it is read as no schema.
 */
function resolved(node, root, schema, seen = new Set()) {
  if (!isRecord(node)) return [];
  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return [];
    const [file, pointer = ''] = node.$ref.split('#');
    const layer = LAYERS.find((each) => file === `${each}.schema.json`);
    const target = file === '' ? schema : layer === undefined ? null : root[layer];
    if (!isRecord(target)) return [];
    let at = target;
    for (const part of pointer.split('/').filter((each) => each !== ''))
      at = isRecord(at) ? at[part] : undefined;
    return resolved(at, root, target, new Set([...seen, node.$ref]));
  }
  const branches = ['oneOf', 'anyOf', 'allOf'].flatMap((key) =>
    Array.isArray(node[key]) ? node[key] : [],
  );
  if (branches.length === 0) return [{ node, schema }];
  return branches.flatMap((branch) => resolved(branch, root, schema, seen));
}

/** Whether a schema describes an object, whose keys it may list. */
function objectSchema(node) {
  return (
    node.type === 'object' || isRecord(node.properties) || node.additionalProperties !== undefined
  );
}

/** Whether an object's schema takes `key`: it lists it, or it takes keys it does not list. */
function takes(node, key) {
  if (isRecord(node.properties) && Object.hasOwn(node.properties, key)) return true;
  return node.additionalProperties !== false;
}

/** `; perhaps "<known>"` when a key the schema lists is one edit, or a letter case, from `key`. */
function near(key, known) {
  const close = known.find(
    (each) => each.toLowerCase() === key.toLowerCase() || distance(each, key) <= 1,
  );
  return close === undefined ? '' : `; perhaps "${close}"`;
}

/** The edit distance of two short texts. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** `org.nuxeo.agentic.ui.config`'s "configuration" extensions of a component, each `[start, end]`. */
function configurationExtensions(xml) {
  return [
    ...xml.matchAll(new RegExp(`<extension${TAG}([\\s\\S]*?)</extension[ \\t\\r\\n]*>`, 'g')),
  ].flatMap((extension) => {
    const { target, point } = attributesOf(extension[1]);
    return target === 'org.nuxeo.agentic.ui.config' && point === 'configuration'
      ? [[extension.index, extension.index + extension[0].length]]
      : [];
  });
}

/**
 * The fragment body `src` names inside `bundle`, parsed, or `null` when it is not a file of the
 * bundle, or not a JSON object: the builder's to refuse.
 */
function bodyOf(bundle, src) {
  const file = resolve(bundle, src);
  if (!file.startsWith(bundle + sep)) return null;
  let entry;
  try {
    entry = lstatSync(file, { throwIfNoEntry: false });
  } catch {
    return null;
  }
  if (!entry?.isFile()) return null;
  return parsed(readFileSync(file, 'utf8'));
}

/**
 * The inline `<json>` of the fragment whose start tag, `tagLength` long, begins `blanked`, parsed,
 * or `null`. Markup is found in `blanked`, CDATA blanked, and the text read from `kept`.
 */
function inlineBody(blanked, kept, tagLength) {
  if (blanked.slice(0, tagLength).trimEnd().endsWith('/>')) return null;
  const close = blanked.indexOf('</fragment', tagLength);
  const inside = blanked.slice(tagLength, close === -1 ? blanked.length : close);
  const open = new RegExp(`<json${TAG}`).exec(inside);
  if (open === null) return null;
  const start = tagLength + open.index + open[0].length;
  const end = blanked.indexOf('</json', start);
  if (end === -1) return null;
  return parsed(xmlText(kept.slice(start, end)));
}

/** JSON text as the builder reads it, a byte-order mark dropped, or `null` when not an object. */
function parsed(text) {
  try {
    const value = JSON.parse(text.replace(BOM, ''));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * An element's text as the server reads it: a CDATA section's as written, the rest with its
 * entities and character references decoded.
 */
function xmlText(text) {
  return text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? part.slice('<![CDATA['.length, -']]>'.length)
        : part.replace(
            /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g,
            (reference, hex, decimal, named) => {
              if (named) return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[named];
              const codePoint = hex ? parseInt(hex, 16) : Number(decimal);
              return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : reference;
            },
          ),
    )
    .join('');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDirectory(path) {
  return existsSync(path) && lstatSync(path).isDirectory();
}

/** Every file under `directory`, as a path relative to it with `/` between its parts. */
function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}
