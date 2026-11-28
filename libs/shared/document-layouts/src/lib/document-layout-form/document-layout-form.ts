import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsMetadataEditorComponent,
  NxsSpinnerComponent,
  type NxsEditorSection,
  type NxsEditorValues,
  type NxsHeadingLevel,
} from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  type DocumentLayoutChange,
  type ExtensionDocumentLayoutDescriptor,
  type ExtensionRule,
} from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument, NuxeoTask } from '@nuxeo/satori-platform/nuxeo-client';
import { distinctUntilChanged, map, merge, of, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { formView, type FormView } from '../form-layout/form-view';
import type { ResolvedFormLayout } from '../form-layout/resolve-form-layout';
import { layoutLabelText, toEditorSections } from '../layout-label';
import { documentToCreate, layoutSlotEntry } from '../layout-slot';
import { DocumentSchemaRef, LayoutLabel, ResolvedLayout } from '../layout.model';
import { readDocumentSchemas } from '../resolve-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from '../record-page/record-clock';
import { showValue, viewText, type RecordValueContext } from '../record-page/record-field-view';
import {
  LinkedRecordLookup,
  LookupCollector,
  NO_LABELS,
  NO_RECORDS,
  labelLookups,
  namesOf,
  readLabels,
  recordIdsOf,
  recordLookups,
  sameLookups,
  type Lookups,
} from '../record-page/record-lookups';

/**
 * The modes that are forms: a document's edit and create forms, and a workflow task's form over
 * the record it is on (app-definition-v2.md, section 6).
 */
export type LayoutFormMode = 'edit' | 'create' | 'task';

interface FormTarget {
  readonly type: string;
  readonly mode: LayoutFormMode;
  readonly schemas: readonly DocumentSchemaRef[];
  /** A task form's task and record; `null` in the other modes. */
  readonly task: { readonly task: NuxeoTask; readonly document: NuxeoDocument } | null;
}

const sameTarget = (a: FormTarget | null, b: FormTarget | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.type === b.type &&
    a.mode === b.mode &&
    a.schemas.length === b.schemas.length &&
    a.schemas.every((schema, i) => schema.name === b.schemas[i]?.name) &&
    a.task?.task.id === b.task?.task.id &&
    a.task?.document.uid === b.task?.document.uid);

/** A task's variables as a form's values: each `<name>` is the field `var:<name>`. */
function variableValues(task: NuxeoTask | null): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(task?.variables ?? {}).map(([name, value]) => [`var:${name}`, value]),
  );
}

const NO_VALUES: NxsEditorValues = {};

/**
 * A value a create form's host fixes, as a related list's New gives the new record the open
 * record's id: shown read-only, as `text`, and never edited. The host sends it with the rest.
 */
export interface FixedFormValue {
  readonly value: unknown;
  /** What the form shows for it, already in the reader's words: the linked record's title. */
  readonly text: string;
}

const NO_FIXED: Readonly<Record<string, FixedFormValue>> = {};
const NO_ERRORS: Readonly<Record<string, string>> = {};
const NOTHING_REPORTED: DocumentLayoutChange = { properties: {}, valid: false };

/** A layout from a version 2 file, rather than version 1's or a generated one. */
const isVersion2 = (layout: ResolvedLayout | ResolvedFormLayout): layout is ResolvedFormLayout =>
  'version' in layout && layout.version === 2;

/** What the editor is given, compared whole, so that a value typed that changes nothing redraws nothing. */
const sameJson = <T>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The words a failed check says when the file gives it no label of its own. */
const CHECK_TEXT_KEYS: Readonly<Record<string, string>> = {
  'core.notBefore': 'document-layouts.form.check.not-before',
  'core.atMost': 'document-layouts.form.check.at-most',
};

/**
 * The edit or create form for a document type: the type's layout in that mode, in the metadata
 * editor, or the component a `documentEdit` / `documentCreate` entry puts in its place.
 *
 * The layout is the contributed `<Type>/<mode>.layout.json`, else one generated from the type's
 * schemas — and, for an edit, from the schemas the document's dynamic facets add. A layout that
 * cannot be resolved leaves the Dublin Core fields, so the form degrades rather than breaks.
 *
 * A file of version 2 draws only what it lists (layout-v2.md): its cards as the form's sections,
 * or its tabs, each widget as its field's input, fields required or read-only while a rule passes,
 * and checks across fields, each saying beside its field why it failed. Its rules see the values
 * being entered, so a field shown by another field's value appears as soon as it is chosen. None
 * of it is a security control: the server's permissions decide what anyone can change.
 *
 * The host owns Save: it calls `validate()`, then sends `changedProperties()` — what the user
 * changed, so a create leaves untouched fields to their server defaults — and hands Nuxeo's
 * validation messages back to `showServerErrors()`.
 *
 * In the `task` mode it is a workflow task's form, given the `task` and the `document` it is on: the
 * step's task form, `tasks/<workflow>.<step>.layout.json`, when one is served, and nothing at all
 * otherwise, so that the task panel shows its own. `taskFormDrawn()` says which, and
 * `taskVariables()` gives the step's variables to complete the task with.
 */
