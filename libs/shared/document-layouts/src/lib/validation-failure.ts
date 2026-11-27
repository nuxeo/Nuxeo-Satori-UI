const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * How Nuxeo 2025 answers a save that breaks a schema constraint: HTTP 422 with an `exception`
 * entity whose message names the property — `Constraint violation thrown on property
 * dc:description[0]: 'This property cannot contain more than 2,000 character(s).'`. The index
 * is reported for scalar properties too.
 */
const CONSTRAINT_VIOLATION =
  /^Constraint violation thrown on property ([\w.-]+:[\w./-]+?)(?:\[\d+\])*: '([\s\S]*)'$/;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * The fields a failed save names, with Nuxeo's message for each, or `null` for a failure that is
 * not a constraint violation. Reads the `validation_report` entity older servers send, which
 * Web UI reads, and the 422 `exception` this server sends. `failure` is an `HttpErrorResponse`
 * or its body. A violation that names no field is filed under `''`.
 */
export function readValidationFailure(
  failure: unknown,
  fallback: string,
): Record<string, string> | null {
  const body = isRecord(failure) && 'error' in failure ? failure['error'] : failure;
  if (!isRecord(body)) return null;

  if (body['entity-type'] === 'validation_report') {
    const messages: Record<string, string> = {};
    for (const violation of Array.isArray(body['violations']) ? body['violations'] : []) {
      if (!isRecord(violation)) continue;
      const first = (Array.isArray(violation['path']) ? violation['path'] : []).find(isRecord);
      const xpath = first ? (text(first['field_name']) ?? '') : '';
      messages[xpath] ??= text(violation['message']) ?? fallback;
    }
    return messages;
  }

  const match = CONSTRAINT_VIOLATION.exec(text(body['message']) ?? '');
  if (body['entity-type'] !== 'exception' || !match) return null;
  const [, xpath, message] = match;
  return { [xpath.split('/')[0] ?? xpath]: text(message) ?? fallback };
}

/** The statuses of a refusal whose message is the server's reason, for the person to read. */
const REFUSALS: ReadonlySet<number> = new Set([400, 403, 409, 422]);

/** What Nuxeo's Automation endpoint writes before a refused operation's own message. */
const INVOKED = /^(?:Failed to invoke operation [\w.-]+, )+/;

/** The longest reason shown as the server wrote it; a longer one is cut there. */
export const SERVER_REASON_MAX = 300;

/**
 * The server's reason for refusing a request, as its own message says it, or `null` when the
 * failure is not a refusal. A refusal is HTTP 400, 403, 409 or 422 with an `exception` entity, as
 * Nuxeo answers a deletion a legal hold forbids, or a change to a held record's files. Its text is
 * shown as text, never as markup, on one line, and cut at {@link SERVER_REASON_MAX} characters. A
 * server error (5xx), or a failure with no message, gives `null`, so that what the person reads is
 * never a stack or the server's internals. `failure` is an `HttpErrorResponse` or its body.
 */
export function readServerRefusal(failure: unknown): string | null {
  const status =
    isRecord(failure) && typeof failure['status'] === 'number' ? failure['status'] : null;
  const body = isRecord(failure) && 'error' in failure ? failure['error'] : failure;
  if (!isRecord(body)) return null;
  const answered = status ?? (typeof body['status'] === 'number' ? body['status'] : null);
  if (answered === null || !REFUSALS.has(answered)) return null;
  if ('entity-type' in body && body['entity-type'] !== 'exception') return null;
  // Nuxeo's Automation endpoint puts what it was running before the reason: the reason is the rest.
  const message = text(text(body['message'])?.replace(INVOKED, '') ?? null);
  if (message === null) return null;
  const line = message.replace(/\s+/g, ' ');
  return line.length > SERVER_REASON_MAX ? `${line.slice(0, SERVER_REASON_MAX - 1)}…` : line;
}
