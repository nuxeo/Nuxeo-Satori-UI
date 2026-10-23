/**
 * The four error variants, by the HTTP status each stands for — Satori 1.0's `sat-401-`,
 * `sat-403-`, `sat-404-` and `sat-500-error-state`.
 */
export type NxsErrorStatus = 401 | 403 | 404 | 500;

/**
 * The variant for a failed request.
 *
 * 401, 403 and 404 map to themselves. Anything else — a 5xx, a network failure (status 0), an
 * error thrown with no status at all — is 500: the request did not complete and nothing says the
 * user is the reason.
 */
export function nxsErrorStatus(error: unknown): NxsErrorStatus {
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  return status === 401 || status === 403 || status === 404 ? status : 500;
}
