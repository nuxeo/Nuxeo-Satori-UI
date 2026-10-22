import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, catchError, debounceTime, defer, map, of, switchMap } from 'rxjs';

import {
  formatAceDateRange,
  isPermissionDeniedError,
  permissionRightLabel,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import { nxsDateFromAdapter, nxsDateToAdapter } from '../date-input/adapter-date';
import { provideNxsDateAdapter } from '../date-input/locale-date';
import {
  dayToDate,
  instantToDay,
  offeredPermissions,
  toDay,
  type NxsAceRow,
  type NxsPermissionChange,
  type NxsPermissionRefusal,
  type NxsPermissionsSnapshot,
} from './permissions-model';
import { NxsPermissionsService, type NxsSaveOutcome } from './permissions-panel.service';

/** The ID the panel is registered under, so a customer library can re-register a replacement. */
export const NXS_PERMISSIONS_PANEL_ID = 'nxs.components.permissionsPanel';

type LoadError = 'denied' | 'not-found' | 'failed';

let nextId = 0;

/** One row of the local table: an ACE the server holds, or one the user is adding. */
interface LocalItem {
  readonly key: string;
  /** The server's entry, absent for a staged addition. */
  readonly row: NxsAceRow | null;
  readonly principal: string;
  /** The principal's display name, or empty when the server sent none. */
  readonly principalLabel: string;
  readonly permission: string;
  readonly begin: string | null;
  readonly end: string | null;
  readonly state: 'unchanged' | 'changed' | 'removed' | 'added';
  readonly granted: boolean;
  /** Why the entry cannot be edited here, as a catalogue key; `null` when it can. */
  readonly lockedReason: string | null;
  /** Permissions this entry holds that the server's lists do not offer, so its select can show them. */
  readonly extraPermissions: readonly string[];
}

interface EditorState {
  readonly mode: 'add' | 'edit';
  readonly item: LocalItem | null;
}

/**
 * A document's permissions: local and inherited ACEs, blocked inheritance, and each ACE's time
 * frame and status, with add, edit and remove over the server's list for the document type. Under
 * **All permissions**, Nuxeo's standard permissions and every other permission the server reports
 * to the user are offered too.
 *
 * **Every write addresses one ACE.** Changes are staged and applied on Save as one
 * `Document.AddPermission`, `ReplacePermission` or `RemovePermission`-by-id per change, so an
 * entry the user did not touch is never written. Before writing, the ACL is read again and a
 * change that cannot be written faithfully refuses the whole save, naming each entry and why;
 * afterwards it is read once more and any change the server does not show is reported. See
 * `refusalsFor` and `unconfirmedChanges`.
 *
 * **Hiding a control is not a security control.** The panel offers editing when the read says the
 * user holds `WriteSecurity` or `Everything` and the document is not a version, and Nuxeo checks
 * every write regardless.
 *
 * Its chrome is translated through ngx-translate under `satori-components.permissions-panel.*`,
 * and permission names under `permissions.right.*`, both in the application's catalogue.
 * External-user sharing is not shown here; the host owns that flow.
 */
@Component({
  selector: 'nxs-permissions-panel',
  standalone: true,
  templateUrl: './permissions-panel.component.html',
  styleUrl: './permissions-panel.component.scss',
  imports: [
    TranslatePipe,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
  ],
  providers: [NxsPermissionsService, provideNxsDateAdapter()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-permissions-panel' },
})
export class NxsPermissionsPanelComponent {
  /** The uid of the document whose permissions to show. */
  readonly documentId = input.required<string>();
  /**
   * Called after a write that may have changed the document's ACL, so a host showing other
   * ACL-derived content — the external-user shares this panel leaves to it — can read it again.
   */
  readonly permissionsChanged = input<(() => void) | null>(null);

  private readonly service = inject(NxsPermissionsService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  /** The date fields' adapter, from `provideNxsDateAdapter()`: a host's may not hold JS dates. */
  private readonly dateAdapter = inject<DateAdapter<unknown>>(DateAdapter);

  /** Starts every id the template sets, so two panels on one page never share one. */
  protected readonly idPrefix = `nxs-permissions-${nextId++}`;

  protected readonly localColumns = [
    'principal',
    'permission',
    'timeFrame',
    'grantedBy',
    'actions',
  ];
  protected readonly inheritedColumns = ['principal', 'permission', 'timeFrame', 'grantedBy'];
  protected readonly otherColumns = ['principal', 'permission', 'timeFrame', 'acl'];

  protected readonly snapshot = signal<NxsPermissionsSnapshot | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<LoadError | null>(null);
  protected readonly saving = signal(false);
  protected readonly outcome = signal<NxsSaveOutcome | null>(null);
  protected readonly inheritanceBusy = signal(false);
  protected readonly inheritanceError = signal<string | null>(null);

  /** Staged changes: by ACE id for an existing entry, by a generated key for an addition. */
  protected readonly staged = signal<ReadonlyMap<string, NxsPermissionChange>>(new Map());
  private addCounter = 0;
  /** Display names of staged additions, from the search suggestion the user picked. */
  private readonly addedLabels = new Map<string, string>();

  protected readonly editor = signal<EditorState | null>(null);
  protected readonly editorPrincipal = signal<UserGroupSuggestion | null>(null);
  protected readonly editorQuery = signal('');
  protected readonly editorPermission = signal('Read');
  protected readonly editorDated = signal(false);
  /** The time frame's days, at local midnight. */
  protected readonly editorBegin = signal<Date | null>(null);
  protected readonly editorEnd = signal<Date | null>(null);
  /** The same days as the date fields hold them, in their adapter's own representation. */
  protected readonly editorBeginField = computed(() =>
    nxsDateToAdapter(this.dateAdapter, this.editorBegin()),
  );
  protected readonly editorEndField = computed(() =>
    nxsDateToAdapter(this.dateAdapter, this.editorEnd()),
  );
  protected readonly editorSubmitted = signal(false);
  protected readonly suggestions = signal<UserGroupSuggestion[]>([]);

  private readonly loads = new Subject<string>();
  private readonly searches = new Subject<string>();
  /**
   * Bumped whenever the document changes. A save or inheritance change still in flight finishes on
   * its own document, but its answer is dropped rather than shown on this one.
   */
  private generation = 0;

  protected readonly loadErrorKey = computed(
    () => `satori-components.permissions-panel.load-error.${this.loadError() ?? 'failed'}`,
  );
  protected readonly canManage = computed(() => this.snapshot()?.canManage ?? false);
  /**
   * False while a save or an inheritance change is in flight: a save replaces the staged changes
   * with those it did not send when it answers, so one staged after it started would be lost.
   */
  protected readonly editable = computed(
    () => this.canManage() && !this.saving() && !this.inheritanceBusy(),
  );
  protected readonly trackItem = (_index: number, item: LocalItem) => item.key;
  protected readonly pendingCount = computed(() => this.staged().size);

  /**
   * Whether every select offers the whole grantable set, not only the server's list for this
   * document type. Off by default, as Web UI offers only its `userVisiblePermissions`.
   */
  protected readonly allPermissions = signal(false);
  /**
   * The whole set is offered when asked for, and also when the type suggests nothing, so that no
   * select is left with no option to pick.
   */
  protected readonly typeSuggestsNothing = computed(
    () => (this.snapshot()?.catalogue.suggested.length ?? 0) === 0,
  );
  protected readonly offersAll = computed(
    () => this.allPermissions() || this.typeSuggestsNothing(),
  );

  /** The permission groups every select offers, in the server's order. */
  protected readonly permissionGroups = computed(() => {
    const catalogue = this.snapshot()?.catalogue;
    if (!catalogue) return [];
    const groups = [
      {
        label: 'satori-components.permissions-panel.group.suggested',
        permissions: catalogue.suggested,
      },
    ];
    if (this.offersAll()) {
      groups.push(
        {
          label: 'satori-components.permissions-panel.group.standard',
          permissions: catalogue.standard,
        },
        { label: 'satori-components.permissions-panel.group.other', permissions: catalogue.other },
      );
    }
    return groups.filter((group) => group.permissions.length > 0);
  });

  /**
   * What a select offers without a group of its own. An entry holding a permission outside this
   * set still shows it, as an extra option, so no entry is left with a blank select.
   */
  private readonly offered = computed(() => {
    const catalogue = this.snapshot()?.catalogue;
    if (!catalogue) return new Set<string>();
    return new Set(this.offersAll() ? offeredPermissions(catalogue) : catalogue.suggested);
  });

  protected readonly localItems = computed<LocalItem[]>(() => {
    const snapshot = this.snapshot();
    if (!snapshot) return [];
    const staged = this.staged();
    const extras = (...permissions: (string | undefined)[]) =>
      [...new Set(permissions)].filter((p): p is string => !!p && !this.offered().has(p));
    const items: LocalItem[] = snapshot.local.map((row, index) => {
      const key = row.id || `no-id-${index}`;
      const change = staged.get(key);
      const lockedReason = !row.id ? 'satori-components.permissions-panel.locked.no-id' : null;
      // A staged replacement may name a permission outside the offered set, which needs its option too.
      const replaced = change?.kind === 'replace' ? change.permission : undefined;
      const base = {
        ...this.fromRow(key, row, lockedReason),
        extraPermissions: extras(row.permission, replaced),
      };
      if (change?.kind === 'remove') {
        return { ...base, state: 'removed' };
      }
      if (change?.kind === 'replace') {
        return {
          ...base,
          permission: change.permission,
          begin: change.begin,
          end: change.end,
          state: 'changed',
        };
      }
      return base;
    });
    for (const [key, change] of staged) {
      if (change.kind !== 'add') continue;
      items.push({
        key,
        row: null,
        principal: change.principal,
        principalLabel: this.addedLabels.get(key) ?? '',
        permission: change.permission,
        begin: change.begin,
        end: change.end,
        state: 'added',
        granted: true,
        lockedReason: null,
        extraPermissions: extras(change.permission),
      });
    }
    return items;
  });

  /**
   * Permissions the editor must offer beyond the offered set: the entry's own, and the one the
   * user has picked, which stays selectable if All permissions is unticked under the form.
   */
  protected readonly editorExtraPermissions = computed(() => {
    const offered = this.offered();
    const held = this.editor()?.item?.extraPermissions ?? [];
    return [...new Set([...held, this.editorPermission()])].filter((p) => !!p && !offered.has(p));
  });

  protected readonly editorInvalidRange = computed(() => {
    const begin = toDay(this.editorBegin());
    const end = toDay(this.editorEnd());
    return this.editorDated() && !!begin && !!end && begin > end;
  });

  constructor() {
    this.loads
      .pipe(
        // `defer`, so even a synchronous throw ends this load rather than the whole stream —
        // after which no later document, reload or retry would ever load again.
        switchMap((uid) =>
          defer(() => this.service.load(uid)).pipe(
            catchError((error: unknown) => {
              this.loadError.set(classifyLoadError(error));
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((snapshot) => {
        if (snapshot) this.snapshot.set(snapshot);
        this.loading.set(false);
      });

    // No `distinctUntilChanged`: the panel outlives a form, so the same term typed into the next
    // Add would be swallowed and its suggestions, cleared when the form opened, never come back.
    this.searches
      .pipe(
        debounceTime(300),
        map((term) => term.trim()),
        switchMap((term) =>
          (term.length >= 1
            ? defer(() => this.service.searchPrincipals(term)).pipe(catchError(() => of([])))
            : of([])
          ).pipe(map((results) => ({ term, results }))),
        ),
        takeUntilDestroyed(),
      )
      // A search can answer after its form closed or its term changed, and must not offer its
      // principals to whatever the editor holds now.
      .subscribe(({ term, results }) => {
        if (this.editor()?.mode === 'add' && this.editorQuery().trim() === term) {
          this.suggestions.set(results);
        }
      });

    // A new document is a new panel: nothing staged, shown or half-edited may carry over.
    effect(() => {
      const uid = this.documentId();
      untracked(() => {
        this.generation += 1;
        this.snapshot.set(null);
        this.clearStaged();
        this.outcome.set(null);
        this.editor.set(null);
        this.saving.set(false);
        this.inheritanceBusy.set(false);
        this.inheritanceError.set(null);
        this.load(uid);
      });
    });
  }

  protected reload(): void {
    this.clearStaged();
    this.outcome.set(null);
    this.editor.set(null);
    this.load(this.documentId());
  }

  // ── Labels ──────────────────────────────────────────────────────────────────────────────────

  protected permissionLabel(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  /** An ACE's time frame, from staged days or the server's instants alike. */
  protected timeFrame(begin: string | null, end: string | null): string {
    return formatAceDateRange(
      instantToDay(begin),
      instantToDay(end),
      (key, params) => this.translate.instant(key, params),
      this.locale,
    );
  }

  /** `principal — permission`, for refusal and failure lines. */
  protected entryLabel(principal: string, permission: string): string {
    const who =
      principal || this.translate.instant('satori-components.permissions-panel.unnamed-principal');
    return `${who} — ${this.permissionLabel(permission)} (${permission})`;
  }

  protected serverMessage(error: unknown): string {
    const body = (error as { error?: { message?: unknown } } | null)?.error;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (message) return message;
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' && status > 0
      ? `HTTP ${status}`
      : this.translate.instant('satori-components.permissions-panel.failed.unknown');
  }

  protected isDenied(error: unknown): boolean {
    return isPermissionDeniedError(error);
  }

  // ── Staging ─────────────────────────────────────────────────────────────────────────────────

  protected setPermission(item: LocalItem, permission: string): void {
    if (!this.editable()) return;
    this.outcome.set(null);
    if (item.row) {
      this.stageReplace(item.key, item.row, permission, item.begin, item.end);
    } else {
      this.updateAdd(item.key, { permission });
    }
  }

  protected toggleRemove(item: LocalItem): void {
    if (!this.editable()) return;
    this.outcome.set(null);
    const next = new Map(this.staged());
    if (!item.row || next.get(item.key)?.kind === 'remove') {
      next.delete(item.key);
    } else {
      next.set(item.key, { kind: 'remove', target: item.row });
    }
    this.staged.set(next);
  }

  protected dismissOutcome(): void {
    this.outcome.set(null);
  }

  protected discard(): void {
    this.clearStaged();
    this.outcome.set(null);
    this.editor.set(null);
  }

  // ── Editor ──────────────────────────────────────────────────────────────────────────────────

  protected openAdd(): void {
    if (!this.editable()) return;
    this.outcome.set(null);
    this.editor.set({ mode: 'add', item: null });
    this.editorPrincipal.set(null);
    this.editorQuery.set('');
    this.editorPermission.set(this.snapshot()?.catalogue.suggested[0] ?? 'Read');
    this.editorDated.set(false);
    this.editorBegin.set(null);
    this.editorEnd.set(null);
    this.editorSubmitted.set(false);
    this.suggestions.set([]);
  }

  protected openEdit(item: LocalItem): void {
    if (!this.editable()) return;
    this.outcome.set(null);
    this.editor.set({ mode: 'edit', item });
    this.editorPermission.set(item.permission);
    this.editorDated.set(!!item.begin || !!item.end);
    this.editorBegin.set(dateOf(item.begin));
    this.editorEnd.set(dateOf(item.end));
    this.editorSubmitted.set(false);
  }

  protected closeEditor(): void {
    this.editor.set(null);
  }

  protected onPrincipalInput(value: string): void {
    this.editorQuery.set(value);
    this.editorPrincipal.set(null);
    this.searches.next(value);
  }

  protected onPrincipalSelected(suggestion: UserGroupSuggestion): void {
    this.editorPrincipal.set(suggestion);
    this.editorQuery.set(suggestion.displayLabel);
  }

  /** The day a date field holds, whatever its adapter holds dates as. */
  protected fieldDay(value: unknown): Date | null {
    return nxsDateFromAdapter(this.dateAdapter, value);
  }

  protected displaySuggestion(suggestion: UserGroupSuggestion | string | null): string {
    if (!suggestion) return '';
    return typeof suggestion === 'string' ? suggestion : suggestion.displayLabel;
  }

  protected applyEditor(): void {
    const editor = this.editor();
    if (!editor || !this.editable()) return;
    this.editorSubmitted.set(true);
    if (this.editorInvalidRange()) return;
    const begin = this.editorDated() ? toDay(this.editorBegin()) : null;
    const end = this.editorDated() ? toDay(this.editorEnd()) : null;
    const permission = this.editorPermission();

    if (editor.mode === 'add') {
      const principal = this.editorPrincipal();
      if (!principal) return;
      const key = `add-${++this.addCounter}`;
      const next = new Map(this.staged());
      next.set(key, { kind: 'add', key, principal: principal.id, permission, begin, end });
      if (principal.displayLabel !== principal.id)
        this.addedLabels.set(key, principal.displayLabel);
      this.staged.set(next);
    } else if (editor.item?.row) {
      this.stageReplace(editor.item.key, editor.item.row, permission, begin, end);
    } else if (editor.item) {
      this.updateAdd(editor.item.key, { permission, begin, end });
    }
    this.editor.set(null);
  }

  // ── Writes ──────────────────────────────────────────────────────────────────────────────────

  protected save(): void {
    const entries = [...this.staged().entries()];
    const changes = entries.map(([, change]) => change);
    if (changes.length === 0 || this.saving()) return;
    this.saving.set(true);
    this.outcome.set(null);
    this.editor.set(null);
    const generation = this.generation;
    this.service
      .save(this.documentId(), changes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => {
          if (generation !== this.generation) return;
          this.saving.set(false);
          this.outcome.set(outcome);
          // Neither wrote anything, so the user's staged changes stay for them to adjust.
          if (outcome.kind === 'refused' || outcome.kind === 'unread') return;
          if (outcome.kind !== 'unverified' && outcome.snapshot)
            this.snapshot.set(outcome.snapshot);
          // Writes stop at the refused change, so it and every change after it were never sent.
          if (outcome.kind === 'failed') {
            this.keepStaged(entries.slice(changes.indexOf(outcome.change)));
            if (outcome.applied + outcome.unconfirmed.length > 0) this.notifyChanged();
          } else {
            this.clearStaged();
            this.notifyChanged();
          }
        },
        error: (error: unknown) => {
          if (generation !== this.generation) return;
          // Every failure the service expects is an outcome. Anything else may have struck
          // mid-batch, so what the server holds is unknown.
          this.saving.set(false);
          this.outcome.set({ kind: 'unverified', count: changes.length, error });
          this.clearStaged();
          this.notifyChanged();
        },
      });
  }

  protected toggleInheritance(): void {
    const snapshot = this.snapshot();
    if (!snapshot || this.inheritanceBusy() || this.pendingCount() > 0) return;
    this.inheritanceBusy.set(true);
    this.inheritanceError.set(null);
    this.outcome.set(null);
    const generation = this.generation;
    this.service
      .setInheritanceBlocked(this.documentId(), !snapshot.inheritanceBlocked)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          if (generation !== this.generation) return;
          this.inheritanceBusy.set(false);
          if (updated) this.snapshot.set(updated);
          else this.load(this.documentId());
          this.notifyChanged();
        },
        error: (error: unknown) => {
          if (generation !== this.generation) return;
          this.inheritanceBusy.set(false);
          this.inheritanceError.set(this.serverMessage(error));
        },
      });
  }

  protected refusalReasonKey(refusal: NxsPermissionRefusal): string {
    return `satori-components.permissions-panel.refusal.${refusal.reason}`;
  }

  protected failedEntry(outcome: Extract<NxsSaveOutcome, { kind: 'failed' }>): string {
    const change = outcome.change;
    return change.kind === 'add'
      ? this.entryLabel(change.principal, change.permission)
      : this.entryLabel(
          change.target.principal,
          change.kind === 'remove' ? change.target.permission : change.permission,
        );
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────────

  private clearStaged(): void {
    this.staged.set(new Map());
    this.addedLabels.clear();
  }

  private notifyChanged(): void {
    this.permissionsChanged()?.();
  }

  private keepStaged(entries: readonly (readonly [string, NxsPermissionChange])[]): void {
    const kept = new Map(entries);
    for (const key of [...this.addedLabels.keys()]) {
      if (!kept.has(key)) this.addedLabels.delete(key);
    }
    this.staged.set(kept);
  }

  private load(uid: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.loads.next(uid);
  }

  private fromRow(
    key: string,
    row: NxsAceRow,
    lockedReason: string | null,
  ): Omit<LocalItem, 'extraPermissions'> {
    return {
      key,
      row,
      principal: row.principal,
      principalLabel: row.principalLabel,
      permission: row.permission,
      begin: instantToDay(row.begin),
      end: instantToDay(row.end),
      state: 'unchanged',
      granted: row.granted,
      lockedReason:
        lockedReason ?? (row.granted ? null : 'satori-components.permissions-panel.locked.deny'),
    };
  }

  /** Stages a replacement, or drops it when it would write the entry back unchanged. */
  private stageReplace(
    key: string,
    row: NxsAceRow,
    permission: string,
    begin: string | null,
    end: string | null,
  ): void {
    const next = new Map(this.staged());
    const unchanged =
      permission === row.permission &&
      begin === instantToDay(row.begin) &&
      end === instantToDay(row.end);
    if (unchanged) next.delete(key);
    else next.set(key, { kind: 'replace', target: row, permission, begin, end });
    this.staged.set(next);
  }

  private updateAdd(
    key: string,
    patch: Partial<Pick<NxsPermissionChange & { kind: 'add' }, 'permission' | 'begin' | 'end'>>,
  ): void {
    const change = this.staged().get(key);
    if (change?.kind !== 'add') return;
    const next = new Map(this.staged());
    next.set(key, { ...change, ...patch });
    this.staged.set(next);
  }
}

function dateOf(day: string | null): Date | null {
  return day ? dayToDate(`${day}T00:00:00.000Z`) : null;
}

function classifyLoadError(error: unknown): LoadError {
  if (isPermissionDeniedError(error)) return 'denied';
  return (error as { status?: unknown } | null)?.status === 404 ? 'not-found' : 'failed';
}
