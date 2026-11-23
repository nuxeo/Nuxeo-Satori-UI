import {
  isBlobHoldingDocType,
  type NuxeoDoctypeDefinition,
} from '@nuxeo/satori-platform/nuxeo-client';

/**
 * Whether a document of `type` keeps a main file in `file:content`.
 *
 * `isBlobHoldingDocType` knows the four stock types by name — File, Audio, Picture and Video —
 * and nothing else. A customer type that extends File, such as a `RentalContract`, was
 * therefore treated as having no main file: Create offered no field to attach it, Create sent
 * the title alone, and Import never offered the type for a file.
 *
 * Nuxeo's own content model settles it instead. A type keeps a main file when it is one of the
 * stock four, extends one of them however deep, or carries the `file` schema itself. The walk
 * stops at a type it has already visited, so a malformed `parent` cycle cannot loop.
 *
 * With no content model — not loaded yet, or refused by the server — this is the stock-name
 * check alone, so the four stock types never wait on it.
 *
 * Kept in this feature rather than exported from `nuxeo-client`, whose exports are part of the
 * published platform API.
 */
export function typeHoldsMainBlob(
  type: string,
  doctypes: Readonly<Record<string, NuxeoDoctypeDefinition>>,
): boolean {
  const visited = new Set<string>();
  let current: string | undefined = type;
  while (current && !visited.has(current)) {
    if (isBlobHoldingDocType(current)) return true;
    if (doctypes[current]?.schemas?.includes('file')) return true;
    visited.add(current);
    current = doctypes[current]?.parent;
  }
  return false;
}
