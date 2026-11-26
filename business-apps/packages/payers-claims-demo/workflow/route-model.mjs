/**
 * The kit's route models, the claims review workflow's and, since 0.7.0, the appeal review's, as
 * source and as the zips Nuxeo imports.
 *
 * Nuxeo 2025 imports a route model from a zip that a bundle names at the routing service's
 * `routeModelImporter` point (`<template-resource id path>`), as nuxeo-routing-default does for
 * its two models. At every start `RouteModelsInitializator` calls `importAllRouteModels`, which
 * hands each zip to `RouteModelsZipImporter` through the file manager. That importer, read from the
 * 2025.10.18 jars:
 *
 * - refuses a zip with no `.nuxeo-archive` entry (`ExportedZipImporter.isArchiveFileValid`);
 * - reads it with `NuxeoArchiveReader` over a `ZipFile`, which sorts the entry names and reads one
 *   document per folder entry, from the `document.xml` directly inside it. So the zip must hold
 *   each folder as an entry of its own, a name ending in `/`;
 * - takes the first document as the model, which must be a `DocumentRoute`, and names it by its
 *   folder: that name is the model's, a task's `workflowModelName`;
 * - leaves a model of that name alone when the zip's MD5 digest is the one it recorded for it, and
 *   otherwise removes it, keeping its ACL, and imports the zip again.
 *
 * So each zip here is written from its model's folder, `workflow/<model>/`, the reviewed source, the
 * same bytes every time: entries in code point order, stored rather than deflated so that no zlib
 * version can change them, and every timestamp 1980-01-01. A model is imported again on a server
 * only when its source changes, and each model's zip holds that model alone.
 *
 * Node 24 and nothing else.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const KIT = join(HERE, '..');
export const BUNDLE = join(KIT, 'bundle');
/**
 * The kit's route models, by name: each one's folder's, its zip's, and a task's
 * `workflowModelName`. The claims review's, and since 0.7.0 the appeal review's.
 */
export const MODELS = ['PayersClaimReview', 'PayersAppealReview'];
/** A model's source: its document export, one folder per document. */
export const sourceOf = (model) => join(HERE, model);
/** Where the bundle carries a model, as the workflow component's `template-resource` names it. */
export const zipPathOf = (model) => `data/${model}.zip`;
export const zipOf = (model) => join(BUNDLE, ...zipPathOf(model).split('/'));
/** Every model's zip, relative to the bundle: what the bundle holds as route models, and only that. */
export const ZIP_PATHS = MODELS.map(zipPathOf);

/** The claims review's, by the names its callers have read since 0.4.0. */
export const MODEL = MODELS[0];
export const SOURCE = sourceOf(MODEL);
export const ZIP_PATH = zipPathOf(MODEL);
export const ZIP = zipOf(MODEL);
/** The marker `ExportedZipImporter` requires, an empty entry at the zip's root. */
export const MARKER = '.nuxeo-archive';
/** The one file a folder of a document export holds. */
export const DOCUMENT = 'document.xml';

const byCodePoint = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * The entries of the model's zip, from `source`: the marker, then every folder, as a name ending
 * in `/`, and its `document.xml`, by code point. A folder without a `document.xml`, any other file,
 * and a symbolic link are refused, since the importer would read none of them as the reviewer did.
 */
export function archiveEntries(source = SOURCE) {
  const root = source.slice(source.lastIndexOf(sep) + 1);
  const entries = [{ name: MARKER, data: Buffer.alloc(0) }];
  const walk = (folder) => {
    const name = relative(join(source, '..'), folder).split(sep).join('/');
    entries.push({ name: `${name}/`, data: null });
    const children = readdirSync(folder).sort(byCodePoint);
    if (!children.includes(DOCUMENT))
      throw new Error(`${relative(KIT, folder)} has no ${DOCUMENT}: every folder is a document`);
    for (const child of children) {
      const path = join(folder, child);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink())
        throw new Error(`${relative(KIT, path)} is a symbolic link, which is not packaged`);
      if (entry.isDirectory()) walk(path);
      else if (child === DOCUMENT)
        entries.push({ name: `${name}/${child}`, data: readFileSync(path) });
      else throw new Error(`${relative(KIT, path)} is not a ${DOCUMENT}, and no importer reads it`);
    }
  };
  if (!lstatSync(source).isDirectory()) throw new Error(`${root} is not a folder`);
  walk(source);
  return entries.sort((a, b) => byCodePoint(a.name, b.name));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A stored zip of `entries`, a folder's `data` being `null`, every timestamp 1980-01-01. */
export function storedZip(entries) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const bytes = data ?? Buffer.alloc(0);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(10, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, bytes);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(10, 4);
    record.writeUInt16LE(10, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    // A folder carries the MS-DOS directory attribute, as zip tools write one.
    record.writeUInt32LE(data === null ? 0x10 : 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);

    offset += header.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** The model's zip, as `build-route-model.mjs` writes it, from `source`. */
export const routeModelZip = (source = SOURCE) => storedZip(archiveEntries(source));
