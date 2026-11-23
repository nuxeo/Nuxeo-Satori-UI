import {
  isBlobHoldingDocType,
  type NuxeoDoctypeDefinition,
  type NuxeoFacetDefinition,
} from '@nuxeo/satori-platform/nuxeo-client';

/** The schema whose `file:content` is a document's main file. */
const FILE_SCHEMA = 'file';

/** The facet that makes a type a container. */
const FOLDERISH_FACET = 'Folderish';

/** The two parts of Nuxeo's content model the walk reads: `/config/types` and `/config/facets`. */
export interface MainBlobContentModel {
  readonly doctypes: Readonly<Record<string, NuxeoDoctypeDefinition>>;
  readonly facets: readonly NuxeoFacetDefinition[];
}

/**
 * Whether a document of `type` keeps a main file in `file:content`.
 *
 * `isBlobHoldingDocType` knows the four stock types by name — File, Audio, Picture and Video —
 * and nothing else. A customer type that extends File, such as a `RentalContract`, was
 * therefore treated as having no main file: Create offered no field to attach it, Create sent
 * the title alone, and Import never offered the type for a file.
 *
 * Nuxeo's own content model settles it instead. A type keeps a main file when it is one of the
 * stock four, extends one of them however deep, or it or an ancestor carries the `file` schema —
 * among its schemas, or through a facet it declares — and it is not folderish (below). The local
 * Nuxeo already copies each ancestor's schemas and facets, and each facet's schemas, into a
 * type's own entry, so there that entry settles it; the ancestors and the facet definitions are
 * read as well so that the answer does not rest on that. A facet that contributes no schema has
 * no `schemas` key at all. The walk stops at a type it has already visited, so a malformed
 * `parent` cycle cannot loop.
 *
 * A folderish type — `Folderish` declared by it or an ancestor — keeps none unless it extends
 * one of the stock four. Workspace and Section carry the `file` schema for their own use; they
 * are containers, and Create would otherwise refuse to create one until a file was attached, and
 * Import offer them for files. Nuxeo Web UI keeps Workspace, Folder and other containers out of
 * its import by a list of names (`importBlacklist`), which Section is not on; the facet covers
 * Section and a customer's containers too.
 *
 * A dynamic facet, added to one document rather than declared by its type, is outside this:
 * Create and Import decide before there is a document.
 *
 * With no content model — not loaded yet, or refused by the server — this is the stock-name
 * check alone, so the four stock types never wait on it.
 *
 * Kept in this feature rather than exported from `nuxeo-client`, whose exports are part of the
 * published platform API.
 */
export function typeHoldsMainBlob(type: string, model: MainBlobContentModel): boolean {
  const fileFacets = new Set(
    model.facets
      .filter((facet) => facet.schemas?.some((schema) => schema.name === FILE_SCHEMA))
      .map((facet) => facet.name),
  );
  // Both are settled only by the whole ancestry: `Folderish` and `file` can each come from any
  // level. Reaching a stock type answers at once, folderish or not.
  let carriesFile = false;
  let folderish = false;
  const visited = new Set<string>();
  let current: string | undefined = type;
  while (current && !visited.has(current)) {
    if (isBlobHoldingDocType(current)) return true;
    const doctype: NuxeoDoctypeDefinition | undefined = model.doctypes[current];
    if (doctype?.schemas?.includes(FILE_SCHEMA)) carriesFile = true;
    if (doctype?.facets?.some((facet) => fileFacets.has(facet))) carriesFile = true;
    if (doctype?.facets?.includes(FOLDERISH_FACET)) folderish = true;
    visited.add(current);
    current = doctype?.parent;
  }
  return carriesFile && !folderish;
}
