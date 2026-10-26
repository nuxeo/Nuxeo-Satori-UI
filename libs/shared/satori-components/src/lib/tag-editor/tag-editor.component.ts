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
import { TranslatePipe } from '@ngx-translate/core';
import { TagService } from '@nuxeo/satori-platform/nuxeo-client';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  of,
  Subject,
  switchMap,
} from 'rxjs';

import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsTagComponent } from '../tag/tag.component';
import { NxsTagWrites, type NxsTagAnswer, type NxsTagChange } from './tag-writes.service';

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
 * Changes are sent one at a time, in order, so an answer can never overwrite a later one. They are
 * held at the root, not by the editor, so closing the panel or moving to another document neither
 * cancels a change nor drops the ones queued behind it. `tagsChange` hands the document's tags to
 * the host after each saved change — or, for a change answered while no editor was open, when the
 * next editor for that document appears.
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NxsTagEditorComponent {
  private readonly tagService = inject(TagService);
  private readonly writes = inject(NxsTagWrites);

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
  /** This document's tags on their way in, from the changes still queued. */
  protected readonly adding = computed(() => this.queued('add'));
  /** This document's tags on their way out. */
  protected readonly removing = computed<ReadonlySet<string>>(
    () => new Set(this.queued('remove')),
  );
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

  private readonly terms = new Subject<string>();

  constructor() {
    this.writes.answers
      .pipe(
        filter((answer) => answer.write.uid === this.documentUid()),
        takeUntilDestroyed(),
      )
      .subscribe((answer) => this.hear(answer));

    // An answer may have come while no editor for this document was open to hear it.
    toObservable(this.documentUid)
      .pipe(takeUntilDestroyed())
      .subscribe((uid) => {
        const tags = this.writes.take(uid);
        if (tags) this.store(tags);
      });

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
    this.writes.write(this.documentUid(), 'remove', tag, this.saved());
  }

  private add(label: string): void {
    const taken = [...this.saved(), ...this.adding()];
    if (taken.some((tag) => same(tag, label))) return;
    this.writes.write(this.documentUid(), 'add', label, this.saved());
  }

  private queued(change: NxsTagChange): string[] {
    const uid = this.documentUid();
    return this.writes
      .pending()
      .filter((write) => write.uid === uid && write.change === change)
      .map((write) => write.label);
  }

  /** A failed change needs nothing here: its chip came back, or went, with the queue. */
  private hear(answer: NxsTagAnswer): void {
    if ('error' in answer) return;
    this.writes.take(answer.write.uid);
    this.store(answer.tags);
  }

  private store(tags: readonly string[]): void {
    this.saved.set(tags);
    this.tagsChange.emit(tags);
  }

  private clearBox(): void {
    const box = this.boxRef()?.nativeElement;
    if (box) box.value = '';
    this.typed('');
  }
}
