import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DocumentLayoutService,
  RecordPageComponent,
  type ResolvedRecordLayout,
  isDocumentId,
} from '@agentic-ui/shared/document-layouts';
import {
  NxsEmptyStateComponent,
  NxsErrorStateComponent,
  type NxsErrorStatus,
  NxsSpinnerComponent,
  nxsErrorStatus,
} from '@nuxeo/satori-platform/components';
import { NuxeoApiBase, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, catchError, concat, map, of, switchMap } from 'rxjs';

import { HOST_ID } from './panel-handshake';
import { PanelMessages } from './panel-messages.service';
import { PanelToken } from './panel-token';

/** What a panel shows, in the order it gets there. */
export type PanelState =
  | { readonly status: 'starting' }
  | { readonly status: 'signing-in' }
  | { readonly status: 'loading' }
  | { readonly status: 'refused'; readonly reason: 'origin' | 'attributes' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'not-found' }
  | { readonly status: 'no-layout' }
  | { readonly status: 'failed'; readonly error: NxsErrorStatus }
  | {
      readonly status: 'ready';
      readonly document: NuxeoDocument;
      readonly layout: ResolvedRecordLayout;
    };

/**
 * The cards of a record's page the panel shows: those `cards` names, in its order, as one list of
 * cards with no banner, tab or preview; or the whole page when it names none.
 */
export function panelLayout(
  layout: ResolvedRecordLayout,
  cards: readonly string[] | null,
): ResolvedRecordLayout {
  if (cards === null || cards.length === 0) return layout;
  const all = layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
  const picked = cards.flatMap((id) => all.filter((card) => card.id === id));
  return {
    ...layout,
    columns: Math.max(1, Math.min(layout.columns, picked.length)),
    banners: [],
    preview: null,
    review: false,
    shareLinks: false,
    tabs: null,
    cards: picked,
  };
}

/**
 * A record page's panel, inside another system's page (docs/business-apps/embedded-panels.md): the
 * record's `view` layout, drawn by the layout engine (`lib-record-page`), read-only, as the user the
 * page's token signs in, behind a shadow root so that the page's styles and the panel's do not
 * meet.
 *
 * Before it asks its page for a token, it asks the server for the host's origins, and refuses to go
 * on unless the page is on one of them. It then reads the record through the REST API with the
 * token, and draws it with the user's own permissions: a record they may not read is not found.
 * When the server refuses the token as expired, it asks its page for a fresh one, and reads again.
 */
@Component({
  selector: 'nxe-record-panel',
  standalone: true,
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [
    NxsEmptyStateComponent,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    RecordPageComponent,
    TranslatePipe,
  ],
  templateUrl: './record-panel.component.html',
  styleUrl: './record-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPanelComponent {
  readonly recordId = input<string | null>(null);
  readonly host = input<string | null>(null);
  readonly cards = input<readonly string[] | null>(null);

  private readonly messages = inject(PanelMessages);
  private readonly token = inject(PanelToken);
  private readonly api = inject(NuxeoApiBase);
  private readonly layouts = inject(DocumentLayoutService);

  /** Bumped by Retry, so the record is read again with the same token. */
  private readonly attempt = signal(0);
  private readonly attempts = toObservable(this.attempt);

  /** The three attributes as one, so that a page setting them together starts the panel once. */
  private readonly asked = computed(
    () => ({ recordId: this.recordId(), host: this.host(), cards: this.cards() }),
    {
      equal: (a, b) =>
        a.recordId === b.recordId &&
        a.host === b.host &&
        (a.cards ?? []).join(',') === (b.cards ?? []).join(','),
    },
  );

  protected readonly state = toSignal(
    toObservable(this.asked).pipe(
      switchMap(({ recordId, host, cards }) => this.run(recordId, host, cards)),
    ),
    { initialValue: { status: 'starting' } as PanelState },
  );

  protected retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private run(
    recordId: string | null,
    host: string | null,
    cards: readonly string[] | null,
  ): Observable<PanelState> {
    this.token.clear();
    if (!isDocumentId(recordId) || host === null || !HOST_ID.test(host)) {
      return of({ status: 'refused', reason: 'attributes' });
    }
    return this.messages.hostOrigins(host).pipe(
      switchMap((origins): Observable<PanelState> => {
        const page = this.messages.pageOrigin();
        if (origins === null || page === null || !origins.has(page)) {
          return of({ status: 'refused', reason: 'origin' });
        }
        return concat(
          of<PanelState>({ status: 'signing-in' }),
          this.messages.tokens(host, recordId, origins).pipe(
            switchMap((token) => {
              this.token.set(token);
              return this.attempts.pipe(
                switchMap(() =>
                  concat(
                    of<PanelState>({ status: 'loading' }),
                    this.load(recordId, cards, () =>
                      this.messages.expired(host, recordId, origins),
                    ),
                  ),
                ),
              );
            }),
          ),
        );
      }),
    );
  }

  private load(
    recordId: string,
    cards: readonly string[] | null,
    expired: () => void,
  ): Observable<PanelState> {
    return this.api
      .get<NuxeoDocument>(`/nuxeo/api/v1/id/${recordId}`, undefined, {
        properties: '*',
        'enrichers.document': 'permissions',
      })
      .pipe(
        switchMap((document) =>
          this.layouts
            .recordLayoutOf(document)
            .pipe(
              map((layout): PanelState =>
                layout
                  ? { status: 'ready', document, layout: panelLayout(layout, cards) }
                  : { status: 'no-layout' },
              ),
            ),
        ),
        catchError((error: unknown): Observable<PanelState> => {
          const status = (error as { status?: unknown } | null)?.status;
          if (status === 401) {
            // Expired, or no longer the host's: the page is asked for a fresh one.
            this.token.clear();
            expired();
            return of({ status: 'signing-in' });
          }
          if (status === 403) return of({ status: 'forbidden' });
          if (status === 404) return of({ status: 'not-found' });
          return of({ status: 'failed', error: nxsErrorStatus(error) });
        }),
      );
  }
}
