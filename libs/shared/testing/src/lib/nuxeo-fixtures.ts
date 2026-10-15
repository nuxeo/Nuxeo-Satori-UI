/**
 * Typed test fixtures for Nuxeo models.
 *
 * ## Design principles (from integration-test-audit.md §10.2 AC2)
 *
 * 1. **Every *required* field filled.** No `Partial<>` escape hatch on the base fixture:
 *    a factory returns a value the compiler accepts as the whole model, so a missing required
 *    field is a compile error rather than a runtime surprise.
 *
 *    This principle read "every field required" and that was not true of any fixture here.
 *    `NuxeoDocument` declares twelve genuinely optional fields — `parentRef`, `state`,
 *    `isTrashed`, `isVersion`, `facets`, `contextParameters` among them — and
 *    `nuxeoDocument()` sets none of them. A spec that reads `doc.facets` off an un-overridden
 *    fixture gets `undefined`, not a default, and the sentence above said otherwise. **Any
 *    optional field a spec depends on must be passed explicitly in `over`.**
 *
 * 2. **One factory per model.** Not a god-object with 40 overrides. Each fixture fills one
 *    specific shape and does it completely.
 *
 * 3. **Type-safe overrides.** The `over` parameter accepts `Partial<T>` to allow selective
 *    override, but the base fixture provides every required field. A field-type change in the
 *    model breaks compilation in exactly the specs that use these fixtures — that's the negative
 *    control that proves they're coupled correctly.
 *
 *    `Partial<T>` alone does not deliver this, which is why `withoutUndefined` exists below:
 *    without `exactOptionalPropertyTypes` the compiler accepts `{ uid: undefined }` and the
 *    spread then overwrites the default with nothing. Required fields survive any override.
 *
 * Extracted from duplicate builders in the adf-hx bridge's port specs, since removed.
 */

import type { NuxeoDocument, NuxeoAce } from '@nuxeo-satori/platform/nuxeo-client';

/**
 * Drop keys whose value is `undefined`, so an override cannot delete a default.
 *
 * `Partial<T>` does not mean "these keys may be omitted" unless `exactOptionalPropertyTypes` is
 * on, and it is not set anywhere in this workspace. It means "these keys may also be
 * `undefined`" — so `nuxeoDocument({ uid: undefined })` compiled without complaint and returned
 * a document whose required `uid` was `undefined`, with the key present. Both factories below
 * promise the opposite in their first line, and a spec reading `doc.uid` off that fixture got
 * `undefined` from a helper whose whole purpose is that it cannot.
 *
 * Filtering here rather than turning the compiler flag on: `exactOptionalPropertyTypes` is a
 * workspace-wide change with a blast radius far beyond two fixtures, and the guarantee these
 * factories make should not depend on a setting a future tsconfig edit could quietly drop.
 *
 * Only `undefined` is removed. `null` is a value these models use deliberately — every
 * `nuxeoAce` default below is one — and overriding a field to `null` still works.
 */
function withoutUndefined<T extends object>(over: Partial<T>): Partial<T> {
  return Object.fromEntries(
    Object.entries(over).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * A Nuxeo document with every **required** field of `NuxeoDocument` filled: `uid`, `title`,
 * `type`, `path`, `lastModified` and `properties`, describing a typical File in a workspace.
 *
 * The twelve optional fields are deliberately **absent**, not defaulted — `parentRef`,
 * `lockOwner`, `lockCreated`, `state`, `isTrashed`, `isCheckedOut`, `isVersion`,
 * `versionableId`, `isLatestVersion`, `isLatestMajorVersion`, `facets` and
 * `contextParameters`. A live Nuxeo omits them too unless the enricher that supplies them was
 * requested, so absent is the honest default; inventing one would make specs pass against data
 * the server would not have sent. **Pass any of them in `over` if the spec under test reads
 * it**, rather than relying on the fixture to have a value there.
 *
 * @param over - Selective overrides. Required fields already have values; optional fields have
 * none until you supply them here.
 *
 * @example
 * ```ts
 * const folder = nuxeoDocument({ type: 'Folder', title: 'Reports' });
 * const note = nuxeoDocument({
 *   type: 'Note',
 *   path: '/default-domain/workspaces/shared/note-1',
 *   properties: { 'note:note': 'Meeting minutes' }
 * });
 * ```
 */
export function nuxeoDocument(over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Invoice',
    type: 'File',
    path: '/default-domain/workspaces/ws/Invoice',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...withoutUndefined(over),
  };
}

/**
 * One complete Nuxeo ACE (Access Control Entry). Every field that appears optional on `NuxeoAce`
 * is required; the type system allows `null` but does not allow omission.
 *
 * This fixture was extracted because partial literals behind casts hid incomplete test data, and
 * the comment on line 39 of `nuxeo-document-api.spec.ts` explicitly calls out that problem.
 *
 * @param over - Selective overrides. Defaults represent a granted Read permission for user `jdoe`
 * with no time bounds.
 *
 * @example
 * ```ts
 * const writeGrant = nuxeoAce({ permission: 'Write', username: 'admin' });
 * const timedGrant = nuxeoAce({
 *   begin: '2026-01-01',
 *   end: '2026-12-31',
 *   status: 'pending'
 * });
 * const externalShare = nuxeoAce({
 *   username: 'email:user@example.com',
 *   externalUser: true,
 *   permission: 'ReadWrite'
 * });
 * ```
 */
export function nuxeoAce(over: Partial<NuxeoAce> = {}): NuxeoAce {
  return {
    id: '1',
    username: 'jdoe',
    externalUser: false,
    permission: 'Read',
    granted: true,
    creator: null,
    begin: null,
    end: null,
    status: 'effective',
    ...withoutUndefined(over),
  };
}
