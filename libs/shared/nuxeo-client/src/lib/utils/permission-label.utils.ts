/**
 * The Nuxeo permissions this application ships a label for.
 *
 * An allowlist rather than a bare `translate('permissions.right.' + name)` because Nuxeo
 * permissions are open-ended: a marketplace package can define its own, and the server sends the
 * identifier whether or not we know it. Handing an unknown identifier to ngx-translate returns
 * the key itself, so a custom permission would render as `permissions.right.CustomFromMarketplace`
 * in the table. Checking membership first keeps the existing behaviour — unknown permissions show
 * their raw Nuxeo name, which is at least meaningful to an administrator.
 */
const LABELLED_PERMISSIONS = new Set([
  'Everything',
  'ReadWrite',
  'Read',
  'Write',
  'ReadVersion',
  'WriteVersion',
  'Version',
  'ReadRemove',
  'AddChildren',
  'RemoveChildren',
  'Remove',
  'WriteSecurity',
  'Unlock',
  'SetRetention',
  'UnsetRetention',
  'ManageWorkflows',
  'ReadCanCollect',
  'CanAskForPublishing',
  // The atomic permissions Web UI labels too (label.security.permission.*).
  'Browse',
  'ReadChildren',
  'ReadLifeCycle',
  'ReadProperties',
  'ReadSecurity',
  'WriteLifeCycle',
  'WriteProperties',
  'ManageLegalHold',
  'ManageRecord',
]);

/**
 * Maps a Nuxeo permission identifier to its display label.
 *
 * The document, collection and browse permission tables each carried their own copy of this as a
 * hardcoded English `Record<string, string>`, so all three read `Manage everything` in every
 * locale. `translate` is required for the reason given on `formatPermissionTimeFrame`: a default
 * that returns the English turns every un-updated call site into a silent no-op.
 */
export function permissionRightLabel(
  permission: string,
  translate: (key: string) => string,
): string {
  return LABELLED_PERMISSIONS.has(permission)
    ? translate(`permissions.right.${permission}`)
    : permission;
}
