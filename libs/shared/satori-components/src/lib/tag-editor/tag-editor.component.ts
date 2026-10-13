import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
  MatOption,
  type MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import {
  MatChipGrid,
  MatChipInput,
  MatChipRemove,
  MatChipRow,
  type MatChipInputEvent,
} from '@angular/material/chips';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TagService } from '@nuxeo-satori/platform/nuxeo-client';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  Subject,
  switchMap,
  type Observable,
} from 'rxjs';

import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsTagComponent } from '../tag/tag.component';
import { provideNxsToast, NxsToastService } from '../toast/toast.service';

type NxsTagChange = 'add' | 'remove';

interface NxsTagRequest {
  readonly change: NxsTagChange;
  readonly label: string;
}

/** What the server answered to one request: the document's tags afterwards, or why not. */
type NxsTagOutcome = NxsTagRequest & ({ readonly tags: string[] } | { readonly error: unknown });

/** One entry of the suggestion list: an existing tag, or the typed text as a new one. */
interface NxsTagOption {
  readonly label: string;
  readonly isNew: boolean;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

let nextId = 0;

/**
 * A document's tags, added and removed in place — Web UI's `nuxeo-tag-suggestion` with
 * `allow-new-tags`, as the document page uses it.
 *
 * It tags the document itself through `TagService`. As in Web UI:
 *
 * - Typing suggests existing tags through the `Tag.Suggestion` operation, and offers the typed text
 *   as a new tag when no tag matches it exactly. Enter adds what is highlighted.
 * - Each change is saved at once; there is no Save button. Nuxeo normalises a label, so the chip
 *   shows the label it stored, and a toast says what changed.
 * - `readOnly` shows the tags without the box or the remove buttons. Web UI's rule for it is
 *   `canTagDocument`: Write on the document itself, not a version or a proxy.
 *
 * Changes are sent one at a time, in order, so an answer can never overwrite a later one.
 * `tagsChange` hands the document's tags to the host after each saved change.
 */
@Component({
  selector: 'nxs-tag-editor',
  standalone: true,
  templateUrl: './tag-editor.component.html',
  styleUrl: './tag-editor.component.scss',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatChipGrid,
    MatChipInput,
    MatChipRemove,
    MatChipRow,
    MatFormField,
    MatIcon,
    MatOption,
    TranslatePipe,
    NxsSpinnerComponent,
    NxsTagComponent,
  ],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NxsTagEditorComponent {
  private readonly tagService = inject(TagService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);

  /** The document to tag. */
  readonly documentUid = input.required<string>();
  /** The document's tags as loaded — `nxtag:tags`' labels. */
  readonly tags = input<readonly string[]>([]);
  /** Shows the tags only, with no box and no remove buttons. */
  readonly readOnly = input(false);
  /** The document's tags after each saved change, as Nuxeo stored them. */
  readonly tagsChange = output<readonly string[]>();

  protected readonly id = `nxs-tag-editor-${nextId++}`;
  private readonly boxRef = viewChild<ElementRef<HTMLInputElement>>('box');
  private readonly trigger = viewChild(MatAutocompleteTrigger);

  /** The tags as last known: the input, then each answer from the server. */
  protected readonly saved = linkedSignal<
    { uid: string; tags: readonly string[] },
    readonly string[]
  >({
    source: () => ({ uid: this.documentUid(), tags: this.tags() }),
    computation: ({ tags }) => tags,
  });
  protected readonly adding = signal<readonly string[]>([]);
  protected readonly removing = signal<ReadonlySet<string>>(new Set());
  protected readonly term = signal('');
  private readonly suggestions = signal<readonly string[]>([]);

  /** The chips: the saved tags less those being removed. Tags being added show after them. */
  protected readonly shown = computed(() =>
    this.saved().filter((tag) => !this.removing().has(tag)),
  );
  protected readonly options = computed<readonly NxsTagOption[]>(() => {
    const term = this.term().trim().toLowerCase();
    if (!term) return [];
    const taken = [...this.saved(), ...this.adding()];
    const existing = this.suggestions()
      .filter((tag) => !taken.some((other) => same(other, tag)))
      .map((label) => ({ label, isNew: false }));
    const known = [...taken, ...this.suggestions()].some((tag) => same(tag, term));
    return known ? existing : [{ label: term, isNew: true }, ...existing];
  });

  private readonly requests = new Subject<NxsTagRequest>();
  private readonly terms = new Subject<string>();

  constructor() {
    toObservable(this.documentUid)
      .pipe(
        switchMap((uid) => {
          this.adding.set([]);
          this.removing.set(new Set());
          return this.requests.pipe(concatMap((request) => this.send(uid, request)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => this.settle(outcome));

    this.terms
      .pipe(
        map((term) => term.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) =>
          term
            ? this.tagService.suggestTags(term).pipe(catchError(() => of<string[]>([])))
            : of<string[]>([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((tags) => this.suggestions.set(tags));
  }

  protected typed(value: string): void {
    this.term.set(value);
    this.terms.next(value);
  }

  /** A suggestion picked with the mouse, or highlighted when Enter was pressed. */
  protected picked(event: MatAutocompleteSelectedEvent): void {
    const option = event.option.value as NxsTagOption;
    event.option.deselect();
    this.clearBox();
    this.add(option.label);
  }

  /** Enter in the box. Ignored while a suggestion is highlighted: picking it adds the tag. */
  protected entered(event: MatChipInputEvent): void {
    const trigger = this.trigger();
    if (trigger?.panelOpen && trigger.activeOption) return;
    const label = event.value.trim();
    this.clearBox();
    if (label) this.add(label.toLowerCase());
  }

  protected remove(tag: string): void {
    if (this.removing().has(tag)) return;
    this.removing.update((labels) => new Set([...labels, tag]));
    this.requests.next({ change: 'remove', label: tag });
  }

  private add(label: string): void {
    const taken = [...this.saved(), ...this.adding()];
    if (taken.some((tag) => same(tag, label))) return;
    this.adding.update((labels) => [...labels, label]);
    this.requests.next({ change: 'add', label });
  }

  private send(uid: string, request: NxsTagRequest): Observable<NxsTagOutcome> {
    const call =
      request.change === 'add'
        ? this.tagService.addTag(uid, request.label)
        : this.tagService.removeTag(uid, request.label);
    return call.pipe(
      map((tags) => ({ ...request, tags })),
      catchError((error: unknown) => of({ ...request, error })),
    );
  }

  private settle(outcome: NxsTagOutcome): void {
    const { change, label } = outcome;
    if (change === 'add') {
      this.adding.update((labels) => labels.filter((tag) => tag !== label));
    } else {
      this.removing.update((labels) => new Set([...labels].filter((tag) => tag !== label)));
    }
    if ('error' in outcome) {
      this.toast.error(this.failure(change, outcome.error, label));
      return;
    }
    const before = this.saved();
    this.saved.set(outcome.tags);
    this.tagsChange.emit(outcome.tags);
    // The label Nuxeo stored, which is the one to announce: "Q3 Report" comes back as `q3report`.
    const stored =
      change === 'add'
        ? (outcome.tags.find((tag) => !before.includes(tag)) ?? label.replace(/\s+/g, ''))
        : label;
    const done = change === 'add' ? 'added' : 'removed';
    this.toast.show(
      this.translate.instant(`satori-components.tag-editor.${done}`, { tag: stored }),
    );
  }

  private failure(change: NxsTagChange, error: unknown, tag: string): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const key =
      status === 401 || status === 403
        ? `satori-components.tag-editor.error.forbidden`
        : `satori-components.tag-editor.error.${change}`;
    return this.translate.instant(key, { tag });
  }

  private clearBox(): void {
    const box = this.boxRef()?.nativeElement;
    if (box) box.value = '';
    this.typed('');
  }
}
