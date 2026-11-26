import { type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { throwError } from 'rxjs';

import { PANEL_SERVER } from './panel-server';

/**
 * The panel's token, as its page gave it: held here only, for the panel's life, in memory. Never
 * in an attribute, the DOM, a URL, storage or the console.
 */
@Injectable()
export class PanelToken {
  private readonly current = signal<string | null>(null);

  readonly value = this.current.asReadonly();

  set(token: string): void {
    this.current.set(token);
  }

  clear(): void {
    this.current.set(null);
  }
}

/** Whether a request is to the server's REST API, the only place the token is sent. */
export function isRestApiRequest(url: string, serverOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, serverOrigin);
  } catch {
    return false;
  }
  return parsed.origin === serverOrigin && parsed.pathname.startsWith('/nuxeo/api/');
}

/**
 * Signs the panel's requests to the server's REST API with its token, `Authorization: Bearer`, and
 * sends none of the browser's credentials with any request: no cookie, so the panel never reads as a
 * session the user may have on the server, and only the token decides who it reads as. A request
 * whose address holds the token is refused before it is sent, so that no change elsewhere can put
 * the token in a URL.
 */
export const panelTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const server = inject(PANEL_SERVER);
  const token = inject(PanelToken).value();
  if (token !== null && request.urlWithParams.includes(token)) {
    return throwError(
      () => new Error('A request would have put the panel token in a URL; not sent'),
    );
  }
  const signed =
    token !== null && isRestApiRequest(request.url, server.origin)
      ? { Authorization: `Bearer ${token}` }
      : undefined;
  return next(request.clone({ withCredentials: false, setHeaders: signed }));
};
