import { Component, inject, signal, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule, type NgModel } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DocumentDetailService,
  permissionRightLabel,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';
import { nxsOfferedRights } from '@nuxeo/satori-platform/components';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { provideTranslatedDatepickerIntl } from '../datepicker-intl/translated-datepicker-intl';
import { provideSatoriDateAdapter } from '../date-adapter/satori-date-adapter';

export interface ShareSavedSearchAddPermissionDialogData {
  title?: string;
  /** The saved search's `userVisiblePermissions`; Nuxeo's default three when absent. */
  permissions?: readonly string[] | null;
  initialData?: {
    userGroup: string;
    right: string;
    timeFrame: string;
    grantedBy?: string;
    /**
     * The entry's own ACE instants. The authority on its dates: `timeFrame` is a **translated**
     * label, so reading the dates back out of it only worked in English, and a one-sided range in
     * any other locale parsed as permanent and cleared the boundary.
     */
    begin?: string | null;
    end?: string | null;
  };
}

export interface ShareSavedSearchAddPermissionResult {
  userGroup: string;
  right: string;
  timeFrame: string;
  grantedBy: string;
  /**
   * What to write. A day the user picked, `YYYY-MM-DD`; or, when they left the dates alone, the
   * entry's original instant, so an edit of something else cannot re-anchor it at the server's
   * midnight and move it.
   */
  begin: string | null;
  end: string | null;
  /** The notification choices, which the caller is responsible for honouring. */
  notify: boolean;
  comment: string | null;
}

