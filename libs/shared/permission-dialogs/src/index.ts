/**
 * The four permission and sharing dialogs, shared by `browse`, `document-detail` and
 * `collections`.
 *
 * ## Why they are here and not in `collections`
 *
 * They used to live in `libs/features/collections`, and `browse` and `document-detail`
 * imported them across the feature boundary. CLAUDE.md forbids exactly that shape —
 * shared logic goes in `libs/shared/` — and it went unnoticed
 * because `enforce-module-boundaries` was configured with `sourceTag: '*'` →
 * `onlyDependOnLibsWithTags: ['*']`, which permits every edge in the graph. The rule was
 * on; it just could not say no.
 *
 * ## Why not `libs/shared/ui`
 *
 * `libs/shared/ui` is a **published** entry point of `@nuxeo/satori-platform` — it is
 * `@nuxeo/satori-platform/ui`. Putting these here rather than there keeps eight symbols
 * out of the customer-facing API surface. They are internal application UI, and once a
 * customer can import a name, renaming it is a breaking change.
 */

export { AddPermissionDialogComponent } from './lib/add-permission-dialog/add-permission-dialog';
export type { AddPermissionDialogData } from './lib/add-permission-dialog/add-permission-dialog';
export { UpdatePermissionDialogComponent } from './lib/update-permission-dialog/update-permission-dialog';
export type { UpdatePermissionDialogData } from './lib/update-permission-dialog/update-permission-dialog';
export { DeletePermissionDialogComponent } from './lib/delete-permission-dialog/delete-permission-dialog';
export type { DeletePermissionDialogData } from './lib/delete-permission-dialog/delete-permission-dialog';
export { ShareExternalDialogComponent } from './lib/share-external-dialog/share-external-dialog';
export type { ShareExternalDialogData } from './lib/share-external-dialog/share-external-dialog';
