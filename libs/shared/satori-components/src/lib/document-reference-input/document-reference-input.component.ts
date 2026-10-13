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
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInput, MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map, type Observable } from 'rxjs';

import {
  NuxeoApiBase,
  escapeNxqlLiteral,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsDocTypeIconComponent } from '../doc-type-icon/doc-type-icon.component';
import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { nxsSearchAsYouType } from '../pickers/search-as-you-type';

/** A document, as the input offers and returns it. */
export interface NxsDocumentReference {
  readonly uid: string;
  readonly title: string;
  readonly type: string;
  readonly path: string;
}

/** Web UI's document suggestion: three characters, twenty results. */
const WEB_UI_MIN_CHARS = 3;
const WEB_UI_PAGE_SIZE = 20;

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

/**
 * A field that finds a document as the user types and returns a reference to the one chosen — for a
 * property that points at another document, as Web UI's `nuxeo-document-suggestion` is.
 *
 * It searches the repository's full text from three characters, twenty results at a time, leaving
 * out hidden documents, versions and the trash, as Web UI does; `documentTypes` narrows it further.
 * Each result shows its type icon, title and path. Typing after a choice clears it, and text typed
 * and not chosen is an `nxsChooseFromList` error on the form.
 */
@Component({
  selector: 'nxs-document-reference-input',
  standalone: true,
  templateUrl: './document-reference-input.component.html',
  styleUrl: './document-reference-input.component.scss',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
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
  /** Offer only documents of these types, such as `['File', 'Note']`. Every type when empty. */
  readonly documentTypes = input<readonly string[]>([]);
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The document chosen, or `null`. Two-way; a form control carries the same value. */
  readonly value = model<NxsDocumentReference | null>(null);

  protected readonly minChars = WEB_UI_MIN_CHARS;
  private readonly api = inject(NuxeoApiBase);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly input = viewChild.required(MatInput);
  private readonly control = new NxsPickerControl<NxsDocumentReference | null>();

  protected readonly text = signal('');
  protected readonly finder = nxsSearchAsYouType<NxsDocumentReference>(
    (term) => this.find(term),
    () => WEB_UI_MIN_CHARS,
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  protected readonly unmatched = computed(() => !this.value() && this.text().trim() !== '');
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.unmatched() || this.missing() || this.control.formInvalid()),
  };
  protected readonly displayWith = (document: NxsDocumentReference | string | null): string =>
    typeof document === 'string' ? document : (document?.title ?? '');

  constructor() {
    effect(() => {
      const chosen = this.value();
      untracked(() => {
        if (chosen) this.text.set(chosen.title);
      });
    });
    effect(() => {
      const { status, results } = this.finder.state();
      untracked(() => {
        const key =
          status === 'found'
            ? results.length === 1
              ? 'satori-components.pickers.results-one'
              : 'satori-components.pickers.results-many'
            : status === 'none'
              ? 'satori-components.pickers.no-results'
              : status === 'failed'
                ? 'satori-components.pickers.failed'
                : null;
        if (key) {
          void this.announcer.announce(
            this.translate.instant(key, { count: results.length }),
            'polite',
          );
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
    this.input().updateErrorState();
  }

  writeValue(value: NxsDocumentReference | null): void {
    this.value.set(value ?? null);
    this.text.set(value?.title ?? '');
  }

  registerOnChange(fn: (value: NxsDocumentReference | null) => void): void {
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
    return this.control.missing(this.required(), this.value() === null);
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    if (this.value() && typed !== this.value()?.title) this.choose(null);
    this.finder.query(typed);
  }

  protected choose(document: NxsDocumentReference | null): void {
    this.value.set(document);
    if (document) {
      this.text.set(document.title);
      this.finder.reset();
    }
    this.control.changed(document);
  }

  protected clear(): void {
    this.text.set('');
    this.finder.reset();
    this.choose(null);
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