@Component({
  selector: 'lib-share-saved-search-add-permission-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatRadioModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatAutocompleteModule,
    MatIconModule,
  ],
  providers: [provideTranslatedDatepickerIntl(), provideSatoriDateAdapter()],
  templateUrl: './share-saved-search-add-permission-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './share-saved-search-add-permission-dialog.component.scss',
})
export class ShareSavedSearchAddPermissionDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<
      ShareSavedSearchAddPermissionDialogComponent,
      ShareSavedSearchAddPermissionResult[] | null
    >,
  );
  readonly data =
    inject<ShareSavedSearchAddPermissionDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  private readonly detailService = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly searchSubject = new Subject<string>();

  readonly suggestions = signal<UserGroupSuggestion[]>([]);
  readonly saving = signal(false);
  readonly rightOptions: readonly { value: string; label: string }[];
  private readonly fromModel = viewChild<NgModel>('fromModel');
  private readonly toModel = viewChild<NgModel>('toModel');

  searchText = '';
  selectedPrincipal: UserGroupSuggestion | null = null;
  right = 'Read';
  timeFrameMode: 'permanent' | 'date-based' = 'permanent';
  beginDate: Date | null = null;
  endDate: Date | null = null;
  /** The instants the entry arrived with, written back when the user leaves the dates alone. */
  private originalBegin: string | null = null;
  private originalEnd: string | null = null;
  // Tracked per endpoint: a shared flag meant changing one boundary rewrote the other from its
  // instant to a day, which Nuxeo re-anchors at its own midnight and so moves it.
  private beginTouched = false;
  private endTouched = false;
  sendNotify = true;
  notifyComment = '';
  private readonly createdEntries: ShareSavedSearchAddPermissionResult[] = [];
  readonly isEditMode = !!this.data.initialData;

  constructor() {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          term.trim().length >= 3 ? this.detailService.searchUsersGroups(term.trim()) : of([]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => this.suggestions.set(results));

    if (this.isEditMode && this.data.initialData) {
      this.initializeFormWithData(this.data.initialData);
    }
    this.rightOptions = nxsOfferedRights(
      this.data.permissions,
      this.isEditMode ? this.right : undefined,
    ).map((value) => ({
      value,
      label: permissionRightLabel(value, (key) => this.translate.instant(key)),
    }));
    // The type's list need not hold `Read`, so a new entry starts on the first right it offers.
    if (!this.isEditMode) this.right = this.firstRight();
  }

  private firstRight(): string {
    return this.rightOptions[0]?.value ?? 'Read';
  }

  private rightIsOffered(): boolean {
    return this.rightOptions.some((option) => option.value === this.right);
  }

  private initializeFormWithData(data: NonNullable<typeof this.data.initialData>): void {
    this.searchText = data.userGroup;
    // Create a mock UserGroupSuggestion from the stored data
    this.selectedPrincipal = {
      id: data.userGroup,
      displayLabel: data.userGroup,
      type: data.grantedBy === 'Group' ? 'GROUP_TYPE' : 'USER_TYPE',
      email: undefined,
      username: undefined,
      groupname: undefined,
    } as UserGroupSuggestion;

    // The stored permission, verbatim. Nuxeo Web UI's `nuxeo-popup-permission` does the same
    // (`_computeParams`: `params.permission = ace.permission`) and defaults to `Read` only for a
    // *new* entry. Rewriting it here widened `Write` to `ReadWrite` and narrowed every permission
    // outside a hardcoded four — `WriteSecurity` among them — to `Read` (NXSAT-334).
    this.right = data.right;

    // From the instants, never from the translated `timeFrame` label.
    this.originalBegin = data.begin ?? null;
    this.originalEnd = data.end ?? null;
    this.timeFrameMode = this.originalBegin || this.originalEnd ? 'date-based' : 'permanent';
    this.beginDate = this.toPickerDate(this.originalBegin);
    this.endDate = this.toPickerDate(this.originalEnd);
    this.beginTouched = false;
    this.endTouched = false;

    this.sendNotify = false;
  }

  /**
   * An ACE instant as a date for the picker.
   *
   * Nuxeo stores a day as midnight in the writer's zone and returns it in UTC, and the zone is not
   * recorded, so the day is only recoverable exactly for a reader in that zone — a day written at
   * CET midnight is held as 23:00 UTC the day before. The picker shows the day that instant falls
   * on in the reader's own zone, which is right for an entry written there. Either way the write
   * preserves the original instant unless the user actually picks a new day, so a misread day is
   * never written back.
   */
  private toPickerDate(instant: string | null): Date | null {
    if (!instant) return null;
    const parsed = new Date(instant);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  onSearchChange(value: string): void {
    this.searchText = value;
    this.selectedPrincipal = null;
    this.searchSubject.next(value);
  }

  onSuggestionSelected(suggestion: UserGroupSuggestion): void {
    this.selectedPrincipal = suggestion;
    this.searchText = suggestion.displayLabel;
  }

  displaySuggestion(suggestion: UserGroupSuggestion | string | null): string {
    if (!suggestion) return '';
    return typeof suggestion === 'string' ? suggestion : suggestion.displayLabel;
  }

  create(andAddAnother: boolean): void {
    if (this.isSubmitDisabled()) return;

    this.saving.set(true);

    const entry = this.buildResultEntry();
    if (this.isEditMode) {
      this.dialogRef.close([entry]);
    } else {
      this.createdEntries.push(entry);
      this.saving.set(false);
      if (andAddAnother) {
        this.resetForm();
        return;
      }
      this.dialogRef.close(this.createdEntries);
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  /**
   * Whether either date input holds something that is not a date.
   *
   * Material answers unparseable input with `null` on the model *and* a parse error on the
   * control, which looks exactly like a cleared field from the model alone. Without this, a
   * mistyped expiry read as "the user cleared the date" and the save removed the boundary.
   * Clearing a date on purpose leaves the control valid, so it still works.
   */
  private datesInvalid(): boolean {
    return (
      [this.fromModel(), this.toModel()].some((model) => model?.invalid === true) ||
      this.rangeInverted()
    );
  }

  /**
   * Whether the entry would start after it ends.
   *
   * Both controls are individually valid in that case, so nothing else catches it, and Nuxeo
   * accepts the ACE — leaving an entry that never grants anything. `nxs-permissions-panel` refuses
   * the same shape (`refusalsFor`, reason `invalid-time-frame`). Only applies to a date-based
   * entry: a permanent one has no bounds, and either bound alone cannot be inverted.
   */
  rangeInverted(): boolean {
    if (this.timeFrameMode !== 'date-based') return false;
    const begin = this.beginDate?.getTime();
    const end = this.endDate?.getTime();
    return begin !== undefined && end !== undefined && begin > end;
  }

  isSubmitDisabled(): boolean {
    return (
      !this.selectedPrincipal || this.saving() || !this.rightIsOffered() || this.datesInvalid()
    );
  }

  private buildResultEntry(): ShareSavedSearchAddPermissionResult {
    const principal = this.selectedPrincipal;
    const userGroup = principal?.displayLabel || this.searchText.trim();
    const grantedBy =
      this.isEditMode && this.data.initialData?.grantedBy
        ? this.data.initialData.grantedBy
        : principal?.type === 'GROUP_TYPE'
          ? 'Group'
          : 'User';

    const notify = this.sendNotify;
    const comment = this.sendNotify ? this.notifyComment.trim() || null : null;

    if (this.timeFrameMode === 'permanent') {
      return {
        userGroup,
        right: this.right,
        timeFrame: 'Permanent',
        grantedBy,
        begin: null,
        end: null,
        notify,
        comment,
      };
    }

    const from = this.beginDate ? this.formatDate(this.beginDate) : null;
    const to = this.endDate ? this.formatDate(this.endDate) : null;
    let timeFrame: string;
    if (from && to) {
      timeFrame = `${from} - ${to}`;
    } else if (from) {
      timeFrame = `From ${from}`;
    } else if (to) {
      timeFrame = `Until ${to}`;
    } else {
      timeFrame = 'Permanent';
    }
    // An endpoint the user did not touch keeps the entry's own instant; one they picked is the day
    // they picked. `timeFrame` stays a human string and is never parsed back into a date.
    return {
      userGroup,
      right: this.right,
      timeFrame,
      grantedBy,
      begin: this.beginTouched ? from : (this.originalBegin ?? from),
      end: this.endTouched ? to : (this.originalEnd ?? to),
      notify,
      comment,
    };
  }

  /** The From picker calls this, so the To endpoint keeps its own instant. */
  onBeginChanged(): void {
    this.beginTouched = true;
  }

  /** The To picker calls this, so the From endpoint keeps its own instant. */
  onEndChanged(): void {
    this.endTouched = true;
  }

  /** Switching between permanent and date-based rewrites both endpoints. */
  onTimeFrameModeChanged(): void {
    this.beginTouched = true;
    this.endTouched = true;
  }

  private resetForm(): void {
    this.searchText = '';
    this.selectedPrincipal = null;
    this.right = this.firstRight();
    this.timeFrameMode = 'permanent';
    this.beginDate = null;
    this.endDate = null;
    this.originalBegin = null;
    this.originalEnd = null;
    this.beginTouched = false;
    this.endTouched = false;
    this.sendNotify = true;
    this.notifyComment = '';
    this.suggestions.set([]);
  }

  private formatDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
