import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  type DoCheck,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipGrid, MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInput, MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, catchError, from, map, mergeMap, of, switchMap, type Observable } from 'rxjs';

import {
  NuxeoApiBase,
  escapeNxqlLiteral,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsDocTypeIconComponent } from '../doc-type-icon/doc-type-icon.component';
import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { nxsSearchAsYouType } from '../pickers/search-as-you-type';
import type { NxsPickerItem, NxsPickerOption } from '../pickers/suggestion-view';

/** A document the input offered: what it shows, and what `documentChange` reports. */
export interface NxsDocumentReference {
  readonly uid: string;
  readonly title: string;
  readonly type: string;
  readonly path: string;
}

/** Web UI's document suggestion: three characters, twenty results. */
const WEB_UI_MIN_CHARS = 3;
const WEB_UI_PAGE_SIZE = 20;
let nextId = 0;

/**
 * The query Web UI's `default_document_suggestion` page provider runs, for `term`: a full-text
 * prefix match on documents that are not hidden, not versions and not in the trash — optionally of
 * the given types. Every value is escaped, so a term or a type is text in the query, never NXQL.
 */
export function nxsDocumentSuggestionQuery(term: string, types: readonly string[] = []): string {
  let query =
    `SELECT * FROM Document WHERE ecm:fulltext LIKE '${escapeNxqlLiteral(term)}*'` +
    " AND ecm:mixinType != 'HiddenInNavigation' AND ecm:isVersion = 0 AND ecm:isTrashed = 0";
  const named = types.map((type) => type.trim()).filter(Boolean);
  if (named.length) {
    query += ` AND ecm:primaryType IN (${named.map((type) => `'${escapeNxqlLiteral(type)}'`).join(', ')})`;
  }
  return query;
}

/** The query that finds the one document a stored uid or path names. Escaped, as above. */
function lookupQuery(id: string, idProperty: 'uid' | 'path'): string {
  const field = idProperty === 'path' ? 'ecm:path' : 'ecm:uuid';
  return `SELECT * FROM Document WHERE ${field} = '${escapeNxqlLiteral(id)}'`;
}

/**
 * A field that finds a document as the user types and returns the uid of the one chosen — for a
 * property that points at another document, as Web UI's `nuxeo-document-suggestion` is: its value
 * is what the property stores, the uid, or the path with `idProperty="path"`.
 *
 * It searches the repository's full text from three characters, twenty results at a time, leaving
 * out hidden documents, versions and the trash, as Web UI does; `documentTypes` narrows it further.
 * Each result shows its type icon, title and path. A uid or path the form already holds is looked
 * up to show its title; one the user may not read, or that no longer exists, is kept and shown as it
 * is. Typing after a choice clears it, and text typed and not chosen is an `nxsChooseFromList` error
 * on the form. `documentChange` reports the whole document chosen, for a host that shows more.
 */
