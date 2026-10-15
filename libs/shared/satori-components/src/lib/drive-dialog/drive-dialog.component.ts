import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { NuxeoDriveService } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsSpinnerComponent } from '../spinner/spinner.component';

/** What the Drive dialog needs from the page that opens it. */
export interface NxsDriveDialogData {
  /** The repository folder Drive should open. The repository root when absent. */
  readonly folderPath?: string;
}

interface DrivePackage {
  readonly platform: string;
  readonly name: string;
  readonly url: string;
}

const DRIVE_PACKAGES: readonly DrivePackage[] = [
  {
    platform: 'Linux',
    name: 'Nuxeo-Drive-X86_64.AppImage',
    url: 'https://community.nuxeo.com/static/drive-updates/release/nuxeo-drive-x86_64.AppImage',
  },
  {
    platform: 'macOS',
    name: 'Nuxeo-Drive.Dmg',
    url: 'https://community.nuxeo.com/static/drive-updates/release/nuxeo-drive.dmg',
  },
  {
    platform: 'Windows',
    name: 'Nuxeo-Drive.Exe',
    url: 'https://community.nuxeo.com/static/drive-updates/release/nuxeo-drive.exe',
  },
];

/**
 * "Open with Nuxeo Drive", as a `MatDialog`: `dialog.open(NxsDriveDialogComponent, { data })`.
 *
 * It first asks Nuxeo whether this user has a Drive token. With one, it hands Drive the folder
 * through a `nxdrive://direct-transfer` link and closes itself — direct-transfer matches on the
 * server URL alone, where `nxdrive://edit` also matches the username and fails on some Drive
 * configurations. Without one, including when the check fails, it offers the installers.
 */
@Component({
  selector: 'nxs-drive-dialog',
  standalone: true,
  templateUrl: './drive-dialog.component.html',
  styleUrl: './drive-dialog.component.scss',
  imports: [MatDialogModule, NxsSpinnerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-drive-dialog' },
})
export class NxsDriveDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<NxsDriveDialogComponent>>(MatDialogRef);
  private readonly drive = inject(NuxeoDriveService);
  private readonly data = inject<NxsDriveDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  protected readonly packages = DRIVE_PACKAGES;
  protected readonly checking = signal(true);

  constructor() {
    this.drive
      .hasDriveToken()
      .pipe(takeUntilDestroyed())
      .subscribe((hasToken) => {
        if (!hasToken) {
          this.checking.set(false);
          return;
        }
        this.drive.openDriveUrl(this.drive.buildDirectTransferUrl(this.data?.folderPath || '/'));
        this.dialogRef.close();
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
