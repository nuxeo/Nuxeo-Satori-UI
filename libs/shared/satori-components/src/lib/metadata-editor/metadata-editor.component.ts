import { NxsVocabularySelectComponent } from '../vocabulary-select/vocabulary-select.component';
import { NxsVocabularyRequests } from '../vocabulary-select/vocabulary-requests';
import { NxsDateInputComponent } from '../date-input/date-input.component';
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
import { DateAdapter, ErrorStateMatcher, MatOptionModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideNxsDateAdapter } from '../date-input/locale-date';
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
  NxsEditorConstraints,
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

/** `base`, required when either is and bound by the constraints of both, `extra`'s winning. */
function mergeChecks(base: NxsEditorFieldType, extra: NxsEditorFieldType): NxsEditorFieldType {
  const required = base.required === true || extra.required === true;
  const constraints: NxsEditorConstraints | undefined =
    base.constraints || extra.constraints
      ? { ...base.constraints, ...extra.constraints }
      : undefined;
  return {
    ...base,
    ...(required ? { required: true } : {}),
    ...(constraints ? { constraints } : {}),
  };
}

/** A definition without its checks: what a control is built from, beyond what it validates. */
const structureOf = (definition: NxsEditorFieldType): string =>
  JSON.stringify({ ...definition, required: undefined, constraints: undefined });

/** `billedAmount` → "Billed amount": a complex field's sub-fields carry no label of their own. */
function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
    NxsDateInputComponent,
    NxsVocabularySelectComponent,
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatOptionModule,
    NxsTabsComponent,
    NxsTabBodyDirective,
  ],
  providers: [provideNxsDateAdapter(), NxsVocabularyRequests],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-metadata-editor' },
})
export class NxsMetadataEditorComponent {
  /**
   * The type's fields beyond Dublin Core, from its layout. A field Dublin Core already has is shown
   * once, as the Dublin Core field, which takes its `required` flag and constraints.
   */
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
  /**
   * Messages from the host's own checks, by xpath, already translated: a check that compares one
   * field with another, say. A field the form edits is invalid while it has one, and the form
   * cannot be saved until the host gives a set without it. A message for a field the form does not
   * edit, read-only or not listed, holds nothing up: there is nothing there to correct. The
   * schema's own checks still come first.
   */
  readonly fieldErrors = input<Readonly<Record<string, string>>>({});

  /** Every value passes its field's constraints, or not. Emitted when that changes. */
  readonly validChange = output<boolean>();
  /**
   * Every editable value in the form, by xpath, as `properties()` gives them: emitted when one
   * changes and when the set of fields does, for a host whose rules or checks read what is being
   * entered. Not emitted again for the same values.
   */
  readonly valuesChange = output<NxsEditorValues>();

  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The datepickers' adapter, from `provideNxsDateAdapter()`: date controls hold its dates. */
  private readonly dateAdapter = inject<DateAdapter<unknown>>(DateAdapter);

  protected readonly id = `nxs-metadata-editor-${nextId++}`;
  protected readonly form = new FormGroup<Record<string, AbstractControl>>({});
  /** Bumped whenever controls are added or removed, so the template reads the new set. */
  protected readonly structure = signal(0);
  protected readonly submitted = signal(false);
  protected readonly invalidCount = signal(0);
  protected readonly selectedTab = signal(0);
  private builtFrom: NxsEditorValues | null = null;
  /**
   * The definition each control was built from, its JSON, to tell when one has changed, and the
   * validator built from it — swapped alone, so a validator a control's input adds stays.
   */
  private readonly builtDefinitions = new Map<
    string,
    {
      readonly definition: NxsEditorFieldType;
      readonly shape: string;
      readonly checks: ValidatorFn | null;
      readonly readOnly: boolean;
    }
  >();
  /** The JSON of the values `valuesChange` last gave, so that the same values are not given twice. */
  private emittedValues: string | null = null;
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

  /**
   * Each xpath the sections list, as one definition: a field listed more than once is required
   * when any listing says so, and takes the constraints of all of them.
   */
  private readonly listedDefinitions = computed(() => {
    const merged = new Map<string, NxsEditorFieldType>();
    for (const field of this.sections().flatMap((section) => section.fields)) {
      const seen = merged.get(field.xpath);
      merged.set(field.xpath, seen ? mergeChecks(seen, field.definition) : field.definition);
    }
    return merged;
  });

  /**
   * Each xpath the sections list read-only, with the text the first listing that gives one shows:
   * a field listed more than once is one control, read-only when any listing says so.
   */
  private readonly listedReadOnly = computed(() => {
    const readOnly = new Map<string, Pick<NxsEditorField, 'readOnly' | 'readOnlyText'>>();
    for (const field of this.sections().flatMap((section) => section.fields)) {
      if (field.readOnly !== true) continue;
      const seen = readOnly.get(field.xpath);
      readOnly.set(field.xpath, {
        readOnly: true,
        readOnlyText: seen?.readOnlyText ?? field.readOnlyText,
      });
    }
    return readOnly;
  });

