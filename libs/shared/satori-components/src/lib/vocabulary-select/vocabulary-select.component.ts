import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, catchError, map, of, switchMap, type Observable } from 'rxjs';

import {
  DirectoryService,
  directoryPickerLabel,
  directoryUsesL10nLabel,
  filterDirectoryPickerEntries,
  l10nEntryLabel,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';

let nextId = 0;

/** One entry the select offers: its id, what it shows, and the parent it is listed under. */
interface Entry {
  readonly id: string;
  readonly label: string;
}

interface EntryGroup {
  /** The parent's label; empty for a vocabulary with no hierarchy. */
  readonly label: string;
  readonly entries: readonly Entry[];
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'loaded';
      /** Every selectable entry, by id, with the label the field and its chips show. */
      readonly labels: ReadonlyMap<string, string>;
      readonly filter: (text: string) => readonly EntryGroup[];
    };

/**
 * A field that chooses one entry, or several, from a Nuxeo vocabulary — Nature, Subjects, Coverage
 * or any directory — as Web UI's `nuxeo-directory-suggestion` does.
 *
 * It lists the whole vocabulary on focus and narrows it as the user types. A hierarchical one —
 * `l10nsubjects`, `l10ncoverage` — is listed under its parents, and a chosen child is stored and
 * shown as Web UI stores it: `europe/France`, labelled `Europe/France`. A parent with no children,
 * such as `antarctica`, is chosen as itself. With `multiple` each choice is a chip, removed with its button or
 * Backspace. The value is the entry's id, or a list of ids; an id the vocabulary no longer has is
 * kept and shown as it is, so opening a document never drops a value. Text typed and not chosen is
 * an `nxsChooseFromList` error on the form.
 */
@Component({
  selector: 'nxs-vocabulary-select',
  standalone: true,
  templateUrl: './vocabulary-select.component.html',
  styleUrl: './vocabulary-select.component.scss',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: nxsPickerProviders(() => NxsVocabularySelectComponent),
  host: { class: 'nxs-vocabulary-select' },
})
export class NxsVocabularySelectComponent implements ControlValueAccessor, Validator, DoCheck {
  /** The directory to choose from, such as `nature` or `l10ncoverage`. */
  readonly directory = input.required<string>();
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
  /** Choose several entries; the value is then a list of ids. */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The id chosen, or `null`; with `multiple`, the ids chosen, in order. Two-way. */
  readonly value = model<string | readonly string[] | null>(null);

  /** The input's id, in either mode: the form field's label names the input through it. */
  protected readonly inputId = `nxs-vocabulary-select-${nextId++}`;
  private readonly directories = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly input = viewChild(MatInput);
  private readonly grid = viewChild(MatChipGrid);
  private readonly control = new NxsPickerControl<string | readonly string[] | null>();

  private readonly loads = new Subject<string>();
  /** The value the picker last set itself, so its own changes are not mistaken for a host's. */
  private committed: string | readonly string[] | null = null;
  protected readonly loaded = signal<Loaded>({ status: 'loading' });
  /** What the input shows: the chosen entry's label (single), or what the user is typing. */
  protected readonly text = signal('');
  /** The chosen ids, whichever mode. */
  protected readonly chosen = computed<readonly string[]>(() => {
    const value = this.value();
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value !== '' ? [value] : [];
  });
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  protected readonly groups = computed<readonly EntryGroup[]>(() => {
    const loaded = this.loaded();
    if (loaded.status !== 'loaded') return [];
    // In single mode the input shows the chosen label, which is not a filter.
    const typed = this.text();
    const query = !this.multiple() && typed === this.labelOf(this.chosen()[0] ?? '') ? '' : typed;
    const taken = new Set(this.multiple() ? this.chosen() : []);
    return loaded
      .filter(query)
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => !taken.has(entry.id)),
      }))
      .filter((group) => group.entries.length > 0);
  });
  /** Text typed and no entry chosen for it. */
  protected readonly unmatched = computed(() => {
    const typed = this.text().trim();
    if (!typed) return false;
    return this.multiple() || typed !== this.labelOf(this.chosen()[0] ?? '');
  });
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.unmatched() || this.missing() || this.control.formInvalid()),
  };

  constructor() {
    this.loads
      .pipe(
        switchMap((directory) => this.load(directory)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((loaded) => this.loaded.set(loaded));
    effect(() => {
      const directory = this.directory();
      untracked(() => this.reload(directory));
    });
    // The input shows the chosen entry's label: once the labels arrive, and when the value changes
    // from outside — never while the user is typing, which is what clears the value.
    effect(() => {
      const loaded = this.loaded();
      untracked(() => {
        const first = this.chosen()[0];
        if (!this.multiple() && loaded.status === 'loaded' && first)
          this.text.set(this.labelOf(first));
      });
    });
    effect(() => {
      const value = this.value();
      untracked(() => {
        if (value === this.committed) return;
        this.committed = value;
        if (!this.multiple()) this.text.set(typeof value === 'string' ? this.labelOf(value) : '');
      });
    });
    effect(() => {
      this.unmatched();
      untracked(() => this.control.revalidate());
    });
  }

  /** `MatInput` and `MatChipGrid` recompute their error state only with a form control of their own. */
  ngDoCheck(): void {
    this.input()?.updateErrorState();
    this.grid()?.updateErrorState();
  }

  writeValue(value: string | readonly string[] | null): void {
    this.value.set(
      this.multiple() ? (Array.isArray(value) ? value : value ? [value] : []) : (value ?? null),
    );
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

  /** The label the field and its chips show for an id: the entry's, or the id itself. */
  protected labelOf(id: string): string {
    const loaded = this.loaded();
    return (loaded.status === 'loaded' ? loaded.labels.get(id) : undefined) ?? id;
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.chosen().length === 0);
  }

  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    if (!this.multiple() && this.chosen().length && typed !== this.labelOf(this.chosen()[0])) {
      this.commit(null);
    }
  }

  protected opened(): void {
    if (this.loaded().status === 'failed') this.reload(this.directory());
  }

  protected choose(id: string): void {
    if (this.multiple()) {
      this.commit([...this.chosen(), id]);
      this.text.set('');
    } else {
      this.text.set(this.labelOf(id));
      this.commit(id);
    }
  }

  protected remove(id: string): void {
    this.commit(this.chosen().filter((chosen) => chosen !== id));
  }

  protected clear(): void {
    this.text.set('');
    this.commit(null);
  }

  protected blurred(): void {
    this.control.blurred();
  }

  private commit(value: string | readonly string[] | null): void {
    const next = this.multiple() ? (Array.isArray(value) ? value : []) : value;
    this.committed = next;
    this.value.set(next);
    this.control.changed(next);
  }

  private reload(directory: string): void {
    this.loaded.set({ status: 'loading' });
    this.loads.next(directory);
  }

  private load(directory: string): Observable<Loaded> {
    const loaded: Observable<Loaded> = directoryUsesL10nLabel(directory)
      ? this.directories.getAllL10nEntries(directory).pipe(map(hierarchical))
      : this.directories.getEntries(directory).pipe(
          map((entries): Loaded => {
            const labels = new Map(entries.map((entry) => [entry.id, directoryPickerLabel(entry)]));
            return {
              status: 'loaded',
              labels,
              filter: (text) => [
                {
                  label: '',
                  entries: filterDirectoryPickerEntries(entries, text).map((entry) => ({
                    id: entry.id,
                    label: labels.get(entry.id) ?? entry.id,
                  })),
                },
              ],
            };
          }),
        );
    return loaded.pipe(catchError(() => of<Loaded>({ status: 'failed' })));
  }
}

