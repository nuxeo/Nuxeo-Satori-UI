import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import {
  ErrorStateMatcher,
  MatOptionModule,
  provideNativeDateAdapter,
} from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DirectoryEntry,
  DirectoryService,
  L10nDirectoryEntry,
  directoryPickerLabel,
  directoryUsesL10nLabel,
  filterDirectoryPickerEntries,
  formatHierarchicalL10nLabel,
  groupL10nChildrenByParent,
  l10nEntryLabel,
} from '@nuxeo/satori-platform/nuxeo-client';

import type { NxsHeadingLevel } from '../heading-level';
import { nxsPropertyText } from '../properties-panel/property-text';
import { NxsTab, NxsTabBodyDirective } from '../tabs/tab-body.directive';
import { NxsTabsComponent } from '../tabs/tabs.component';
import {
  FieldError,
  FieldKind,
  baseType,
  buildControl,
  fieldKind,
  firstError,
  newComplexItem,
  propertyValue,
} from './metadata-editor-form';
import {
  NxsEditorDisplay,
  NxsEditorField,
  NxsEditorFieldType,
  NxsEditorSection,
  NxsEditorValues,
} from './metadata-editor.model';

/** A field the editor renders, with its label still a key when the editor owns the field. */
interface EditorField extends NxsEditorField {
  readonly labelKey?: string;
}

type Vocabulary =
  | { readonly l10n: false; readonly entries: readonly DirectoryEntry[] }
  | { readonly l10n: true; readonly entries: readonly L10nDirectoryEntry[] };

/** Web UI's `nuxeo-dublincore-edit-layout`, the fields every editable document has. */
const DUBLIN_CORE: readonly EditorField[] = [
  {
    xpath: 'dc:title',
    label: '',
    labelKey: 'satori-components.metadata-editor.title',
    definition: { type: 'string', required: true },
  },
  {
    xpath: 'dc:description',
    label: '',
    labelKey: 'satori-components.metadata-editor.description',
    definition: { type: 'string' },
    multiline: true,
  },
  {
    xpath: 'dc:nature',
    label: '',
    labelKey: 'satori-components.metadata-editor.nature',
    definition: { type: 'string', directory: 'nature' },
  },
  {
    xpath: 'dc:subjects',
    label: '',
    labelKey: 'satori-components.metadata-editor.subjects',
    definition: { type: 'string[]', directory: 'l10nsubjects' },
  },
  {
    xpath: 'dc:coverage',
    label: '',
    labelKey: 'satori-components.metadata-editor.coverage',
    definition: { type: 'string', directory: 'l10ncoverage' },
  },
  {
    xpath: 'dc:expired',
    label: '',
    labelKey: 'satori-components.metadata-editor.expires',
    definition: { type: 'date' },
  },
];

const ERROR_KEYS: Readonly<Record<string, string>> = {
  required: 'satori-components.metadata-editor.error.required',
  date: 'satori-components.metadata-editor.error.date',
  number: 'satori-components.metadata-editor.error.number',
  integer: 'satori-components.metadata-editor.error.integer',
  pattern: 'satori-components.metadata-editor.error.pattern',
  item: 'satori-components.metadata-editor.error.item',
  minLength: 'satori-components.metadata-editor.error.min-length',
  maxLength: 'satori-components.metadata-editor.error.max-length',
  minimum: 'satori-components.metadata-editor.error.minimum',
  'minimum-exclusive': 'satori-components.metadata-editor.error.minimum-exclusive',
  maximum: 'satori-components.metadata-editor.error.maximum',
  'maximum-exclusive': 'satori-components.metadata-editor.error.maximum-exclusive',
  invalid: 'satori-components.metadata-editor.error.invalid',
};

const DUBLIN_CORE_XPATHS = new Set(DUBLIN_CORE.map((field) => field.xpath));

/** `billedAmount` → "Billed amount": a complex field's sub-fields carry no label of their own. */
function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function directoriesOf(definition: NxsEditorFieldType, into: Set<string>): void {
  if (definition.directory) into.add(definition.directory);
  for (const child of Object.values(definition.fields ?? {})) directoriesOf(child, into);
}

let nextId = 0;

