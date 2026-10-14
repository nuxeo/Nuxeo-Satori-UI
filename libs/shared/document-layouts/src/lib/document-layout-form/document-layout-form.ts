import {
  ChangeDetectionStrategy,
  Component,
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
  type NxsEditorValues,
  type NxsHeadingLevel,
} from '@nuxeo-satori/platform/components';
import {
  AppExtensionsService,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  type DocumentLayoutChange,
  type ExtensionDocumentLayoutDescriptor,
} from '@nuxeo-satori/platform/extensions';
import type { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { distinctUntilChanged, map, merge, of, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText, toEditorSections } from '../layout-label';
import { documentToCreate, layoutSlotEntry } from '../layout-slot';
import { DocumentSchemaRef, ResolvedLayout } from '../layout.model';
import { readDocumentSchemas } from '../resolve-layout';

/** The two modes that are forms. */
export type LayoutFormMode = 'edit' | 'create';

interface FormTarget {
  readonly type: string;
  readonly mode: LayoutFormMode;
  readonly schemas: readonly DocumentSchemaRef[];
}

const sameTarget = (a: FormTarget | null, b: FormTarget | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.type === b.type &&
    a.mode === b.mode &&
    a.schemas.length === b.schemas.length &&
    a.schemas.every((schema, i) => schema.name === b.schemas[i]?.name));

const NO_VALUES: NxsEditorValues = {};
const NOTHING_REPORTED: DocumentLayoutChange = { properties: {}, valid: false };

/**
 * The edit or create form for a document type: the type's layout in that mode, in the metadata
 * editor, or the component a `documentEdit` / `documentCreate` entry puts in its place.
 *
 * The layout is the contributed `<Type>/<mode>.layout.json`, else one generated from the type's
 * schemas — and, for an edit, from the schemas the document's dynamic facets add. A layout that
 * cannot be resolved leaves the Dublin Core fields, so the form degrades rather than breaks.
 *
 * The host owns Save: it calls `validate()`, then sends `changedProperties()` — what the user
 * changed, for an edit; everything, for a create — and hands Nuxeo's validation messages back to
 * `showServerErrors()`.
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
  templateUrl: './document-layout-form.html',
  styleUrl: './document-layout-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentLayoutFormComponent {
  readonly mode = input.required<LayoutFormMode>();
  /** The document edited. Its type and facets choose the layout, its properties fill the form. */
  readonly document = input<NuxeoDocument | null>(null);
  /** The type created. Ignored for an edit, which reads the document's. */
  readonly type = input<string | null>(null);
  /** The folder a new document is created in. */
  readonly parentPath = input<string | null>(null);
  /** While saving: the form is read-only. */
  readonly disabled = input(false);
  /** The level of the section headings, one below the dialog or page title. */
  readonly headingLevel = input<NxsHeadingLevel>(3);

  /** The values may be saved, or not. Emitted when that changes. */
  readonly validChange = output<boolean>();

  private readonly layouts = inject(DocumentLayoutService);
  private readonly extensions = inject(AppExtensionsService);
  private readonly components = inject(ExtensionComponentRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly translate = inject(TranslateService);
  private readonly editor = viewChild(NxsMetadataEditorComponent);
  private readonly outlet = viewChild(ExtensionOutletComponent);

  /** The type the form is for: the document's for an edit, the one asked for for a create. */
  readonly formType = computed<string | null>(() =>
    this.mode() === 'edit' ? (this.document()?.type ?? null) : this.type(),
  );

  /**
   * The contributed form, if any. A create's rules read the type being created, in the folder it
   * is created in, so `app.rules.isType` answers for the new document rather than the folder.
   */
  readonly entry = computed<ExtensionDocumentLayoutDescriptor | null>(() => {
    const mode = this.mode();
    const type = this.formType();
    if (!type) return null;
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
      if (!type || this.usesEntry()) return null;
      const mode = this.mode();
      const document = this.document();
      const schemas =
        mode === 'edit' && document && 'schemas' in document
          ? readDocumentSchemas(document.schemas)
          : [];
      return { type, mode, schemas };
    },
    { equal: sameTarget },
  );

  private readonly resolved = toSignal(
    toObservable(this.target).pipe(
      distinctUntilChanged(),
      switchMap((target) =>
        target
          ? this.layouts.layoutFor(target.type, target.mode, target.schemas).pipe(
              map((layout): { target: FormTarget; layout: ResolvedLayout | null } => ({
                target,
                layout,
              })),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** `undefined` while resolving; `null` when the type could not be read. */
  private readonly layout = computed<ResolvedLayout | null | undefined>(() => {
    const resolved = this.resolved();
    return resolved && resolved.target === this.target() ? resolved.layout : undefined;
  });

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  protected readonly sections = computed(() => {
    this.translations();
    const layout = this.layout();
    return layout
      ? toEditorSections(layout, (label) => layoutLabelText(this.translate, label))
      : [];
  });

  protected readonly display = computed(() => this.layout()?.display ?? 'sections');

  /** `contributed` or `generated`; `none` when the type could not be read and only Dublin Core shows. */
  protected readonly layoutSource = computed(() => this.layout()?.source ?? 'none');

  protected readonly values = computed<NxsEditorValues>(() =>
    this.mode() === 'edit' ? (this.document()?.properties ?? NO_VALUES) : NO_VALUES,
  );

  /** The form is on screen: a contributed one, or the layout resolved — even to nothing. */
  readonly ready = computed(() => this.usesEntry() || this.layout() !== undefined);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
    effect(() => {
      this.entry();
      untracked(() => {
        this.reported.set(NOTHING_REPORTED);
        this.showErrors.set(false);
      });
    });
  }

  /** Shows every error and answers whether the values may be saved. */
  validate(): boolean {
    this.showErrors.set(true);
    if (this.usesEntry()) return this.reported().valid;
    return this.editor()?.validate() ?? false;
  }

  /** What to send: the changed properties for an edit, every property for a create. */
  changedProperties(): Record<string, unknown> {
    if (this.usesEntry()) return { ...this.reported().properties };
    const editor = this.editor();
    if (!editor) return {};
    return this.mode() === 'edit' ? editor.dirtyProperties() : editor.properties();
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

  private readonly onChange = (change: DocumentLayoutChange): void => {
    const previous = this.reported().valid;
    this.reported.set({ properties: { ...change.properties }, valid: change.valid === true });
    if (previous !== this.reported().valid) this.validChange.emit(this.reported().valid);
  };
}
