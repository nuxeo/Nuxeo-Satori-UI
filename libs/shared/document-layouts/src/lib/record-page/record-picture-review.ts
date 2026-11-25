import { LiveAnnouncer } from '@angular/cdk/a11y';
import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsErrorStateComponent,
  NxsSpinnerComponent,
  nxsErrorStatus,
  type NxsErrorStatus,
  type NxsHeadingLevel,
} from '@nuxeo/satori-platform/components';
import {
  DocumentDetailService,
  type NuxeoAnnotation,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, catchError, map, of, startWith, switchMap, type Observable } from 'rxjs';

import {
  MAX_NOTE_LENGTH,
  REVIEW_ORIGIN,
  REVIEW_XPATH,
  percent,
  pinPayload,
  readPictureReview,
  reviewOffers,
  roundClosedPayload,
  toFraction,
  type PictureReview,
  type ReviewPin,
  type ReviewRound,
} from './picture-review';
import { RECORD_PAGE_TIME_ZONE } from './record-clock';
import { RecordPictureViewsComponent } from './record-picture-views';

type Loaded =
  | { readonly uid: string; readonly status: 'loading' }
  | { readonly uid: string; readonly status: 'failed'; readonly error: NxsErrorStatus }
  | {
      readonly uid: string;
      readonly status: 'loaded';
      readonly annotations: readonly NuxeoAnnotation[];
    };

/** A round as the list shows it: its pins, and what its heading says. */
interface RoundShown {
  readonly round: ReviewRound;
  readonly open: boolean;
  readonly pins: readonly ReviewPin[];
}

/** A pin being placed: where, as fractions of the view, from a click or the form. */
interface Draft {
  readonly x: number;
  readonly y: number;
}

let nextId = 0;

/**
 * A picture's review on its record page (layout-v2.md, section 2, "Review"): the picture's views,
 * with a pin at each point a reviewer chose, and the pins listed beside it with their notes,
 * round by round. Choosing a pin, on the picture or in the list, highlights it in both.
 *
 * - **Stored as Nuxeo's annotations,** through `DocumentDetailService`: see `picture-review.ts`
 *   for the form, and why on `picture:views`. Each pin is also a comment on the record, so the
 *   Comments panel beside the page lists its note. This component edits and deletes nothing.
 * - **A pin is placed** by clicking the picture, or with "Add a pin" and the form's two fields,
 *   across and down in percent, which a keyboard alone fills: the pin being placed shows on the
 *   picture as they change. The note is required.
 * - **Rounds.** A pin goes into the round open now. Closing it opens the next; the pins of a
 *   closed round stay, marked as past, on the picture and in the list.
 * - **By keyboard,** the pins on the picture are one stop: the arrow keys move between them, in
 *   the order they were placed, and choose the one reached. Each one's name says its number, its
 *   round, its place and its note.
 * - **What it offers is not a control** (`reviewOffers`): the server decides what it accepts, and
 *   Nuxeo 2025 accepts an annotation from anyone who may read the record.
 */