/**
 * An l10n vocabulary, as Web UI's directory suggestion offers it: each child under its parent, with
 * the value `<parent>/<id>` (`_idFunction` in `nuxeo-directory-suggestion`), and a parent that has no
 * children as an entry of its own. The entries' ids are bare (`France`, parent `europe`), so the
 * parent is what keeps two children of one name apart.
 */
function hierarchical(entries: L10nDirectoryEntry[]): Loaded {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const parentIds = new Set(entries.map((entry) => entry.properties.parent).filter(Boolean));
  const parentLabel = (id: string) => {
    const parent = byId.get(id);
    return parent ? l10nEntryLabel(parent) : id;
  };
  const valueOf = (entry: L10nDirectoryEntry) =>
    entry.properties.parent ? `${entry.properties.parent}/${entry.id}` : entry.id;
  const selectable = entries.filter((entry) => entry.properties.parent || !parentIds.has(entry.id));
  const labels = new Map(
    selectable.map((entry) => [
      valueOf(entry),
      entry.properties.parent
        ? `${parentLabel(entry.properties.parent)}/${l10nEntryLabel(entry)}`
        : l10nEntryLabel(entry),
    ]),
  );
  return {
    status: 'loaded',
    labels,
    filter: (text) => {
      const query = text.trim().toLowerCase();
      const matches = (entry: L10nDirectoryEntry) =>
        !query ||
        [
          l10nEntryLabel(entry),
          entry.id,
          entry.properties.parent ? parentLabel(entry.properties.parent) : '',
        ].some((candidate) => candidate.toLowerCase().includes(query));
      const groups = new Map<string, Entry[]>();
      const leaves: Entry[] = [];
      for (const entry of selectable.filter(matches)) {
        const option = { id: valueOf(entry), label: l10nEntryLabel(entry) };
        const parent = entry.properties.parent;
        if (!parent) leaves.push(option);
        else groups.set(parent, [...(groups.get(parent) ?? []), option]);
      }
      return [
        ...(leaves.length ? [{ label: '', entries: leaves }] : []),
        ...[...groups]
          .map(([parent, children]) => ({ label: parentLabel(parent), entries: children }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ];
    },
  };
}
