import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  PrincipalPermissionsService,
  SettingsService,
  UserService,
  principalPermissionToLocalRow,
  type LocalPermissionRow,
  type NuxeoGroup,
  type PrincipalPermissionPage,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService } from '../../auth/auth.service';
import { ChangePasswordDialogComponent } from './change-password-dialog/change-password-dialog.component';
import { GroupPermLazyLoadDirective } from './group-perm-lazy-load.directive';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

const GROUP_PERM_PAGE_SIZE = 25;

@Component({
  standalone: true,
  imports: [
    TranslatePipe,
    NgTemplateOutlet,
    MatIconModule,
    MatButtonModule,
    GroupPermLazyLoadDirective,
  ],
  templateUrl: './profile-page.component.html',
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  /** The active language as a signal, so a `computed` that calls `instant()` recomputes on a switch. */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() },
  );
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly settingsService = inject(SettingsService);
  private readonly permService = inject(PrincipalPermissionsService);
  private readonly dialog = inject(MatDialog);
  private readonly changePasswordButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('changePasswordButton');

  readonly username = computed(() => {
    this.currentLang();
    return this.auth.username() ?? this.translate.instant('settings.profile.unknown-user');
  });
  readonly email = signal('—');
  readonly company = signal('—');
  readonly groups = signal<Array<{ identifier: string; label: string }>>([]);
  readonly groupsLoading = signal(true);
  readonly loading = signal(true);
  readonly localPermissions = signal<LocalPermissionRow[]>([]);
  readonly localPermissionsLoading = signal(true);
  readonly groupPermMap = signal<Record<string, PrincipalPermissionPage>>({});
  readonly groupPermLoading = signal<Record<string, boolean>>({});

  constructor() {
    afterNextRender(() => {
      this.changePasswordButton().nativeElement.focus();
    });

    const userId = this.auth.username();
    if (!userId) {
      this.loading.set(false);
      this.localPermissionsLoading.set(false);
      this.groupsLoading.set(false);
      this.groups.set([]);
      return;
    }

    this.userService
      .getUser(userId)
      .pipe(
        takeUntilDestroyed(),
        switchMap((user) => {
          this.email.set(user.properties.email || '—');
          this.company.set(user.properties.company || '—');
          this.loading.set(false);

          const groupIds = user.properties.groups ?? [];
          if (!groupIds.length) {
            this.groups.set([]);
            this.groupsLoading.set(false);
            return of(null);
          }

          return forkJoin(
            groupIds.map((gid) =>
              this.userService.getGroup(gid).pipe(catchError(() => of(null as NuxeoGroup | null))),
            ),
          ).pipe(
            map((resolvedGroups) => ({
              user,
              groups: groupIds.map((gid, index) => ({
                identifier: gid,
                label: resolvedGroups[index]?.grouplabel?.trim() || gid,
              })),
            })),
          );
        }),
      )
      .subscribe({
        next: (result) => {
          if (!result) {
            return;
          }
          this.groups.set(result.groups);
          this.groupsLoading.set(false);
        },
        error: () => {
          this.groupsLoading.set(false);
          this.loading.set(false);
        },
      });

    this.settingsService
      .getLocalPermissions(userId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (rows) => {
          this.localPermissions.set(rows);
          this.localPermissionsLoading.set(false);
        },
        error: () => {
          this.localPermissionsLoading.set(false);
        },
      });
  }

  openChangePasswordDialog(): void {
    this.dialog.open(ChangePasswordDialogComponent, { width: '440px' });
  }

  groupLink(_identifier: string): string {
    // TODO: Navigate to the Group details screen once that UI route is available.
    return '#';
  }

  groupPermPage(groupId: string): PrincipalPermissionPage | null {
    return this.groupPermMap()[groupId] ?? null;
  }

  isGroupPermLoading(groupId: string): boolean {
    return this.groupPermLoading()[groupId] === true;
  }

  hasGroupPermLoaded(groupId: string): boolean {
    return this.groupPermMap()[groupId] !== undefined;
  }

  onGroupPermSectionVisible(groupId: string): void {
    if (this.hasGroupPermLoaded(groupId) || this.isGroupPermLoading(groupId)) {
      return;
    }
    this.loadGroupPermPage(groupId, 0);
  }

  groupPermRows(groupId: string): LocalPermissionRow[] {
    const page = this.groupPermPage(groupId);
    if (!page) {
      return [];
    }
    return page.rows.map((row) =>
      principalPermissionToLocalRow(row, (key) => this.translate.instant(key), this.locale),
    );
  }

  groupPermTotalPages(groupId: string): number {
    const page = this.groupPermPage(groupId);
    return page ? Math.max(1, page.numberOfPages) : 1;
  }

  groupPermCurrentPage(groupId: string): number {
    return this.groupPermPage(groupId)?.currentPageIndex ?? 0;
  }

  groupPermPrev(groupId: string): void {
    const current = this.groupPermCurrentPage(groupId);
    if (current > 0) {
      this.loadGroupPermPage(groupId, current - 1);
    }
  }

  groupPermNext(groupId: string): void {
    const current = this.groupPermCurrentPage(groupId);
    if (current < this.groupPermTotalPages(groupId) - 1) {
      this.loadGroupPermPage(groupId, current + 1);
    }
  }

  showGrantedBy(grantedBy: string): boolean {
    return grantedBy !== '—';
  }

  private loadGroupPermPage(groupId: string, pageIndex: number): void {
    this.groupPermLoading.update((state) => ({ ...state, [groupId]: true }));
    this.permService
      .listLocalPermissionRows(groupId, GROUP_PERM_PAGE_SIZE, pageIndex)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.groupPermMap.update((state) => ({ ...state, [groupId]: page }));
          this.groupPermLoading.update((state) => ({ ...state, [groupId]: false }));
        },
        error: () => {
          this.groupPermMap.update((state) => ({
            ...state,
            [groupId]: {
              rows: [],
              totalDocuments: 0,
              numberOfPages: 0,
              currentPageIndex: 0,
              currentPageSize: 0,
            },
          }));
          this.groupPermLoading.update((state) => ({ ...state, [groupId]: false }));
        },
      });
  }
}