@Component({
  selector: 'lib-document-layout-form',
  standalone: true,
  imports: [
    ExtensionOutletComponent,
    NxsMetadataEditorComponent,
    NxsSpinnerComponent,
    TranslatePipe,
  ],
  // The records a read-only `document-link` field names, read for as long as the form is open.
  providers: [LinkedRecordLookup],
  templateUrl: './document-layout-form.html',
  styleUrl: './document-layout-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentLayoutFormComponent {
  readonly mode = input.required<LayoutFormMode>();
  /**
   * The document edited, or for a task form the record the task is on. Its type and facets choose
   * the layout, its properties fill the form.
   */
  readonly document = input<NuxeoDocument | null>(null);
  /** The task a task form is for. Ignored in the other modes. */
  readonly task = input<NuxeoTask | null>(null);
  /** The type created. Ignored for an edit, which reads the document's. */
  readonly type = input<string | null>(null);
  /** The folder a new document is created in. */
  readonly parentPath = input<string | null>(null);
  /**
   * A create form's values its host fixes, by `<prefix>:<name>`: each starts the form with its
   * value, and its field, wherever the layout shows it, is read-only with its `text`. The host
   * sends them; `changedProperties()` does not, since nothing was entered.
   */
  readonly fixed = input<Readonly<Record<string, FixedFormValue>>>(NO_FIXED);
  /** While saving, or in the layout designer's preview: every input is read-only. */
  readonly disabled = input(false);
  /**
   * A version 2 form resolved elsewhere, drawn in place of the type's served one: the layout
   * designer's preview of a file it edits (`DocumentLayoutService.previewFormLayout`). With one,
   * the served file is not read, and neither a contributed form nor a `documentEdit` or
   * `documentCreate` entry takes its place. It saves nothing: the host owns Save, as for any form.
   */
  readonly preview = input<ResolvedFormLayout | null>(null);
  /** The level of the section headings, one below the dialog or page title. */
  readonly headingLevel = input<NxsHeadingLevel>(3);

  /** The values may be saved, or not. Emitted when that changes. */
  readonly validChange = output<boolean>();

  private readonly layouts = inject(DocumentLayoutService);
  private readonly linkedRecords = inject(LinkedRecordLookup);
  private readonly extensions = inject(AppExtensionsService);
  private readonly components = inject(ExtensionComponentRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly today = inject(RECORD_PAGE_TODAY);
  private readonly timeZone = inject(RECORD_PAGE_TIME_ZONE);
  private readonly editor = viewChild(NxsMetadataEditorComponent);
  private readonly outlet = viewChild(ExtensionOutletComponent);

  /**
   * The type the form is for: the document's for an edit and a task form, the one asked for for a
   * create.
   */
  readonly formType = computed<string | null>(() =>
    this.mode() === 'create' ? this.type() : (this.document()?.type ?? null),
  );

  /**
   * The contributed form, if any. A create's rules read the type being created, in the folder it
   * is created in, so `app.rules.isType` answers for the new document rather than the folder.
   */
  readonly entry = computed<ExtensionDocumentLayoutDescriptor | null>(() => {
    const mode = this.mode();
    const type = this.formType();
    // A task form has no slot of its own: the task panel's component is replaced whole instead.
    // A preview draws the file it is given, never what would replace it.
    if (!type || mode === 'task' || this.preview() !== null) return null;
    const document = mode === 'edit' ? this.document() : documentToCreate(type, this.parentPath());
    return layoutSlotEntry(this.extensions, this.components, mode, {
      ...this.ruleContext.context(),
      document,
    });
  });

  /**
   * The contributed form is on screen. Not when its component failed to load: the layout takes
   * its place, as the packaged view does for `documentView`, rather than leaving a form nobody
   * can save. The outlet stays, so a later render can still retry the load.
   */
  protected readonly usesEntry = computed(
    () => this.entry() !== null && !(this.outlet()?.unresolved() ?? false),
  );

  /** The edited document by identity, so a reload of the same document is not a new target. */
  private readonly documentUid = computed(() => this.document()?.uid ?? null);

  /** What the contributed form last reported. Not saveable until it has said so. */
  private readonly reported = signal<DocumentLayoutChange>(NOTHING_REPORTED);
  protected readonly showErrors = signal(false);

  /** The host's values last, so `inputs` cannot change which document or type the form is for. */
  protected readonly entryInputs = computed<Readonly<Record<string, unknown>>>(() => {
    const own =
      this.mode() === 'edit'
        ? { document: this.document() }
        : { type: this.formType(), parentPath: this.parentPath() };
    return {
      ...this.entry()?.inputs,
      ...own,
      showErrors: this.showErrors(),
      onChange: this.onChange,
    };
  });

  private readonly target = computed<FormTarget | null>(
    () => {
      const type = this.formType();
      if (!type || this.usesEntry() || this.preview() !== null) return null;
      const mode = this.mode();
      const document = this.document();
      const schemas =
        mode !== 'create' && document && 'schemas' in document
          ? readDocumentSchemas(document.schemas)
          : [];
      const task = this.task();
      if (mode === 'task') {
        return task && document ? { type, mode, schemas, task: { task, document } } : null;
      }
      return { type, mode, schemas, task: null };
    },
    { equal: sameTarget },
  );

  private readonly resolved = toSignal(
    toObservable(this.target).pipe(
      distinctUntilChanged(),
      switchMap((target) =>
        target
          ? (target.task
              ? this.layouts.taskFormFor(target.task.task, target.task.document)
              : this.layouts.formLayoutFor(
                  target.type,
                  target.mode === 'task' ? 'edit' : target.mode,
                  target.schemas,
                )
            ).pipe(
              map(
                (
                  layout,
                ): { target: FormTarget; layout: ResolvedLayout | ResolvedFormLayout | null } => ({
                  target,
                  layout,
                }),
              ),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /**
   * `undefined` while resolving; `null` when the type could not be read. A preview's, as it is
   * given.
   */
  private readonly layout = computed<ResolvedLayout | ResolvedFormLayout | null | undefined>(() => {
    const preview = this.preview();
    if (preview !== null) return preview;
    const resolved = this.resolved();
    return resolved && resolved.target === this.target() ? resolved.layout : undefined;
  });

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  /** What the editor last said is being entered: what a version 2 file's rules and checks read. */
  private readonly entered = signal<NxsEditorValues>(NO_VALUES);

  /** The console has been told, once per form, what a version 2 file's rules or checks could not do. */
  private readonly told = new Set<string>();

  /**
   * The users, groups, vocabulary entries and linked records a version 2 form's read-only fields
   * name: those are shown by name or title, as on the record page. An editable field's input reads
   * its own.
   */
  private readonly lookups = computed<Lookups>(
    () => {
      const layout = this.layout();
      const collector = new LookupCollector();
      if (!layout || !isVersion2(layout)) return collector.lookups();
      const properties = this.values();
      const cards = layout.tabs ? layout.tabs.flatMap((tab) => tab.cards) : layout.cards;
      for (const field of cards.flatMap((card) => card.fields)) {
        // The record's own properties in a task form, and any field a rule can make read-only.
        const mayBeReadOnly =
          field.kind === 'property' &&
          (field.readOnlyWhen !== null ||
            (layout.kind === 'task' && !field.xpath.startsWith('var:')));
        if (mayBeReadOnly)
          collector.value(
            field.widget,
            field.parameters,
            field.definition,
            properties[field.xpath],
          );
      }
      return collector.lookups();
    },
    { equal: sameLookups },
  );

  /** Shown as the stored ids until the labels arrive, and as the id wherever one cannot be read. */
  private readonly labels = toSignal(
    toObservable(namesOf(this.lookups)).pipe(
      switchMap((lookups) => readLabels(this.layouts, lookups)),
    ),
    { initialValue: NO_LABELS },
  );

  /** A read-only `document-link` field's records: their titles, never the stored ids. */
  private readonly records = toSignal(
    toObservable(recordIdsOf(this.lookups)).pipe(
      switchMap((ids) => this.linkedRecords.records(ids)),
    ),
    { initialValue: NO_RECORDS },
  );

  /** A version 2 form for the values being entered; `null` for any other layout. */
  private readonly view = computed<FormView | null>(() => {
    this.translations();
    const layout = this.layout();
    if (!layout || !isVersion2(layout)) return null;
    const document = this.ruleDocument();
    const value = (xpath: string): unknown => document.properties[xpath];
    // The date rules read the page's clock, as the record page's do and as the form's dates do.
    const today = this.today();
    const ruleContext = {
      ...this.ruleContext.context(),
      document,
      today,
      timeZone: this.timeZone,
    };
    const passes = (rule: unknown): boolean =>
      rule === null || this.rules.evaluate(rule as ExtensionRule, ruleContext);
    const label = (entry: LayoutLabel): string | null => layoutLabelText(this.translate, entry);
    const flagText = (flag: boolean): string =>
      this.translate.instant(flag ? 'document-layouts.yes' : 'document-layouts.no');
    const widgets: RecordValueContext = {
      locale: this.locale,
      today,
      timeZone: this.timeZone,
      ...labelLookups(this.labels()),
      ...recordLookups(
        this.records(),
        this.translate.instant('document-layouts.record.unavailable'),
        (title, label) =>
          this.translate.instant('document-layouts.record.version', { title, label }),
      ),
      property: value,
      label,
      flagText,
      rule: passes,
    };
    return formView(layout, {
      value,
      rule: passes,
      label,
      valueText: (input, widget) => viewText(showValue(input, widget, widgets), flagText),
      checkText: (type, field, bound) =>
        this.translate.instant(CHECK_TEXT_KEYS[type] ?? 'document-layouts.form.check.failed', {
          label: field,
          bound,
        }),
      today: widgets.today,
      tell: (message) => this.tell(message),
    });
  });

  /**
   * The document a version 2 file's rules read: the one edited, or the one being created, with
   * the form's values and then the values being entered over its own. The form's values include
   * a task's variables, so a read-only `var:` field, which the editor does not give back, is still
   * read as the task holds it.
   */
  private readonly ruleDocument = computed<NuxeoDocument>(() => {
    const type = this.formType() ?? '';
    const base =
      this.mode() === 'create'
        ? documentToCreate(type, this.parentPath())
        : (this.document() ?? documentToCreate(type, null));
    return {
      ...base,
      properties: { ...base.properties, ...this.values(), ...this.entered() },
    };
  });

  protected readonly sections = computed(
    () => {
      this.translations();
      const view = this.view();
      const layout = this.layout();
      const sections = view
        ? view.sections
        : layout && !isVersion2(layout)
          ? toEditorSections(layout, (label) => layoutLabelText(this.translate, label))
          : [];
      return this.withFixed(sections);
    },
    { equal: sameJson },
  );

  /** The sections with each field the host fixes read-only, showing the host's text for it. */
  private withFixed(sections: readonly NxsEditorSection[]): readonly NxsEditorSection[] {
    const fixed = this.mode() === 'create' ? this.fixed() : NO_FIXED;
    if (Object.keys(fixed).length === 0) return sections;
    return sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const value = Object.hasOwn(fixed, field.xpath) ? fixed[field.xpath] : undefined;
        return value
          ? {
              ...field,
              definition: { ...field.definition, required: undefined },
              readOnly: true,
              readOnlyText: value.text,
            }
          : field;
      }),
    }));
  }

  protected readonly display = computed(() => {
    const layout = this.layout();
    if (!layout) return 'sections';
    return isVersion2(layout) ? (this.view()?.display ?? 'sections') : layout.display;
  });

  /** The failed checks of a version 2 file, by field. */
  protected readonly fieldErrors = computed(
    () => {
      const errors = this.view()?.errors ?? NO_ERRORS;
      const fixed = this.mode() === 'create' ? this.fixed() : NO_FIXED;
      // A fixed value is the host's, and nothing the person can correct.
      return Object.keys(fixed).some((xpath) => Object.hasOwn(errors, xpath))
        ? Object.fromEntries(
            Object.entries(errors).filter(([xpath]) => !Object.hasOwn(fixed, xpath)),
          )
        : errors;
    },
    { equal: sameJson },
  );

  /** A version 2 file draws only what it lists; any other layout comes after the Dublin Core fields. */
  protected readonly dublinCore = computed(() => {
    const layout = this.layout();
    return !layout || !isVersion2(layout);
  });

  /**
   * `contributed` or `generated`, or `version-2` for a version 2 file; `none` when the type could
   * not be read and only Dublin Core shows.
   */
  protected readonly layoutSource = computed(() => {
    const layout = this.layout();
    if (!layout) return 'none';
    return isVersion2(layout) ? 'version-2' : layout.source;
  });

  /**
   * A task's variables, as `var:<name>`, compared whole: the same task fetched again, after a
   * delegation say, holds the same variables, and the editor keeps what was typed.
   */
  private readonly taskValues = computed(() => variableValues(this.task()), { equal: sameJson });

  /** The document's properties; in a task form, the task's variables too, as `var:<name>`. */
  protected readonly values = computed<NxsEditorValues>(() => {
    const mode = this.mode();
    if (mode === 'create') {
      const fixed = Object.entries(this.fixed());
      return fixed.length === 0
        ? NO_VALUES
        : (Object.fromEntries(
            fixed.map(([xpath, { value }]) => [xpath, value]),
          ) as NxsEditorValues);
    }
    const properties = this.document()?.properties ?? NO_VALUES;
    return mode === 'task' ? { ...properties, ...this.taskValues() } : properties;
  });

  /** A task form is on screen: the task's step has one, served and drawn. */
  readonly taskFormDrawn = computed(() => {
    const layout = this.layout();
    return this.mode() === 'task' && !!layout && isVersion2(layout) && layout.kind === 'task';
  });

  /**
   * The editor shows: a form resolved, even to nothing, or in a task form one the step has. A task
   * with no task form shows nothing, and no spinner while that is found out, so the task panel's
   * own form is all that shows.
   */
  protected readonly showsEditor = computed(
    () => this.layout() !== undefined && (this.mode() !== 'task' || this.taskFormDrawn()),
  );
  protected readonly showsSpinner = computed(
    () => this.layout() === undefined && this.mode() !== 'task',
  );

  /**
   * The form is resolved: a contributed one, or the layout, even to nothing. In the `task` mode
   * that can be nothing drawn at all; `taskFormDrawn()` says whether a task form is on screen.
   */
  readonly ready = computed(() => this.usesEntry() || this.layout() !== undefined);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
    // Another document or type can resolve to the same entry object, so what the last one
    // reported is forgotten whenever the form's target changes, not only its entry.
    effect(() => {
      this.entry();
      this.mode();
      this.formType();
      this.parentPath();
      this.documentUid();
      untracked(() => {
        const wasValid = this.reported().valid;
        this.reported.set(NOTHING_REPORTED);
        this.showErrors.set(false);
        this.told.clear();
        if (wasValid) this.validChange.emit(false);
      });
    });
    // What was entered is forgotten when the editor starts over, which it does for a new `values`
    // object, and only then: a create form whose folder changes keeps what was typed, and its
    // rules must keep reading it. The editor gives its values again once it is built.
    effect(() => {
      this.values();
      untracked(() => this.entered.set(NO_VALUES));
    });
  }

  /** Shows every error and answers whether the values may be saved. */
  validate(): boolean {
    this.showErrors.set(true);
    if (this.usesEntry()) return this.reported().valid;
    return this.editor()?.validate() ?? false;
  }

  /**
   * A task form's variables to complete the task with, by their names: every variable the form
   * edits, as entered. Neither a read-only field nor a record property is one.
   */
  taskVariables(): Record<string, unknown> {
    if (!this.taskFormDrawn()) return {};
    const entered = this.editor()?.properties() ?? {};
    return Object.fromEntries(
      Object.entries(entered)
        .filter(([xpath]) => xpath.startsWith('var:'))
        .map(([xpath, value]) => [xpath.slice('var:'.length), value]),
    );
  }

  /**
   * What to send: the properties the user changed. For a create that leaves every untouched field
   * — an unticked checkbox included — to take its server default, rather than sending the empty
   * value the form starts with.
   */
  changedProperties(): Record<string, unknown> {
    if (this.usesEntry()) return { ...this.reported().properties };
    return this.editor()?.dirtyProperties() ?? {};
  }

  /**
   * Puts Nuxeo's messages on the fields they name. Answers those it could not place — all of
   * them for a contributed form, which shows its own — for the host to report another way.
   */
  showServerErrors(errors: Readonly<Record<string, string>>): string[] {
    const editor = this.usesEntry() ? undefined : this.editor();
    return editor ? editor.showServerErrors(errors) : Object.values(errors);
  }

  protected editorValidChange(valid: boolean): void {
    this.validChange.emit(valid);
  }

  protected editorValuesChange(values: NxsEditorValues): void {
    this.entered.set(values);
  }

  private tell(message: string): void {
    if (this.told.has(message)) return;
    this.told.add(message);
    console.warn(`[agentic-ui-layouts] ${message}`);
  }

  private readonly onChange = (change: DocumentLayoutChange): void => {
    const previous = this.reported().valid;
    this.reported.set({ properties: { ...change.properties }, valid: change.valid === true });
    if (previous !== this.reported().valid) this.validChange.emit(this.reported().valid);
  };
}