  /**
   * Dublin Core, each field taking the `required` flag, the constraints and the read-only flag of
   * the sections' listing of it — a layout file that lists `dc:nature` as required makes Nature
   * required.
   */
  protected readonly standardFields = computed<readonly EditorField[]>(() => {
    if (!this.dublinCore()) return [];
    const listed = this.listedDefinitions();
    const readOnly = this.listedReadOnly();
    return DUBLIN_CORE.map((field) => {
      const own = listed.get(field.xpath);
      const locked = readOnly.get(field.xpath);
      const checked =
        own?.required || own?.constraints
          ? { ...field, definition: mergeChecks(field.definition, own) }
          : field;
      return locked ? { ...checked, ...locked } : checked;
    });
  });

  /**
   * The sections, each field with its merged definition and read-only flag, so every listing
   * shows the same checks.
   */
  protected readonly typeSections = computed<readonly NxsEditorSection[]>(() => {
    const skip = this.dublinCore() ? DUBLIN_CORE_XPATHS : new Set<string>();
    const listed = this.listedDefinitions();
    const readOnly = this.listedReadOnly();
    return this.sections()
      .map((section) => ({
        ...section,
        fields: section.fields
          .filter((field) => !skip.has(field.xpath))
          .map((field) => ({
            ...field,
            definition: listed.get(field.xpath) ?? field.definition,
            ...readOnly.get(field.xpath),
          })),
      }))
      .filter((section) => section.fields.length > 0);
  });

  protected readonly tabs = computed<readonly NxsTab[]>(() =>
    this.typeSections().map((section) => ({
      id: section.id,
      label: section.heading ?? section.id,
    })),
  );

  /** One per xpath: a field listed in several sections is one control, shown in each. */
  private readonly fields = computed<readonly EditorField[]>(() => {
    const seen = new Set<string>();
    return [
      ...this.standardFields(),
      ...this.typeSections().flatMap((section) => section.fields),
    ].filter((field) => !seen.has(field.xpath) && !!seen.add(field.xpath));
  });

