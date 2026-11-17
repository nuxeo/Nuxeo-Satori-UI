import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  SettingsService,
  UserService,
  type LocalPermissionRow,
  type NuxeoGroup,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService } from '../../auth/auth.service';
import { ChangePasswordDialogComponent } from './change-password-dialog/change-password-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet, MatIconModule, MatButtonModule],
  templateUrl: './profile-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './profile-page.component.scss',
})
export class ProfilePageComponent {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  /** The active language as a signal, so a `computed` that calls `instant()` recomputes on a switch. */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() ?? 'en' },
  );
  private readonly userService = inject(UserService);
  private readonly settingsService = inject(SettingsService);
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

  showGrantedBy(grantedBy: string): boolean {
    return grantedBy !== '—';
  }
}
