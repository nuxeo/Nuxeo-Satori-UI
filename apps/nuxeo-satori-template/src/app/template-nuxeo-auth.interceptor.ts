import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { TemplateSessionService } from './template-session.service';

/**
 * Attach the session credential to Nuxeo requests, and only to Nuxeo requests.
 *
 * Every call the platform's services make goes through `NuxeoApiBase`, which
 * never sets an `Authorization` header — authentication is the host
 * application's business, because only the host knows whether it is doing Basic,
 * SSO, or a token. This interceptor is the template's answer, and it is the
 * reason no component in this application constructs an auth header.
 *
 * ## Why the URL is filtered
 *
 * A request to the application's own origin outside `/nuxeo/` must **not**
 * carry a credential — sending one would leak it to whatever static host serves
 * the bundle. So the check is on the resolved path, not on "is it a relative
 * URL". The configuration requests never reach this interceptor at all:
 * `AppConfigService` sends them without it.
 *
 * The absolute-URL branch matters as soon as a deployment sets Layer 0's
 * `nuxeoApiOrigin` to a cross-origin Nuxeo: without it, every request would go
 * out unauthenticated and every list would render empty.
 */
export const templateNuxeoAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(TemplateSessionService);
  const apiOrigin = inject(NUXEO_API_ORIGIN);

  const basic = session.basicCredentials();
  if (!basic || !isNuxeoApiRequest(req.url, apiOrigin)) return next(req);

  return next(
    req.clone({
      headers: req.headers.set('Authorization', `Basic ${basic}`),
      // Basic and a stale `JSESSIONID` cookie fight, and the cookie wins — which
      // presents as "signed in as the wrong user" after a Nuxeo Web UI session.
      withCredentials: false,
    }),
  );
};

function isNuxeoApiRequest(url: string, apiOrigin: string): boolean {
  if (url.startsWith('/')) return url.startsWith('/nuxeo/');
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  try {
    const parsed = new URL(url);
    const allowed = new Set<string>([window.location.origin]);
    const configured = apiOrigin.trim().replace(/\/$/, '');
    if (configured.startsWith('http://') || configured.startsWith('https://')) {
      allowed.add(new URL(configured).origin);
    }
    return allowed.has(parsed.origin) && parsed.pathname.startsWith('/nuxeo/');
  } catch {
    return false;
  }
}
