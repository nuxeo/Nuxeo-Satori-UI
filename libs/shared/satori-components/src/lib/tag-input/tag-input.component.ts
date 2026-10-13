import { LiveAnnouncer } from '@angular/cdk/a11y';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
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
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipGrid, MatChipsModule, type MatChipInputEvent } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TagService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { nxsSearchAsYouType } from '../pickers/search-as-you-type';

/** Web UI's tag suggestion searches from the first character. */
const WEB_UI_MIN_CHARS = 1;

/**
 * A field of tags: existing ones suggested as the user types, as Web UI's `nuxeo-tag-suggestion`
 * does, and a new one added with Enter, a comma or its "Add" entry. Each tag is a chip, removed
 * with its button or Backspace.
 *
 * A form control, not an editor of a document's tags: the value is the list of labels, and the host
 * saves it — through `TagService.addTag` and `removeTag`, for a document's tags. A label is trimmed,
 * and one the field already holds, whatever its case, is not added twice.
 */
@Component({
  selector: 'nxs-tag-input',
  standalone: true,
  templateUrl: './tag-input.component.html',
  styleUrl: './tag-input.component.scss',
  imports: [MatAutocompleteModule, MatChipsModule, MatIconModule, MatInputModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: nxsPickerProviders(() => NxsTagInputComponent),
  host: { class: 'nxs-tag-input' },
})
export class NxsTagInputComponent implements ControlValueAccessor, Validator, DoCheck {
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
  /** Let the user add a tag no document has yet. On by default, as in Web UI. */
  readonly allowNew = input(true, { transform: booleanAttribute });
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The tags, in the order they were added. Two-way; a form control carries the same value. */
  readonly value = model<readonly string[]>([]);

  protected readonly separators = [ENTER, COMMA] as const;
  private readonly tags = inject(TagService);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);
  private readonly grid = viewChild.required(MatChipGrid);
  private readonly trigger = viewChild.required(MatAutocompleteTrigger);
  protected readonly control = new NxsPickerControl<readonly string[]>();

  protected readonly text = signal('');
  protected readonly finder = nxsSearchAsYouType<string>(
    (term) => this.tags.suggestTags(term),
    () => WEB_UI_MIN_CHARS,
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  /** Suggestions the field does not hold yet. */
  protected readonly suggestions = computed(() =>
    this.finder.state().results.filter((tag) => !this.holds(tag)),
  );
  /** The typed text as a new tag, when it may be added and is not already there. */
  protected readonly addable = computed(() => {
    const typed = this.text().trim();
    if (!this.allowNew() || !typed || this.holds(typed)) return null;
    const known = this.finder.state().results.some((tag) => same(tag, typed));
    return known ? null : typed;
  });
  protected readonly errorState = {
    isErrorState: () => this.control.wasTouched() && (this.missing() || this.control.formInvalid()),
  };

  constructor() {
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
  }

  /** `MatChipGrid` recomputes its error state only with a form control of its own. */
  ngDoCheck(): void {
    this.grid().updateErrorState();
  }

  writeValue(value: readonly string[] | null): void {
    this.value.set(value ?? []);
  }

  registerOnChange(fn: (value: readonly string[]) => void): void {
    this.control.registerOnChange(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.control.registerOnTouched(fn);
  }

  setDisabledState(disabled: boolean): void {
    this.control.setDisabledState(disabled);
  }

  /** No errors of its own: a typed tag is added or discarded, never left half-chosen. */
  validate(control: AbstractControl): ValidationErrors | null {
    return this.control.validate(control, null);
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.value().length === 0);
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    this.finder.query(typed);
  }

  /** Enter or a comma: add what was typed, unless the user is on a suggestion, which wins. */
  protected tokenEnd(event: MatChipInputEvent): void {
    if (this.trigger().activeOption) return;
    const typed = event.value.trim();
    if (typed && this.allowNew()) this.add(typed);
    event.chipInput.clear();
  }

  protected add(tag: string): void {
    const label = tag.trim();
    if (label && !this.holds(label)) this.commit([...this.value(), label]);
    this.text.set('');
    this.finder.reset();
  }

  protected remove(tag: string): void {
    this.commit(this.value().filter((held) => held !== tag));
  }

  protected blurred(): void {
    this.control.blurred();
  }

  private holds(tag: string): boolean {
    return this.value().some((held) => same(held, tag));
  }

  private commit(value: readonly string[]): void {
    this.value.set(value);
    this.control.changed(value);
  }
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
