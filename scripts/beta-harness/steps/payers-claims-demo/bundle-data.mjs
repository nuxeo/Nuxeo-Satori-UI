/**
 * What the Payers demo's step 5 asserts of the kit's bundle: that it holds no code, only data.
 * Kept apart from the steps file so that `payers-claims-demo.selftest.mjs` can break a bundle and
 * see it refused, with no server.
 *
 * Data is an allow-list, by place, and anything else is code:
 *
 * - JSON, XML, XSD and the manifest, anywhere in the bundle;
 * - CSV under `data/vocabularies/`: a vocabulary's rows, which a directory contribution names;
 * - the route model's zip, at the one path the kit's workflow component names
 *   (`workflow/route-model.mjs`, `ZIP_PATH`), and only when every entry it holds is itself data:
 *   a folder, the `.nuxeo-archive` marker, or an XML, JSON, properties or CSV file. A zip it
 *   cannot read, a zip anywhere else, and an entry of any other kind, a script, a class, a jar or
 *   another zip, are code.
 *
 * The route model's XML does hold MVEL, its transitions' conditions, as every route model does,
 * and the components hold their chains: that is the model's configuration, read by the server, as
 * the components' XML is. A file whose only purpose is to be run is what this refuses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

/** Anywhere in the bundle. */
const DATA = new Set(['.json', '.xml', '.xsd']);
const MANIFEST = 'META-INF/MANIFEST.MF';
/** Only below this folder of the bundle. */
const VOCABULARIES = 'data/vocabularies/';
/** What an entry of the route model's zip may be, besides a folder and the marker. */
const ZIP_DATA = new Set(['.xml', '.json', '.properties', '.csv']);
const ZIP_MARKER = '.nuxeo-archive';

/**
 * The entry names of a zip, from its central directory, as `unzip` and Java's `ZipFile` list them,
 * or `null` when the bytes are not a zip this can read whole: no end record, a directory that runs
 * past the file, an entry that does not start as one, or a ZIP64 archive.
 */
export function zipEntryNames(bytes) {
  const END = 0x06054b50;
  const ENTRY = 0x02014b50;
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--)
    if (bytes.readUInt32LE(at) === END) {
      end = at;
      break;
    }
  if (end < 0) return null;
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff || offset + size > end) return null;
  const names = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > offset + size || bytes.readUInt32LE(at) !== ENTRY) return null;
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    if (at + 46 + nameLength > offset + size) return null;
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Why the zip entry `name` is not data, or `null` when it is. */
function entryIsCode(name) {
  if (name.endsWith('/') || name === ZIP_MARKER) return null;
  return ZIP_DATA.has(extname(name).toLowerCase()) ? null : name;
}

/**
 * Every file of the bundle at `bundle` that is not data, as its path from `from`, and every entry
 * of the route model's zip that is not, as `<zip>!<entry>`. Empty when the bundle holds data only.
 * `zipPath` is the route model's zip, relative to the bundle.
 */
export function codeIn(bundle, zipPath, from = bundle) {
  const code = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const inBundle = relative(bundle, path).split(sep).join('/');
      const shown = relative(from, path);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) {
        code.push(shown);
        continue;
      }
      const extension = extname(entry.name);
      if (DATA.has(extension) || inBundle === MANIFEST) continue;
      if (extension === '.csv' && inBundle.startsWith(VOCABULARIES)) continue;
      if (extension === '.zip' && inBundle === zipPath) {
        const names = zipEntryNames(readFileSync(path));
        if (names === null) code.push(`${shown} (not a zip this reads)`);
        else
          for (const name of names.map(entryIsCode).filter(Boolean)) code.push(`${shown}!${name}`);
        continue;
      }
      code.push(shown);
    }
  };
  walk(bundle);
  return code;
}
