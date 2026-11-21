import { InjectionToken } from '@angular/core';
import { type Observable, of } from 'rxjs';

/** App-owned authentication preparation before each NEV launch; standalone consumers keep their own auth. */
export const ARENDER_PREPARE_SESSION = new InjectionToken<() => Observable<boolean>>(
  'ARENDER_PREPARE_SESSION',
  {
    providedIn: 'root',
    factory: () => () => of(true),
  },
);

export interface ARenderConfig {
  /**
   * Base URL of the ARender UI as seen by the browser. Per-deployment, and a privilege boundary rather
   * than a cosmetic setting: it is navigated in an `iframe`.
   *
   * Must be an absolute `http(s)` origin with **no query string, no fragment and no userinfo**. The
   * client no longer appends anything to it: under NEV 2026 this value is the origin allow-list the
   * server-supplied previewer URL is checked against, and that comparison reads `origin`, which
   * discards a query, fragment and userinfo while still reporting a match. A base carrying any of
   * the three is a misconfiguration whose effect would otherwise be invisible.
   *
   * **The scheme rule is host-relative, not build-relative.** `http:` is rejected only where it would
   * downgrade the page framing it:
   *
   * | Application served over | `http:` viewerOrigin |
   * | ----------------------- | -------------------- |
   * | `https://…`             | rejected — the real downgrade |
   * | `http://…` (on-prem)    | accepted — nothing to downgrade |
   * | any, dev build          | accepted |
   *
   * An earlier version of this comment said it "must be `https:` in production", which was never what
   * the preview-fallback path did and is not what `ARenderService` does — a consumer following it would
   * have rejected a supported on-prem configuration. See `insecureAllowedForHost`.
   */
  viewerOrigin: string;

  /**
   * **Vestigial. Nothing reads this, and it is not validated.**
   *
   * It was the base URL of Nuxeo as the ARender containers saw it, used to build `nxfile` URLs
   * through an nginx auth-proxy sidecar that added a shared Basic credential. Under NEV 2026 the
   * connector resolves blobs itself from the `documentId` parameter over OAuth2 as the signed-in
   * user, so the client builds no such URL.
   *
   * Retained because removing it is a breaking change to `AppARenderConfig`, which is published
   * and frozen in `docs/api/platform.api.md`. Deliberately **not** required by
   * `completeARenderConfig` and **not** checked by `ARenderService`: gating a feature on a field
   * nothing consumes can only reject configurations that would have worked.
   */
  nuxeoInternalUrl: string;
}

/**
 * ARender annotation viewer configuration, or `null` when ARender is not deployed.
 *
 * **Nullable, and `null` is the default.** `integrations.arender` in the Layer 0 bootstrap file
 * (`agentic-ui-config/bootstrap.json`, read before authentication — *not* the post-auth runtime
 * manifest, which has no `integrations` key) defaults to `null` and nothing in this repository sets
 * it, so an unconfigured
 * deployment is the normal case, not an edge case. Callers must handle `null`; `ARenderService`
 * does, and degrades to "Annotations are not available".
 *
 * This token used to be typed non-nullable with a factory returning compiled-in
 * `http://localhost:8180` and `http://nuxeo-auth-proxy/nuxeo` defaults. Both were wrong:
 *
 *   - A shipped build with no manifest pointed the annotation viewer at the *user's own*
 *     `localhost:8180`, and `.cursor/rules/security.mdc` prohibits exactly this kind of
 *     hardcoded config default.
 *   - `http://` for a value that is navigated in an iframe is a plaintext privilege boundary
 *     (Sonar `S5332`). Sonar never reported the literals in this file at all, because
 *     `sonar-project.properties` excludes every `*.config.ts` file — so the scanner is blind to
 *     the very filename pattern where hardcoded configuration is most likely to live.
 *
 * There is deliberately no fallback now. A deployment that wants ARender supplies `viewerOrigin` in
 * its manifest; anything less is `null`.
 *
 * **`viewerOrigin` is the only required value.** `nuxeoInternalUrl` is vestigial (see above) and is
 * neither required nor validated — gating on a field nothing consumes can only reject
 * configurations that would have worked.
 *
 * `viewerOrigin` is enforced **twice, in different layers**, and neither is redundant:
 *
 *   - `bootstrap-config.ts`'s `completeARenderConfig` returns `null` unless the merged result has a
 *     non-blank `viewerOrigin`, so a manifest without one never reaches the token.
 *   - `ARenderService` re-checks, and additionally requires it to be an absolute http(s) base with
 *     no query, fragment or userinfo — because it is navigated in an iframe and serves as the
 *     origin allow-list for the URL Nuxeo returns.
 *
 * An earlier version of this comment claimed `bootstrap-config.ts` already refused half a
 * configuration when it did not: the merge filled the missing half with `''`, producing precisely
 * the object the comment said was impossible. The prose is not the contract; the check is.
 */
export const ARENDER_CONFIG = new InjectionToken<ARenderConfig | null>('ARENDER_CONFIG', {
  providedIn: 'root',
  factory: () => null,
});
