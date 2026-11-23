/**
 * What a bulk action does when it runs over every result of a queue's query rather than the rows
 * selected: one command of Nuxeo's Bulk Action Framework, which the server runs over the page
 * provider's results (docs/extension-reference.md, section 5).
 */
export interface WholeQueryBulkAction {
  /** The framework's action, as the server registers it, such as `trash`. */
  readonly action: string;
  /**
   * What the server's action is sent, fixed here. A queue file cannot give it any, and neither can
   * a manifest: a framework action missing one it requires fails on the server, and `trash` sent
   * none stops the server's `trash` processor until Nuxeo restarts.
   */
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  /** Whether the queue's list is read again when the command ends: true for an action that changes records. */
  readonly refresh: boolean;
}

/**
 * The packaged bulk actions that can run over a whole query, by id. Those not here cannot: the
 * selection bar's Download, Add to Collection, Compare, Add to Clipboard and Publish work on the
 * documents a person has in hand, and the framework has no action for any of them that the server
 * opens over HTTP.
 *
 * Only `app.bulkActions.delete`, as the framework's `trash` with `value: true`. A stock Nuxeo
 * 2025.10 does not open `trash` over HTTP, so it answers HTTP 403 to everyone but an administrator,
 * and a deployment opens it with `httpEnabled="true"` on the action. The server checks the
 * person's permission on every record either way: one they may not trash is counted as an error.
 *
 * The table is code, not configuration. A manifest may hide, relabel or reorder the descriptor, and
 * a queue file names the action by id, but neither can map an id to another framework action or
 * other parameters.
 */
export const PACKAGED_WHOLE_QUERY_BULK_ACTIONS: Readonly<Record<string, WholeQueryBulkAction>> =
  Object.freeze({
    'app.bulkActions.delete': Object.freeze({
      action: 'trash',
      parameters: Object.freeze({ value: true }),
      refresh: true,
    }),
  });

/** What `id` does over a whole query, or `null` when it cannot run over one. */
export function wholeQueryBulkAction(id: string): WholeQueryBulkAction | null {
  return Object.prototype.hasOwnProperty.call(PACKAGED_WHOLE_QUERY_BULK_ACTIONS, id)
    ? PACKAGED_WHOLE_QUERY_BULK_ACTIONS[id]
    : null;
}
