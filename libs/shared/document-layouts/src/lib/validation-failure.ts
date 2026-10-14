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