@Component({
  selector: 'nxs-document-reference-input',
  standalone: true,
  templateUrl: '../pickers/suggestion-picker.html',
  styleUrl: './document-reference-input.component.scss',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatInputModule,
    NxsDocTypeIconComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: nxsPickerProviders(() => NxsDocumentReferenceInputComponent),
  host: { class: 'nxs-document-reference-input' },
})
export class NxsDocumentReferenceInputComponent
  implements ControlValueAccessor, Validator, DoCheck
{
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
  /** Choose several documents, shown as removable chips. The value is then an ordered array. */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** Offer only documents of these types, such as `['File', 'Note']`. Every type when empty. */
  readonly documentTypes = input<readonly string[]>([]);
  /** What the value holds, as Web UI's `idProperty`: the document's uid (the default) or its path. */
  readonly idProperty = input<'uid' | 'path'>('uid');
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The uid (or path) chosen, or `null`; with `multiple`, the ordered ids chosen. Two-way. */
  readonly value = model<string | readonly string[] | null>(null);
  /** The document the user chose, or `null` when the choice was cleared. */
  readonly documentChange = output<NxsDocumentReference | null>();

  protected readonly minChars = WEB_UI_MIN_CHARS;
  private readonly api = inject(NuxeoApiBase);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  protected readonly inputId = `nxs-document-reference-input-${nextId++}`;
  private readonly input = viewChild(MatInput);
  private readonly grid = viewChild(MatChipGrid);
  private readonly control = new NxsPickerControl<string | readonly string[] | null>();
  private readonly lookups = new Subject<{ ids: readonly string[]; idProperty: 'uid' | 'path' }>();
  /** The value the field last set itself, so its own changes are not mistaken for a host's. */
  private committed: string | readonly string[] | null = null;
  private lookupProperty: 'uid' | 'path' = 'uid';

  /** The document the value names, once known: chosen here, or looked up from a stored uid. */
  protected readonly document = signal<NxsDocumentReference | null>(null);
  protected readonly references = signal<ReadonlyMap<string, NxsDocumentReference>>(new Map());
  protected readonly text = signal('');
  protected readonly finder = nxsSearchAsYouType<NxsDocumentReference>(
    (term) => this.find(term),
    () => WEB_UI_MIN_CHARS,
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  protected readonly chosen = computed<readonly string[]>(() => {
    const value = this.value();
    return typeof value === 'string' ? (value ? [value] : []) : (value ?? []);
  });
  protected readonly options = computed(() => {
    const taken = new Set(this.multiple() ? this.chosen() : []);
    return this.finder.state().results.filter((document) => !taken.has(this.idOf(document)));
  });
  protected readonly unmatched = computed(
    () => this.text().trim() !== '' && (this.multiple() || this.chosen().length === 0),
  );
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.unmatched() || this.missing() || this.control.formInvalid()),
  };
  protected readonly displayWith = (document: NxsDocumentReference | string | null): string =>
    typeof document === 'string' ? document : (document?.title ?? '');

  protected readonly pickerKind: 'principal' | 'document' = 'document';
  protected readonly minimumCharacters = () => this.minChars;
  protected readonly chosenItems = computed<readonly NxsPickerItem<string>[]>(() =>
    this.chosen().map((id) => ({ value: id, key: id, label: this.labelOf(id) })),
  );
  protected readonly optionItems = computed<readonly NxsPickerOption<NxsDocumentReference>[]>(() =>
    this.options().map((document) => ({
      value: document,
      key: document.uid,
      label: document.title,
      detail: document.path,
      documentType: document.type,
    })),
  );

  constructor() {
    this.lookups
      .pipe(
        switchMap(({ ids, idProperty }) =>
          from(ids).pipe(
            mergeMap(
              (id) =>
                this.api.nxqlSearch(lookupQuery(id, idProperty), 1).pipe(
                  map((list) => ({
                    id,
                    found: list.entries?.[0] ? toReference(list.entries[0]) : null,
                  })),
                  catchError(() => of({ id, found: null })),
                ),
              4,
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe(({ id, found }) => {
        if (!this.chosen().includes(id) || !found) return;
        this.references.update((references) => new Map(references).set(id, found));
        if (!this.multiple()) {
          this.document.set(found);
          this.text.set(found.title);
        }
      });
    // Every host value replaces the complete selection. Cancel lookups even for an empty value.
    effect(() => {
      const value = this.value();
      const idProperty = this.idProperty();
      this.multiple();
      untracked(() => {
        if (value === this.committed && idProperty === this.lookupProperty) return;
        this.committed = value;
        this.lookupProperty = idProperty;
        this.finder.reset();
        this.document.set(null);
        this.references.set(new Map());
        this.text.set(this.multiple() ? '' : (this.chosen()[0] ?? ''));
        this.lookups.next({ ids: this.chosen(), idProperty });
      });
    });
    effect(() => {
      const { status } = this.finder.state();
      const count = this.options().length;
      untracked(() => {
        const key =
          status === 'found' && count > 0
            ? count === 1
              ? 'satori-components.pickers.results-one'
              : 'satori-components.pickers.results-many'
            : status === 'none' || (status === 'found' && count === 0)
              ? 'satori-components.pickers.no-results'
              : status === 'failed'
                ? 'satori-components.pickers.failed'
                : null;
        if (key) {
          void this.announcer.announce(this.translate.instant(key, { count }), 'polite');
        }
      });
    });
    effect(() => {
      this.unmatched();
      untracked(() => this.control.revalidate());
    });
  }

  /** `MatInput` recomputes its error state only with a form control of its own. */
  ngDoCheck(): void {
    this.input()?.updateErrorState();
    this.grid()?.updateErrorState();
  }

  writeValue(value: string | readonly string[] | null): void {
    this.value.set(value || (this.multiple() ? [] : null));
    this.finder.reset();
    if (!this.chosen().length) {
      this.document.set(null);
      this.references.set(new Map());
      this.lookups.next({ ids: [], idProperty: this.idProperty() });
    }
    this.text.set(this.multiple() ? '' : this.labelOf(this.chosen()[0] ?? ''));
  }

  registerOnChange(fn: (value: string | readonly string[] | null) => void): void {
    this.control.registerOnChange(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.control.registerOnTouched(fn);
  }

  setDisabledState(disabled: boolean): void {
    this.control.setDisabledState(disabled);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    return this.control.validate(control, this.unmatched() ? { nxsChooseFromList: true } : null);
  }

  registerOnValidatorChange(fn: () => void): void {
    this.control.registerOnValidatorChange(fn);
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.chosen().length === 0);
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    const shown = this.document()?.title ?? this.chosen()[0];
    this.text.set(typed);
    if (!this.multiple() && this.chosen().length && typed !== shown) this.choose(null);
    this.finder.query(typed);
  }

  protected choose(document: NxsDocumentReference | null): void {
    if (this.isDisabled()) return;
    const id = document ? this.idOf(document) : null;
    if (document && id !== null)
      this.references.update((references) => new Map(references).set(id, document));
    if (this.multiple()) {
      if (!document || id === null || this.chosen().includes(id)) return;
      this.commit([...this.chosen(), id]);
      this.text.set('');
      this.finder.reset();
    } else {
      this.commit(id);
      this.document.set(document);
      if (document) {
        this.text.set(document.title);
        this.finder.reset();
      }
    }
    this.documentChange.emit(document);
  }

  protected labelOf(id: string): string {
    return this.references().get(id)?.title ?? id;
  }

  protected remove(id: string): void {
    if (this.isDisabled()) return;
    this.commit(this.chosen().filter((chosen) => chosen !== id));
    this.documentChange.emit(null);
  }

  protected clear(): void {
    this.text.set('');
    this.finder.reset();
    this.document.set(null);
    this.references.set(new Map());
    this.commit(this.multiple() ? [] : null);
    this.documentChange.emit(null);
  }

  private idOf(document: NxsDocumentReference): string {
    return this.idProperty() === 'path' ? document.path : document.uid;
  }

  private commit(value: string | readonly string[] | null): void {
    this.committed = value;
    this.value.set(value);
    this.control.changed(value);
    this.lookups.next({
      ids: this.chosen().filter((id) => !this.references().has(id)),
      idProperty: this.idProperty(),
    });
  }

  protected blurred(): void {
    this.control.blurred();
  }

  private find(term: string): Observable<readonly NxsDocumentReference[]> {
    return this.api
      .nxqlSearch(nxsDocumentSuggestionQuery(term, this.documentTypes()), WEB_UI_PAGE_SIZE)
      .pipe(map((list) => (list.entries ?? []).map(toReference)));
  }
}

function toReference(document: NuxeoDocument): NxsDocumentReference {
  return {
    uid: document.uid,
    title: document.title?.trim() || document.uid,
    type: document.type,
    path: document.path,
  };
}
