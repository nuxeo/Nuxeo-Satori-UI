import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  };
}

export interface ShareSavedSearchAddPermissionResult {
  userGroup: string;
  right: string;
  timeFrame: string;
  grantedBy: string;
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

  searchText = '';
  selectedPrincipal: UserGroupSuggestion | null = null;
  right = 'Read';
  timeFrameMode: 'permanent' | 'date-based' = 'permanent';
  beginDate: Date | null = null;
  endDate: Date | null = null;
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

    // Normalize the right value to match options
    this.right = this.normalizeRightValue(data.right);

    if (data.timeFrame === 'Permanent') {
      this.timeFrameMode = 'permanent';
      this.beginDate = null;
      this.endDate = null;
    } else {
      this.timeFrameMode = 'date-based';
      if (data.timeFrame.startsWith('Until ')) {
        this.beginDate = null;
        this.endDate = this.parseDate(data.timeFrame.slice(6).trim());
      } else if (data.timeFrame.startsWith('From ')) {
        this.beginDate = this.parseDate(data.timeFrame.slice(5).trim());
        this.endDate = null;
      } else {
        const dateRange = data.timeFrame.split(' - ');
        if (dateRange.length === 2) {
          this.beginDate = this.parseDate(dateRange[0].trim());
          this.endDate = this.parseDate(dateRange[1].trim());
        }
      }
    }

    this.sendNotify = false;
  }

  private normalizeRightValue(value: string): string {
    // Map various right values to the standardized options
    const normalizedMap: Record<string, string> = {
      Read: 'Read',
      Write: 'ReadWrite',
      Edit: 'ReadWrite',
      ReadWrite: 'ReadWrite',
      Manage: 'Everything',
      'Manage everything': 'Everything',
      Everything: 'Everything',
      'Can collect': 'ReadCanCollect',
      ReadCanCollect: 'ReadCanCollect',
    };
    return normalizedMap[value] || 'Read'; // Default to 'Read' if no match
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    try {
      // YYYY-MM-DD (ISO date)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [yyyy, mm, dd] = dateStr.split('-');
        return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      }
      // MM/DD/YYYY (legacy format)
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [mm, dd, yyyy] = dateStr.split('/');
        return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
      }
      // ISO or other date-like strings
      const parsed = new Date(dateStr);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
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

  isSubmitDisabled(): boolean {
    return !this.selectedPrincipal || this.saving() || !this.rightIsOffered();
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

    if (this.timeFrameMode === 'permanent') {
      return {
        userGroup,
        right: this.right,
        timeFrame: 'Permanent',
        grantedBy,
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
    return {
      userGroup,
      right: this.right,
      timeFrame,
      grantedBy,
    };
  }

  private resetForm(): void {
    this.searchText = '';
    this.selectedPrincipal = null;
    this.right = this.firstRight();
    this.timeFrameMode = 'permanent';
    this.beginDate = null;
    this.endDate = null;
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