@Component({
  selector: 'lib-record-picture-review',
  standalone: true,
  imports: [
    MatButton,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    NxsErrorStateComponent,
    NxsSpinnerComponent,
    RecordPictureViewsComponent,
    TranslatePipe,
  ],
  templateUrl: './record-picture-review.html',
  styleUrl: './record-picture-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordPictureReviewComponent {
  readonly document = input.required<NuxeoDocument>();
  /** Shows the pins without a way to add one or close a round, as the designer's preview does. */
  readonly readOnly = input(false);
  /** The heading level of the picture's empty and error states, as `lib-record-picture-views` takes it. */
  readonly stateHeadingLevel = input<NxsHeadingLevel>(3);

  private readonly documents = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly locale = inject(LOCALE_ID);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly id = `record-review-${nextId++}`;
  protected readonly maxNote = MAX_NOTE_LENGTH;

  /** The record whose review is read: its id, so that a record reloaded after an edit reads nothing again. */
  private readonly uid = computed(() => this.document().uid);
  private readonly reloads = new Subject<void>();
  private readonly loaded = signal<Loaded | null>(null);

  /** What the signed-in user is offered, from the record's permissions: see `reviewOffers`. */
  protected readonly offers = computed(() => reviewOffers(this.document(), this.readOnly()));

  /** The state of the record shown now; another record's, still answering, is never shown. */
  protected readonly state = computed<Loaded>(() => {
    const loaded = this.loaded();
    return loaded && loaded.uid === this.uid() ? loaded : { uid: this.uid(), status: 'loading' };
  });

  protected readonly review = computed<PictureReview | null>(() => {
    const state = this.state();
    return state.status === 'loaded' ? readPictureReview(state.annotations) : null;
  });

  protected readonly pins = computed(() => this.review()?.pins ?? []);
  protected readonly round = computed(() => this.review()?.round ?? 1);

  /** The rounds, the open one first, each with its pins. */
  protected readonly rounds = computed<readonly RoundShown[]>(() => {
    const review = this.review();
    if (!review) return [];
    return [...review.rounds].reverse().map((round) => ({
      round,
      open: round.number === review.round,
      pins: review.pins.filter((pin) => pin.round === round.number),
    }));
  });

  /** Close round is offered once the open round has a pin. */
  protected readonly closable = computed(
    () => this.offers().close && this.pins().some((pin) => pin.round === this.round()),
  );

  private readonly chosenId = signal<string | null>(null);
  /** The pin chosen, on the picture or in the list; `null` for none, or one no longer there. */
  protected readonly chosen = computed(
    () => this.pins().find((pin) => pin.id === this.chosenId()) ?? null,
  );
  /** The pin on the picture that Tab reaches: the chosen one, else the first. */
  protected readonly reachable = computed(() => this.chosen() ?? this.pins().at(0) ?? null);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  /** Why the last write was refused or failed, said where it was asked; `null` once it is not. */
  protected readonly writeError = signal<string | null>(null);

  protected readonly placeable = computed(
    () => this.draft() !== null && this.note().trim() !== '' && !this.saving(),
  );

  constructor() {
    toObservable(this.uid)
      .pipe(
        switchMap((uid) => {
          this.reset();
          return this.reloads.pipe(
            startWith(undefined),
            switchMap(() => this.fetch(uid)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => this.loaded.set(loaded));
  }

  retry(): void {
    this.reloads.next();
  }

  /** A pin's place, as the page says it: `42% across, 31% down`. */
  protected position(pin: { readonly x: number; readonly y: number }): string {
    return this.translate.instant('document-layouts.review.position', {
      across: percent(pin.x),
      down: percent(pin.y),
    });
  }

  /** A pin's name on the picture: its number, round, place and note. */
  protected pinName(pin: ReviewPin): string {
    const past = pin.round < this.round();
    return this.translate.instant(
      past ? 'document-layouts.review.pin-name-past' : 'document-layouts.review.pin-name',
      {
        number: pin.number,
        round: pin.round,
        across: percent(pin.x),
        down: percent(pin.y),
        note: pin.note,
      },
    );
  }

  protected when(date: string | null): string {
    const parsed = date ? new Date(date) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? formatDate(parsed, 'medium', this.locale, this.timeZone)
      : '';
  }

  protected choose(pin: ReviewPin): void {
    this.chosenId.set(pin.id);
  }

  /** The arrow keys, Home and End move among the pins on the picture, choosing the one reached. */
  protected movePin(event: KeyboardEvent, pin: ReviewPin): void {
    const pins = this.pins();
    const at = pins.findIndex((each) => each.id === pin.id);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? pins[at + 1]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? pins[at - 1]
          : event.key === 'Home'
            ? pins[0]
            : event.key === 'End'
              ? pins[pins.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    this.chosenId.set(next.id);
    this.focus(`${this.id}-pin-${next.id}`);
  }

  /**
   * A click on the picture starts a pin there, when the user may place one. A click with no
   * pointer, as a script's or a key's, has no point: it starts one at the middle, as "Add a pin" does.
   */
  protected placeAt(event: MouseEvent): void {
    if (!this.offers().pin || this.saving() || this.state().status !== 'loaded') return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.detail === 0 || box.width <= 0 || box.height <= 0) {
      this.startPin();
      return;
    }
    this.draft.set({
      x: toFraction((event.clientX - box.left) / box.width),
      y: toFraction((event.clientY - box.top) / box.height),
    });
    this.writeError.set(null);
    this.focus(`${this.id}-note`);
  }

  /** "Add a pin": one at the middle of the picture, to move with the form's fields. */
  protected startPin(): void {
    this.draft.set({ x: 0.5, y: 0.5 });
    this.writeError.set(null);
    this.focus(`${this.id}-across`);
  }

  /** The form's across or down field, in percent, moves the pin being placed. */
  protected moveDraft(axis: 'x' | 'y', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const draft = this.draft();
    if (!draft || (event.target as HTMLInputElement).value.trim() === '' || !Number.isFinite(value))
      return;
    this.draft.set({ ...draft, [axis]: toFraction(value / 100) });
  }

  protected setNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  protected cancelDraft(): void {
    this.draft.set(null);
    this.note.set('');
    this.writeError.set(null);
    this.focus(`${this.id}-add`);
  }

  protected placePin(): void {
    const draft = this.draft();
    const text = this.note().trim();
    if (!draft || text === '' || this.saving()) return;
    const uid = this.uid();
    const round = this.round();
    this.write(
      this.documents.createAnnotation(uid, {
        xpath: REVIEW_XPATH,
        text,
        origin: REVIEW_ORIGIN,
        entity: pinPayload(round, draft.x, draft.y),
      }),
      uid,
      'pin',
      (created) => {
        this.draft.set(null);
        this.note.set('');
        this.chosenId.set(created.id);
        const pin = this.pins().find((each) => each.id === created.id);
        if (pin) {
          this.announcer.announce(
            this.translate.instant('document-layouts.review.placed', { number: pin.number }),
          );
        }
        this.focus(`${this.id}-add`);
      },
    );
  }

  protected closeRound(): void {
    if (this.saving()) return;
    const uid = this.uid();
    const round = this.round();
    this.write(
      this.documents.createAnnotation(uid, {
        xpath: REVIEW_XPATH,
        text: this.translate.instant('document-layouts.review.round-closed-text', { round }),
        origin: REVIEW_ORIGIN,
        entity: roundClosedPayload(round),
      }),
      uid,
      'close',
      () => {
        this.announcer.announce(
          this.translate.instant('document-layouts.review.closed', {
            round,
            next: this.round(),
          }),
        );
        this.focus(`${this.id}-heading`);
      },
    );
  }

  /**
   * One write, its answer added to what the review was read from, so that the review shows it at
   * once, read as any other annotation is. Dropped when the record changed while it was answered.
   */
  private write(
    request: Observable<NuxeoAnnotation>,
    uid: string,
    what: 'pin' | 'close',
    done: (created: NuxeoAnnotation) => void,
  ): void {
    this.saving.set(true);
    this.writeError.set(null);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (created) => {
        this.saving.set(false);
        const state = this.loaded();
        if (this.uid() !== uid || state?.uid !== uid || state.status !== 'loaded') return;
        this.loaded.set({ ...state, annotations: [...state.annotations, created] });
        done(created);
      },
      error: (failure: unknown) => {
        this.saving.set(false);
        if (this.uid() !== uid) return;
        const status = failure instanceof HttpErrorResponse ? failure.status : 0;
        const refused = status === 401 || status === 403;
        this.writeError.set(
          this.translate.instant(
            `document-layouts.review.error.${what}${refused ? '-forbidden' : ''}`,
          ),
        );
      },
    });
  }

  private fetch(uid: string): Observable<Loaded> {
    return this.documents.getAnnotations(uid, REVIEW_XPATH).pipe(
      map((list): Loaded => {
        const annotations = Array.isArray(list?.entries) ? list.entries : [];
        const { unreadable } = readPictureReview(annotations);
        if (unreadable > 0) {
          console.warn(
            `[document-layouts] ${unreadable} review annotation(s) of ${uid} left out: neither a pin nor a round's close`,
          );
        }
        return { uid, status: 'loaded', annotations };
      }),
      catchError((error: unknown) =>
        of<Loaded>({ uid, status: 'failed', error: nxsErrorStatus(error) }),
      ),
      // Each fetch shows its loading state first, Retry's included.
      startWith<Loaded>({ uid, status: 'loading' }),
    );
  }

  private reset(): void {
    this.chosenId.set(null);
    this.draft.set(null);
    this.note.set('');
    this.writeError.set(null);
  }

  private focus(elementId: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`[id="${elementId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
