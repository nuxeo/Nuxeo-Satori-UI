import type { NuxeoDocument } from '../models/document.model';

/**
 * The document enricher `nuxeo-agentic-core` adds, `org.nuxeo.agentic.lifecycle.AllowedTransitionsJsonEnricher`.
 *
 * Ask for it in `enrichers.document`. A server without the bundle ignores the name, as Nuxeo does
 * for any enricher it does not know, and the document then reads as allowing no transition.
 */
export const ALLOWED_TRANSITIONS_ENRICHER = 'allowedTransitions';

/** One lifecycle transition the current user may follow on a document now. */
export interface NuxeoAllowedTransition {
  /** The transition's name in the lifecycle policy: what `Document.FollowLifecycleTransition` takes. */
  readonly name: string;
  /** The state the document is in afterwards, as the lifecycle policy declares it. */
  readonly destinationState: string;
}

/**
 * The transitions the `allowedTransitions` enricher lists for `document`, in its order.
 *
 * The server lists only what its lifecycle allows from the current state and what it would follow
 * for this user, so this offers nothing the server refuses. It grants nothing either: the server
 * checks again when the transition is followed.
 *
 * An entry that is not an object with a non-empty `name` and `destinationState` is skipped: the
 * enricher never writes one, and the server fails to follow a transition its policy gives no
 * destination. A repeated name is kept once, and a document fetched without the enricher has none.
 */
export function allowedTransitions(
  document: NuxeoDocument | null | undefined,
): readonly NuxeoAllowedTransition[] {
  const listed = document?.contextParameters?.[ALLOWED_TRANSITIONS_ENRICHER];
  if (!Array.isArray(listed)) return [];
  const seen = new Set<string>();
  const transitions: NuxeoAllowedTransition[] = [];
  for (const entry of listed as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, destinationState } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue;
    if (typeof destinationState !== 'string' || destinationState === '') continue;
    seen.add(name);
    transitions.push({ name, destinationState });
  }
  return transitions;
}

/** Whether the enricher lists at least one transition the user may follow on `document`. */
export function canFollowAnyTransition(document: NuxeoDocument | null | undefined): boolean {
  return allowedTransitions(document).length > 0;
}
