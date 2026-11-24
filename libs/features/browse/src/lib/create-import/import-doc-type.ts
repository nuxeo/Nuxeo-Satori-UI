import { resolveImportBlobDocType } from '@nuxeo/satori-platform/nuxeo-client';

import { type MainBlobContentModel, typeHoldsMainBlob } from './main-blob-type';

/** No content model yet, or none the server would give: the stock type names decide alone. */
export const NO_CONTENT_MODEL: MainBlobContentModel = { doctypes: {}, facets: [] };

/**
 * The types a file can be imported as into a folder: those of `allowedTypes`, the folder's allowed
 * subtypes, that keep a main file (`typeHoldsMainBlob`). Empty for a Section, or a folder that
 * takes only Workspace and Folder.
 */
export function importBlobTypesAllowed(
  allowedTypes: readonly string[],
  model: MainBlobContentModel,
): string[] {
  return allowedTypes.filter((type) => typeHoldsMainBlob(type, model));
}

/**
 * The type a file starts as when it is imported into a folder whose import types are
 * `importTypes` (`importBlobTypesAllowed`). `resolveImportBlobDocType` infers one of the stock
 * types from the MIME type and falls back to `File`, which is right whenever the folder allows a
 * stock type. Where it allows only a type that extends one — a folder that takes `RentalContract`
 * and not `File` — that fallback names a type the folder does not allow, so the first allowed
 * type is used instead.
 *
 * With no import type this answers `File`, which the folder does not allow, and Nuxeo does not
 * apply the folder's allowed subtypes to a REST create: measured on the local server, a `File`
 * posted into a Section, or into a Workspace that does not list it, is created. So no caller
 * reaches here with none: Create / Import stops on `importTypesUnavailable`, and a drop on the
 * browse list is refused before anything is queued.
 */
export function importDocTypeFor(file: File, importTypes: readonly string[]): string {
  const resolved = resolveImportBlobDocType(file, importTypes);
  return importTypes.length === 0 || importTypes.includes(resolved) ? resolved : importTypes[0];
}
