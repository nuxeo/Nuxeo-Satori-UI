import { inject, Injectable, isDevMode } from '@angular/core';
import { catchError, defer, map, Observable, of, switchMap, take } from 'rxjs';
import { ARENDER_CONFIG, ARENDER_PREPARE_SESSION, type ARenderConfig } from '../arender.config';
import {
  isNavigableBaseUrl,
  insecureAllowedForHost,
  navigableUrlOrNull,
} from '../utils/navigable-url';
import { NuxeoApiBase } from './nuxeo-api-base';

/** Shape of the `Document.ARenderGet*Url` automation responses. */
interface ARenderPreviewerUrlResponse {
  readonly previewerUrl?: string | null;
}

/**
 * ARender annotation viewer integration.
 *
 * **Every method must answer for an absent configuration.** `ARENDER_CONFIG` is `null` whenever
 * `integrations.arender` is not set in the Layer 0 bootstrap file, which is the default for every
 * deployment in this repository. Before the guards below existed, `null` produced a
 * `TypeError: Cannot read properties of null` in all three methods — and the reason nobody noticed
 * is worth keeping:
 *
 *   - `isAvailable` raised its `TypeError` *inside* an Observable subscriber, so RxJS converted it
 *     to an error notification, and `document-detail`'s `error:` handler set the URL to `null`.
 *     The UI therefore reached "Annotations are not available" — the right outcome, produced by a
 *     swallowed type error rather than by a decision.
 *   - `getPreviewerUrl` threw *synchronously*, which no `error:` handler can catch. It was
 *     unreachable only because `isAvailable` errored first and `switchMap` never ran.
 *
 * So the correct behaviour was one refactor away from an unhandled exception, and `typecheck`
 * could not see it: Angular types `useFactory` as `(...args: any[]) => any`, so a provider handing
 * `null` to a non-nullable token compiles clean.
 */
@Injectable({ providedIn: 'root' })
export class ARenderService {
  private readonly rawCfg = inject(ARENDER_CONFIG);
  private readonly api = inject(NuxeoApiBase);
  private readonly prepareSession = inject(ARENDER_PREPARE_SESSION);

  /**
   * The configuration, or `null` if `viewerOrigin` is absent, blank, or **not safe to navigate**.
   *
   * This is the single choke point for ARender's trust decision, and it fails closed. Under NEV
   * 2026 only one field is load-bearing, so only one is checked. Three things disqualify a
   * configuration:
   *
   * **1. Absent.** `integrations.arender` defaults to `null`.
   *
   * **2. A blank `viewerOrigin`** — worse than `null`, because `fetch('')` resolves against the
   * *application's own* origin, so `isAvailable()` would report a viewer as present. It would also
   * allow-list this application's own origin in `framableOrNull`, which is the more dangerous half:
   * a same-origin URL in the response body would then be framed and trusted.
   *
   * **3. A `viewerOrigin` that is not an http(s) origin.** This is the one that matters most.
   * `viewerOrigin` is the allow-list deciding which origin may be bypassed and loaded into an
   * `iframe`, and the manifest it comes from is a *customer-editable* surface. A manifest setting
   * it to `javascript:alert(1)` is complete, non-blank and well-formed — `new URL()` accepts
   * `javascript:` without complaint — so nothing above catches it, and the result is script
   * execution in this application's origin from a configuration value. `https:` is required unless
   * `isDevMode()`, because a plaintext document in an iframe is a downgrade.
   *
   * Enforcing these here means no caller can reach a dangerous origin in the first place;
   * `framableOrNull` then checks the URL the server returns against this same origin, and the
   * bypass in `document-detail` validates once more before trusting, because defence for a
   * privilege boundary should not rest on one function.
   */
  private get cfg(): ARenderConfig | null {
    const cfg = this.rawCfg;
    if (!cfg) return null;

    // Navigated in an iframe, and now also the origin allow-list for the URL the server returns
    // (see `framableOrNull`). `isNavigableBaseUrl` rather than a bare origin check: a value
    // carrying its own query, fragment or userinfo is a misconfiguration whether or not this code
    // still appends to it, and `origin` would silently discard all three while reporting a match.
    // `insecureAllowedForHost`, not a bare `isDevMode()`. An iframe is a downgrade only relative to
    // its host document, so refusing `http:` when the application is itself served over `http:` — an
    // ordinary on-prem deployment — silently disabled ARender for exactly those deployments without
    // making anything safer. The preview-fallback path in `document-detail` already reasoned this out
    // and applied it only there; this site kept the stricter check, so the repository documented one
    // policy and implemented another.
    if (!isNavigableBaseUrl(cfg.viewerOrigin, insecureAllowedForHost(isDevMode()))) return null;

    // `nuxeoInternalUrl` is deliberately **not** checked. It is vestigial under NEV 2026: it
    // addressed the ARender 2023 stack, where the client encoded an nxfile URL for the nginx
    // sidecar to fetch with a shared Basic credential. NEV's connector resolves blobs itself from
    // `documentId` over OAuth2, so nothing here reads it.
    //
    // An earlier version of this change kept validating it, which review correctly called out as a
    // trap: a deployment that had retired the sidecar would have to keep a dummy valid URL or the
    // whole integration silently disabled itself. Validating a field nothing consumes can only
    // reject configurations that would have worked. The field itself stays because removing it is a
    // breaking change to the published `AppARenderConfig`.

    return cfg;
  }