/**
 * The form that edits a document's properties — Web UI's `nuxeo-document-edit` and
 * `nuxeo-document-create` layouts, schema-driven.
 *
 * It owns the Dublin Core fields every document has (title, description, nature, subjects,
 * coverage, expiry), then renders the `sections` it is given: one control per field, chosen from
 * the field's type, with the schema's constraints checked as the user types.
 *
 * The host owns the buttons. On Save it calls `validate()`, which shows every error, announces how
 * many fields need a correction and moves focus to the first; when that passes, it sends
 * `dirtyProperties()` for an edit or `properties()` for a create. Errors the server reports go
 * back through `showServerErrors()`.
 */
@Component({
  selector: 'nxs-metadata-editor',
  standalone: true,
  templateUrl: './metadata-editor.component.html',
  styleUrl: './metadata-editor.component.scss',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatOptionModule,
    MatSelectModule,
    NxsTabsComponent,
    NxsTabBodyDirective,
  ],
  providers: [provideNativeDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-metadata-editor' },
})
export class NxsMetadataEditorComponent {
  /** The type's fields beyond Dublin Core, from its layout. A field Dublin Core already has is skipped. */
  readonly sections = input<readonly NxsEditorSection[]>([]);
  /** Show `sections` one after another under headings, or as tabs. */
  readonly display = input<NxsEditorDisplay>('sections');
  /** The current property values. A new object resets the form and discards what was typed. */
  readonly values = input<NxsEditorValues>({});
  /** Show the Dublin Core fields. Off for a type that has no `dublincore` schema. */
  readonly dublinCore = input(true);
  /** While saving: every control is read-only. */
  readonly disabled = input(false);
  /** The level of the section headings, one below the dialog or page title. */
  readonly headingLevel = input<NxsHeadingLevel>(3);
  /** The tab strip's accessible name in tabs display. Empty uses the default. */
  readonly tabsLabel = input('');

  /** Every value passes its field's constraints, or not. Emitted when that changes. */
  readonly validChange = output<boolean>();

