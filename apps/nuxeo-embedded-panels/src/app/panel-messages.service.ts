import { DOCUMENT } from '@angular/common';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, filter, fromEvent, map, of } from 'rxjs';

import {
  EXPIRED,
  type PanelMessage,
  READY,
  messageTargets,
  originsOf,
  tokenFromMessage,
} from './panel-handshake';
import { PANEL_SERVER } from './panel-server';

/** A random id for a panel, so that a page with several answers each one. */
function panelId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * What a panel asks of the server before it asks its page for anything, and the handshake with its
 * page. One per panel.
 */
@Injectable()
export class PanelMessages {
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly server = inject(PANEL_SERVER);
  /** No interceptor and no credentials: nobody is signed in yet. */
  private readonly http = new HttpClient(inject(HttpBackend));

  /** This panel's id in its messages. */
  readonly panel = panelId();

  /**
   * The host's origins, as the server's configuration names them, given only to a page on one of
   * them; `null` for any other answer, so a panel on another page asks for nothing.
   */
  hostOrigins(host: string): Observable<ReadonlySet<string> | null> {
    return this.http
      .get<unknown>(
        `${this.server.origin}/nuxeo/agentic-embedded/v1/hosts/${encodeURIComponent(host)}`,
        { withCredentials: false },
      )
      .pipe(
        map((body) => originsOf(body, host)),
        catchError(() => of(null)),
      );
  }

  /** The page's own origin, which must be one of the host's. */
  pageOrigin(): string | null {
    return this.view?.location.origin ?? null;
  }

  /**
   * The tokens the page gives this panel, from the moment of subscription, which tells the page the
   * panel is ready; only those {@link tokenFromMessage} accepts.
   */
  tokens(host: string, recordId: string, origins: ReadonlySet<string>): Observable<string> {
    const view = this.view;
    if (!view) return of();
    return defer(() => {
      const messages = fromEvent<MessageEvent>(view, 'message').pipe(
        map((event) =>
          tokenFromMessage(event, {
            panel: this.panel,
            origins,
            sources: [view, view.parent],
          }),
        ),
        filter((token): token is string => token !== null),
      );
      // Listening before the page is told, so an answer sent at once is not missed.
      queueMicrotask(() => this.post(READY, host, recordId, origins));
      return messages;
    });
  }

  /** Tells the page the server refused the panel's token as expired, and a fresh one is wanted. */
  expired(host: string, recordId: string, origins: ReadonlySet<string>): void {
    this.post(EXPIRED, host, recordId, origins);
  }

  private post(
    type: PanelMessage['type'],
    host: string,
    recordId: string,
    origins: ReadonlySet<string>,
  ): void {
    if (!this.view) return;
    const message: PanelMessage = { type, panel: this.panel, host, recordId };
    for (const { target, origin } of messageTargets(this.view, origins)) {
      target.postMessage(message, origin);
    }
  }
}
