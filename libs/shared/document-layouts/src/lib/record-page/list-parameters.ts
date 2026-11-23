import { isFieldReference } from '@agentic-ui/shared/app-definition';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

/**
 * A list's page provider parameters, read from the open record (layout-v2.md, section 7).
 *
 * Each is a literal, or `{ "field" }` for one of the record's properties. Nuxeo returns some
 * system properties beside a document's properties rather than among them: those below are read
 * from where they are, and any other `ecm:` one is refused, since it is never among them.
 */

const SYSTEM_PROPERTIES: Readonly<Record<string, (document: NuxeoDocument) => unknown>> = {
  'ecm:uuid': (document) => document.uid,
  'ecm:path': (document) => document.path,
  'ecm:primaryType': (document) => document.type,
  'ecm:currentLifeCycleState': (document) => document.state,
  'ecm:parentId': (document) => document.parentRef,
};

/**
 * Nuxeo replaces a parameter such as `$currentUser` with the signed-in user's name, on the server.
 * A literal may use that on purpose. A value read from the record may not: whatever the record
 * holds would change whose results everyone sees.
 */
const SERVER_PLACEHOLDER = /^\$/;

export type ListParameters =
  /** The values to send, in order. */
  | { readonly values: readonly string[] }
  /** Why the list is not asked for: a parameter with no single value to send. */
  | { readonly missing: string };

/** One value as a page provider is sent it, or `null` when it has no single one. */
function sendable(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/**
 * The values `parameters` give for `document`. A parameter with no value, or with a list or an
 * object for one, leaves the list unasked: a page provider given an empty parameter would match
 * what its author did not mean, or nothing, and the server would be asked for it anyway.
 */
export function listParameters(
  parameters: readonly unknown[],
  document: NuxeoDocument | null,
): ListParameters {
  const values: string[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (isFieldReference(parameter)) {
      // A property is `<prefix>:<name>`, and nothing an object inherits has a colon in its name.
      const read = SYSTEM_PROPERTIES[parameter.field];
      if (!read && parameter.field.startsWith('ecm:')) {
        return {
          missing: `parameters[${index}] reads ${parameter.field}, which this build does not read from a record`,
        };
      }
      const value = document
        ? read
          ? read(document)
          : document.properties[parameter.field]
        : undefined;
      const sent = sendable(value);
      if (sent !== null && SERVER_PLACEHOLDER.test(sent)) {
        return {
          missing: `parameters[${index}] reads ${parameter.field}, whose value starts with "$", which the server would read as its own placeholder`,
        };
      }
      if (sent === null) {
        return {
          missing: `parameters[${index}] reads ${parameter.field}, which ${document ? 'has no single value on this record' : 'needs an open record'}`,
        };
      }
      values.push(sent);
      continue;
    }
    const sent = sendable(parameter);
    if (sent === null) return { missing: `parameters[${index}] has no value to send` };
    values.push(sent);
  }
  return { values };
}