  /**
   * The server-built previewer URL if it is safe to frame, otherwise `null`.
   *
   * This is the new point of trust, and it is stricter than what it replaces. The URL no longer
   * comes from configuration this code concatenated — it arrives in an **HTTP response body** and
   * is then bypassed into an `iframe`, so it is attacker-controlled the moment the Nuxeo server is.
   *
   * `allowedOrigins: [viewerOrigin]` is therefore load-bearing rather than belt-and-braces. The
   * previous implementation validated only the scheme, and
   * `docs/sonarcloud-security-remediation-plan.md` records that missing origin check as an
   * accepted residual risk on the Category C bypass. Since `viewerOrigin` is no longer needed to
   * *build* anything, it can pay for itself as the allow-list instead, which closes that gap.
   *
   * Note `origin` discards any path: a `viewerOrigin` of `https://host/arender` allow-lists the
   * whole of `https://host`, not just `/arender`. `isNavigableBaseUrl` in `cfg` already refuses a
   * query, fragment or userinfo on that value, so the widening is limited to the path — acceptable,
   * because a viewer sharing a host with something untrusted is not a deployment we support.
   */
  private framableOrNull(url: string | null | undefined, cfg: ARenderConfig): string | null {
    return navigableUrlOrNull(url, {
      allowInsecure: insecureAllowedForHost(isDevMode()),
      allowedOrigins: [cfg.viewerOrigin],
    });
  }

  /**
   * The previewer URL for one document, from the `nuxeo-arender` addon.
   *
   * Asks Nuxeo rather than building the URL here, because **the client cannot build it.** NEV's
   * `BlobNuxeoURLParser.canParse` claims a request only when it carries a `documentId` parameter,
   * whose value is `<repository>,<uid>,<xpath>,<digest>` — and the blob digest is not something a
   * browser can compute. Concatenating `?url=<nxfile-url>` instead, as this method used to, is the
   * 2023 generic-ARender contract: NEV 2026 leaves it unparsed and renders
   * "An error occured / Could not open document".
   *
   * The viewer host comes from the server too, via `arender.server.previewer.host` in `nuxeo.conf`.
   * That retires `nuxeoInternalUrl` and the nginx sidecar that used to inject a **single shared**
   * Basic credential on every user's behalf: NEV fetches blobs itself over OAuth2 as the signed-in
   * user, so Nuxeo's per-user ACLs finally apply to the viewer.
   *
   * Answers `null` when ARender is unconfigured, when the operation fails, or when the URL it
   * returns is not framable — all of which the caller already treats as "no annotation viewer for
   * this document".
   */
  getPreviewerUrl(docUid: string, blobXPath = 'file:content'): Observable<string | null> {
    const cfg = this.cfg;
    if (!cfg) return of(null);

    return defer(() => this.prepareSession()).pipe(
      take(1),
      switchMap((ready) =>
        ready
          ? this.api
              .post<ARenderPreviewerUrlResponse>(
                '/nuxeo/api/v1/automation/Document.ARenderGetPreviewerUrl',
                { input: docUid, params: { blobXPath } },
              )
              .pipe(
                map((response) => this.framableOrNull(response?.previewerUrl, cfg)),
                // The addon is absent on any server without the `nuxeo-arender` package, which answers 404
                // rather than an empty body. That is a deployment state, not a defect, and it must degrade
                // to "Annotations are not available" exactly as an unconfigured integration does.
                catchError(() => of(null)),
              )
          : of(null),
      ),
      catchError(() => of(null)),
    );
  }

  /**
   * The side-by-side comparison URL for two documents.
   *
   * Same reasoning as `getPreviewerUrl`: the server appends a second `documentId` and
   * `visualization.multiView.doComparison=true`, neither of which the client can assemble without
   * both digests.
   */
  getDiffUrl(leftDocUid: string, rightDocUid: string): Observable<string | null> {
    const cfg = this.cfg;
    if (!cfg) return of(null);

    return defer(() => this.prepareSession()).pipe(
      take(1),
      switchMap((ready) =>
        ready
          ? this.api
              .post<ARenderPreviewerUrlResponse>(
                '/nuxeo/api/v1/automation/Document.ARenderGetDiffUrl',
                {
                  params: { leftDocId: leftDocUid, rightDocId: rightDocUid },
                },
              )
              .pipe(
                map((response) => this.framableOrNull(response?.previewerUrl, cfg)),
                catchError(() => of(null)),
              )
          : of(null),
      ),
      catchError(() => of(null)),
    );
  }

  /**
   * Checks whether ARender is reachable. Uses a `no-cors` fetch to avoid CORS blocks — the promise
   * resolves for any server response and rejects only on a network error (server unreachable).
   *
   * Answers `false` without probing anything when ARender is not configured. Not probing matters:
   * `fetch(undefined)` resolves against the *application's own* origin, which would report a
   * viewer as present when none is deployed.
   */
  isAvailable(): Observable<boolean> {
    const cfg = this.cfg;
    if (!cfg) return of(false);

    return new Observable<boolean>((subscriber) => {
      fetch(cfg.viewerOrigin, { mode: 'no-cors' })
        .then(() => {
          subscriber.next(true);
          subscriber.complete();
        })
        .catch(() => {
          subscriber.next(false);
          subscriber.complete();
        });
    });
  }
}