  private readonly directories = inject(DirectoryService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly id = `nxs-metadata-editor-${nextId++}`;
  protected readonly form = new FormGroup<Record<string, AbstractControl>>({});
  /** Bumped whenever controls are added or removed, so the template reads the new set. */
  protected readonly structure = signal(0);
  protected readonly submitted = signal(false);
  protected readonly invalidCount = signal(0);
  protected readonly selectedTab = signal(0);
  protected readonly panelSearch = signal('');
  private readonly vocabularies = signal<ReadonlyMap<string, Vocabulary>>(new Map());
  private readonly requested = new Set<string>();
  private builtFrom: NxsEditorValues | null = null;
  /** Never shown: stands in for a control of an unexpected shape so a binding never throws. */
  private readonly detached = new FormControl();
  private readonly detachedList = new FormArray<AbstractControl>([]);
  private valid = true;
  /**
   * The server's message per field, with the value it refused. Held as a validator rather than
   * set once with `setErrors`, because re-enabling the form after a save re-runs every validator
   * and would drop it; it lapses as soon as the value differs from the one refused.
   */
  private readonly serverMessages = new Map<string, { message: string; refused: string }>();
  /** Server messages arrived while the form was disabled: reveal them once it is enabled. */
  private revealOnEnable = false;

  protected readonly standardFields = computed<readonly EditorField[]>(() =>
    this.dublinCore() ? DUBLIN_CORE : [],
  );

  protected readonly typeSections = computed<readonly NxsEditorSection[]>(() => {
    const skip = this.dublinCore() ? DUBLIN_CORE_XPATHS : new Set<string>();
    return this.sections()
      .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => !skip.has(field.xpath)),
      }))
      .filter((section) => section.fields.length > 0);
  });

  protected readonly tabs = computed<readonly NxsTab[]>(() =>
    this.typeSections().map((section) => ({
      id: section.id,
      label: section.heading ?? section.id,
    })),
  );

  private readonly fields = computed<readonly EditorField[]>(() => [
    ...this.standardFields(),
    ...this.typeSections().flatMap((section) => section.fields),
  ]);

  protected readonly errorMatcher: ErrorStateMatcher = {
    isErrorState: (control) =>
      !!control && control.invalid && (control.touched || this.submitted()),
  };

  protected readonly l10nEntryLabel = l10nEntryLabel;
  protected readonly directoryPickerLabel = directoryPickerLabel;

  constructor() {
    effect(() => {
      const fields = this.fields();
      const values = this.values();
      untracked(() => this.build(fields, values));
    });
    effect(() => {
      const disabled = this.disabled();
      untracked(() => this.applyDisabled(disabled));
    });
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.statusChanged());
  }

  /**
   * Shows every error, announces how many fields need a correction and focuses the first.
   * Answers whether the form can be saved.
   */
  validate(): boolean {
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();
    this.submitted.set(true);
    this.invalidCount.set(this.countInvalid());
    if (this.form.valid) return true;
    this.revealFirstInvalid();
    return false;
  }

  /** The values the user changed, by xpath, as the document properties take them. */
  dirtyProperties(): Record<string, unknown> {
    return this.collect((control) => control.dirty);
  }

  /** Every value in the form, by xpath — what a new document is created with. */
  properties(): Record<string, unknown> {
    return this.collect(() => true);
  }

  /**
   * Puts the server's messages on the fields they name, by xpath, until the value changes.
   * Answers the messages for fields the form does not show, for the host to report another way.
   */
  showServerErrors(errors: Readonly<Record<string, string>>): string[] {
    const unplaced: string[] = [];
    for (const [xpath, message] of Object.entries(errors)) {
      const control = this.form.controls[xpath];
      if (!control) {
        unplaced.push(message);
        continue;
      }
      this.serverMessages.set(xpath, { message, refused: JSON.stringify(control.getRawValue()) });
      control.markAsTouched();
      control.updateValueAndValidity({ emitEvent: false });
    }
    this.submitted.set(true);
    this.form.updateValueAndValidity();
    this.invalidCount.set(this.countInvalid());
    if (this.form.disabled) this.revealOnEnable = true;
    else if (this.form.invalid) this.revealFirstInvalid();
    return unplaced;
  }

  protected kindOf(definition: NxsEditorFieldType, depth: number): FieldKind {
    return fieldKind(definition, depth);
  }

  protected controlFor(field: EditorField): AbstractControl | null {
    this.structure();
    return this.form.controls[field.xpath] ?? null;
  }

  protected asControl(control: AbstractControl): FormControl {
    return control instanceof FormControl ? control : this.detached;
  }

  protected asArray(control: AbstractControl): FormArray {
    return control instanceof FormArray ? control : this.detachedList;
  }

  /** A complex field's sub-fields, labelled from their names. */
  protected subFields(definition: NxsEditorFieldType): readonly EditorField[] {
    return Object.entries(definition.fields ?? {}).map(([name, child]) => ({
      xpath: name,
      label: humanize(name),
      definition: child,
    }));
  }

  protected subControl(group: AbstractControl, name: string): AbstractControl | null {
    return group instanceof FormGroup ? (group.controls[name] ?? null) : null;
  }

  protected showError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || this.submitted());
  }

  protected errorOf(control: AbstractControl): FieldError | null {
    return firstError(control);
  }

  /** The message for an error, naming the field so it reads on its own in the error summary's wake. */
  protected errorText(error: FieldError, label: string): string {
    if (error.key === 'server') {
      const message = error.params['message'];
      return typeof message === 'string' ? message : '';
    }
    const key = ERROR_KEYS[error.key] ?? ERROR_KEYS['invalid'];
    return this.translate.instant(key, { ...error.params, label });
  }

  protected search(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.panelSearch.set(event.target.value);
  }

  protected isRequired(definition: NxsEditorFieldType): boolean {
    return definition.required === true;
  }

  protected inputType(definition: NxsEditorFieldType): 'number' | 'text' {
    return fieldKind(definition) === 'number' ? 'number' : 'text';
  }

  protected step(definition: NxsEditorFieldType): string | null {
    return baseType(definition) === 'double'
      ? 'any'
      : fieldKind(definition) === 'number'
        ? '1'
        : null;
  }

  protected readOnlyText(control: AbstractControl): string {
    const value: unknown = control.value;
    const items = Array.isArray(value) ? value : [value];
    return items
      .map((item) => nxsPropertyText(item))
      .filter((text) => text !== '')
      .join(', ');
  }

  protected flatOptions(directory: string): readonly DirectoryEntry[] {
    const vocabulary = this.vocabularies().get(directory);
    if (!vocabulary || vocabulary.l10n) return [];
    return filterDirectoryPickerEntries([...vocabulary.entries], this.panelSearch());
  }

  protected groupedOptions(directory: string): ReturnType<typeof groupL10nChildrenByParent> {
    const vocabulary = this.vocabularies().get(directory);
    if (!vocabulary?.l10n) return [];
    return groupL10nChildrenByParent([...vocabulary.entries], this.panelSearch());
  }

  protected usesL10n(directory: string): boolean {
    return directoryUsesL10nLabel(directory);
  }

  /** A vocabulary value's label, `Parent/Child` for a hierarchical one. The stored ID until loaded. */
  protected vocabularyLabel(directory: string, id: unknown): string {
    if (typeof id !== 'string') return '';
    const vocabulary = this.vocabularies().get(directory);
    if (!vocabulary) return id;
    if (vocabulary.l10n) return formatHierarchicalL10nLabel(id, [...vocabulary.entries]);
    const entry = vocabulary.entries.find((candidate) => candidate.id === id);
    return entry ? directoryPickerLabel(entry) : id;
  }

  protected listValue(control: AbstractControl): readonly unknown[] {
    return Array.isArray(control.value) ? control.value : [];
  }

  /** Each vocabulary panel opens with an empty search. */
  protected panelToggled(): void {
    this.panelSearch.set('');
  }

  protected clearValue(control: AbstractControl, multiple: boolean): void {
    control.setValue(multiple ? [] : null);
    control.markAsDirty();
    control.markAsTouched();
  }

  protected removeItem(control: AbstractControl, index: number): void {
    control.setValue(this.listValue(control).filter((_, at) => at !== index));
    control.markAsDirty();
    control.markAsTouched();
  }

  protected addItem(
    control: AbstractControl,
    definition: NxsEditorFieldType,
    event: MatChipInputEvent,
  ): void {
    const text = event.value.trim();
    event.chipInput.clear();
    if (text === '') return;
    const item = fieldKind({ type: baseType(definition) }) === 'number' ? Number(text) : text;
    control.setValue([...this.listValue(control), item]);
    control.markAsDirty();
    control.markAsTouched();
  }

  protected addComplexItem(
    control: AbstractControl,
    definition: NxsEditorFieldType,
    depth: number,
  ): void {
    if (!(control instanceof FormArray)) return;
    control.push(newComplexItem(definition, depth));
    control.markAsDirty();
    this.structure.update((value) => value + 1);
  }

  protected removeComplexItem(control: AbstractControl, index: number): void {
    if (!(control instanceof FormArray)) return;
    control.removeAt(index);
    control.markAsDirty();
    control.markAsTouched();
    this.structure.update((value) => value + 1);
  }

  protected selectTab(index: number): void {
    this.selectedTab.set(index);
  }

  private build(fields: readonly EditorField[], values: NxsEditorValues): void {
    if (values !== this.builtFrom) {
      for (const xpath of Object.keys(this.form.controls))
        this.form.removeControl(xpath, { emitEvent: false });
      this.builtFrom = values;
      this.serverMessages.clear();
      this.submitted.set(false);
      this.invalidCount.set(0);
    }
    const wanted = new Set(fields.map((field) => field.xpath));
    for (const xpath of Object.keys(this.form.controls)) {
      if (wanted.has(xpath)) continue;
      this.form.removeControl(xpath, { emitEvent: false });
      this.serverMessages.delete(xpath);
    }
    const directories = new Set<string>();
    for (const field of fields) {
      directoriesOf(field.definition, directories);
      if (this.form.controls[field.xpath]) continue;
      const control = buildControl(field.definition, values[field.xpath]);
      control.addValidators(this.heldServerMessage(field.xpath));
      control.updateValueAndValidity({ emitEvent: false });
      this.form.addControl(field.xpath, control, { emitEvent: false });
    }
    this.applyDisabled(untracked(this.disabled));
    this.loadVocabularies(directories);
    this.structure.update((value) => value + 1);
    this.statusChanged();
  }

  private applyDisabled(disabled: boolean): void {
    if (disabled) {
      this.form.disable({ emitEvent: false });
      return;
    }
    this.form.enable({ emitEvent: false });
    for (const field of untracked(this.fields)) {
      const control = this.form.controls[field.xpath];
      if (control) this.lockReadOnly(field.definition, control, 0);
    }
    this.statusChanged();
    if (this.revealOnEnable) {
      this.revealOnEnable = false;
      if (this.form.invalid) this.revealFirstInvalid();
    }
  }

  private heldServerMessage(xpath: string): ValidatorFn {
    return (control) => {
      const held = this.serverMessages.get(xpath);
      return held && JSON.stringify(control.getRawValue()) === held.refused
        ? { server: held.message }
        : null;
    };
  }

  /** `enable()` reaches every control; a file or an unsupported shape stays read-only. */
  private lockReadOnly(
    definition: NxsEditorFieldType,
    control: AbstractControl,
    depth: number,
  ): void {
    const kind = fieldKind(definition, depth);
    if (kind === 'read-only') {
      control.disable({ emitEvent: false });
      return;
    }
    const children = definition.fields ?? {};
    const groups =
      kind === 'complex'
        ? [control]
        : kind === 'complex-list' && control instanceof FormArray
          ? control.controls
          : [];
    for (const group of groups) {
      if (!(group instanceof FormGroup)) continue;
      for (const [name, child] of Object.entries(children)) {
        const sub = group.controls[name];
        if (sub) this.lockReadOnly(child, sub, depth + 1);
      }
    }
  }

  private loadVocabularies(directories: ReadonlySet<string>): void {
    for (const directory of directories) {
      if (this.requested.has(directory)) continue;
      this.requested.add(directory);
      const store = (vocabulary: Vocabulary) =>
        this.vocabularies.update((current) => new Map(current).set(directory, vocabulary));
      if (directoryUsesL10nLabel(directory)) {
        this.directories
          .getAllL10nEntries(directory)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (entries) => store({ l10n: true, entries }),
            error: () => this.requested.delete(directory),
          });
      } else {
        this.directories
          .getEntries(directory)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (entries) => store({ l10n: false, entries }),
            error: () => this.requested.delete(directory),
          });
      }
    }
  }

  private collect(include: (control: AbstractControl) => boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of untracked(this.fields)) {
      const control = this.form.controls[field.xpath];
      if (!control || fieldKind(field.definition) === 'read-only' || !include(control)) continue;
      out[field.xpath] = propertyValue(field.definition, control, 0, field.multiline === true);
    }
    return out;
  }

  private statusChanged(): void {
    if (this.submitted()) this.invalidCount.set(this.countInvalid());
    const valid = this.form.valid || this.form.disabled;
    if (valid === this.valid) return;
    this.valid = valid;
    this.validChange.emit(valid);
  }

  private countInvalid(): number {
    const count = (control: AbstractControl): number => {
      if (control instanceof FormGroup || control instanceof FormArray) {
        const own = control.errors ? 1 : 0;
        return own + Object.values(control.controls).reduce((sum, child) => sum + count(child), 0);
      }
      return control.invalid ? 1 : 0;
    };
    return Object.values(this.form.controls).reduce((sum, control) => sum + count(control), 0);
  }

  /** Opens the tab holding the first invalid field, then focuses it once it has rendered. */
  private revealFirstInvalid(): void {
    const standardInvalid = untracked(this.standardFields).some(
      (field) => this.form.controls[field.xpath]?.invalid,
    );
    if (!standardInvalid && untracked(this.display) === 'tabs') {
      const index = untracked(this.typeSections).findIndex((section) =>
        section.fields.some((field) => this.form.controls[field.xpath]?.invalid),
      );
      if (index >= 0) this.selectedTab.set(index);
    }
    this.focusFirstInvalid(3);
  }

  /** A tab's content attaches a render after the tab is selected, so the field may not exist yet. */
  private focusFirstInvalid(attempts: number): void {
    afterNextRender(
      () => {
        const target = this.host.nativeElement.querySelector<HTMLElement>(
          '[data-nxs-invalid="true"]',
        );
        if (target) target.focus();
        else if (attempts > 1) this.focusFirstInvalid(attempts - 1);
      },
      { injector: this.injector },
    );
  }
}