  protected readonly errorMatcher: ErrorStateMatcher = {
    isErrorState: (control) =>
      !!control && control.invalid && (control.touched || this.submitted()),
  };

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
    effect(() => {
      this.fieldErrors();
      untracked(() => this.revalidate());
    });
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.statusChanged());
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emitValues());
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
    // Every field read-only disables the whole form, which is then neither valid nor invalid:
    // there is nothing to correct. While saving, it is disabled too, and not yet saved.
    if (this.form.valid || (this.form.disabled && !untracked(this.disabled))) return true;
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
      // A read-only field shows no error, so its message would be lost on it.
      if (!control || this.isReadOnly(xpath)) {
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
    if (error.key === 'server' || error.key === 'check') {
      const message = error.params['message'];
      return typeof message === 'string' ? message : '';
    }
    const key = ERROR_KEYS[error.key] ?? ERROR_KEYS['invalid'];
    return this.translate.instant(key, { ...error.params, label });
  }

  protected isRequired(definition: NxsEditorFieldType): boolean {
    return definition.required === true;
  }

  /** What the field's control shows: `read-only` for a field listed read-only, whatever its type. */
  protected kindFor(field: EditorField, depth: number): FieldKind {
    return depth === 0 && field.readOnly === true
      ? 'read-only'
      : fieldKind(field.definition, depth);
  }

  /** An error the editor's own date and vocabulary controls do not show themselves. */
  protected passedOn(error: FieldError | null): boolean {
    return error?.key === 'server' || error?.key === 'check';
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

  protected listValue(control: AbstractControl): readonly unknown[] {
    return Array.isArray(control.value) ? control.value : [];
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
    control.push(newComplexItem(definition, this.dateAdapter, depth));
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

  /**
   * Adds a control per field and drops those of fields no longer shown. A kept field whose checks
   * changed — new sections that make it required, say — keeps its control and takes the new
   * checks, so what is typed, half-typed dates included, stays as it is. Only a field whose shape
   * changed is rebuilt, from what it holds.
   */
  private build(fields: readonly EditorField[], values: NxsEditorValues): void {
    if (values !== this.builtFrom) {
      for (const xpath of Object.keys(this.form.controls))
        this.form.removeControl(xpath, { emitEvent: false });
      this.builtFrom = values;
      this.builtDefinitions.clear();
      this.serverMessages.clear();
      this.submitted.set(false);
      this.invalidCount.set(0);
    }
    const wanted = new Set(fields.map((field) => field.xpath));
    for (const xpath of Object.keys(this.form.controls)) {
      if (wanted.has(xpath)) continue;
      this.form.removeControl(xpath, { emitEvent: false });
      this.builtDefinitions.delete(xpath);
      this.serverMessages.delete(xpath);
    }
    for (const field of fields) {
      const existing = this.form.controls[field.xpath];
      const built = this.builtDefinitions.get(field.xpath);
      const shape = JSON.stringify(field.definition);
      const readOnly = field.readOnly === true;
      // Turning read-only, or editable again, starts the field over from the document's value:
      // a read-only field shows what the document holds, and never sends what was typed before.
      const sameAccess = built?.readOnly === readOnly;
      if (existing && sameAccess && built?.shape === shape) continue;
      if (
        existing &&
        built &&
        sameAccess &&
        structureOf(built.definition) === structureOf(field.definition)
      ) {
        const checks = readOnly
          ? null
          : buildControl(field.definition, null, this.dateAdapter).validator;
        if (built.checks) existing.removeValidators(built.checks);
        if (checks) existing.addValidators(checks);
        existing.updateValueAndValidity({ emitEvent: false });
        this.builtDefinitions.set(field.xpath, {
          definition: field.definition,
          shape,
          checks,
          readOnly,
        });
        continue;
      }
      const value =
        existing && built && sameAccess
          ? propertyValue(built.definition, existing, this.dateAdapter, 0, field.multiline === true)
          : values[field.xpath];
      // A read-only field holds the value as the document does, for its text; nothing checks it.
      const control = readOnly
        ? new FormControl<unknown>({ value, disabled: true })
        : buildControl(field.definition, value, this.dateAdapter);
      const checks = control.validator;
      control.addValidators([this.heldServerMessage(field.xpath), this.heldCheck(field.xpath)]);
      if (sameAccess && existing?.dirty) control.markAsDirty();
      if (sameAccess && existing?.touched) control.markAsTouched();
      control.updateValueAndValidity({ emitEvent: false });
      if (existing) this.form.setControl(field.xpath, control, { emitEvent: false });
      else this.form.addControl(field.xpath, control, { emitEvent: false });
      this.builtDefinitions.set(field.xpath, {
        definition: field.definition,
        shape,
        checks,
        readOnly,
      });
    }
    this.applyDisabled(untracked(this.disabled));
    this.structure.update((value) => value + 1);
    this.statusChanged();
    this.emitValues();
  }

  /** Whether the field at `xpath` is shown rather than edited: listed read-only, or of a kind the editor cannot edit. */
  private isReadOnly(xpath: string): boolean {
    const field = untracked(this.fields).find((candidate) => candidate.xpath === xpath);
    return !!field && this.kindFor(field, 0) === 'read-only';
  }

  /** The host's message for the field, while it gives one. */
  private heldCheck(xpath: string): ValidatorFn {
    return () => {
      const message = untracked(this.fieldErrors)[xpath];
      return typeof message === 'string' && message !== '' ? { check: message } : null;
    };
  }

  /** The host's checks changed: every field is checked again, and the form's state follows. */
  private revalidate(): void {
    for (const control of Object.values(this.form.controls))
      control.updateValueAndValidity({ onlySelf: true, emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });
    this.statusChanged();
  }

  /** Gives the host the values, unless they are the ones it was last given. */
  private emitValues(): void {
    const values = this.properties();
    const json = JSON.stringify(values);
    if (json === this.emittedValues) return;
    this.emittedValues = json;
    this.valuesChange.emit(values);
  }

  private applyDisabled(disabled: boolean): void {
    if (disabled) {
      this.form.disable({ emitEvent: false });
      return;
    }
    this.form.enable({ emitEvent: false });
    for (const field of untracked(this.fields)) {
      const control = this.form.controls[field.xpath];
      if (!control) continue;
      if (field.readOnly === true) control.disable({ emitEvent: false });
      else this.lockReadOnly(field.definition, control, 0);
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

  private collect(include: (control: AbstractControl) => boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of untracked(this.fields)) {
      const control = this.form.controls[field.xpath];
      if (!control || this.kindFor(field, 0) === 'read-only' || !include(control)) continue;
      out[field.xpath] = propertyValue(
        field.definition,
        control,
        this.dateAdapter,
        0,
        field.multiline === true,
      );
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
        // A chip's remove button comes before the input in the DOM: the input holds the text to fix.
        if (target)
          (
            target.querySelector<HTMLElement>('input, textarea') ??
            target.querySelector<HTMLElement>('button') ??
            target
          ).focus();
        else if (attempts > 1) this.focusFirstInvalid(attempts - 1);
      },
      { injector: this.injector },
    );
  }
}
