import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { type MockInstance } from 'vitest';
import { DocumentDetailService, type NuxeoAce } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsToastService } from '../toast/toast.service';
import {
  NxsDeletePermissionDialogComponent,
  type NxsDeletePermissionDialogData,
} from './delete-permission-dialog.component';

const ace = (overrides: Partial<NuxeoAce> = {}): NuxeoAce => ({
  id: 'transient/ext@example.com:Read:true:Administrator::1927929600000',
  username: 'transient/ext@example.com',
  permission: 'Read',
  granted: true,
  externalUser: true,
  creator: 'Administrator',
  begin: null,
  end: null,
  status: 'effective',
  ...overrides,
});

describe('NxsDeletePermissionDialogComponent', () => {
  let removePermissionById: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>;
  let toastError: MockInstance;
  let ref: MatDialogRef<NxsDeletePermissionDialogComponent, boolean>;
  let close: MockInstance;

  const overlay = (): HTMLElement =>
    document.querySelector('.cdk-overlay-container') as HTMLElement;
  const deleteButton = (): HTMLButtonElement =>
    overlay().querySelector('.nxs-delete-permission-dialog__delete') as HTMLButtonElement;
  const cancelButton = (): HTMLButtonElement =>
    overlay().querySelector('[mat-dialog-close]') as HTMLButtonElement;
  const cells = (): string[] =>
    [...overlay().querySelectorAll('tbody td')].map((td) => td.textContent?.trim() ?? '');

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }

  async function open(data: Partial<NxsDeletePermissionDialogData> = {}): Promise<void> {
    ref = TestBed.inject(MatDialog).open(NxsDeletePermissionDialogComponent, {
      data: { documentUid: 'doc-1', ace: ace(), ...data },
      role: 'alertdialog',
    });
    close = vi.spyOn(ref, 'close');
    await settle();
  }

  beforeEach(() => {
    removePermissionById = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: DocumentDetailService, useValue: { removePermissionById } },
      ],
    });
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.restoreAllMocks();
  });

  it('is named by its title and shows the entry it will delete', async () => {
    await open({ ace: ace({ permission: 'ReadWrite' }) });

    const container = overlay().querySelector('mat-dialog-container') as HTMLElement;
    const title = document.getElementById(container.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent?.trim()).toBe('The following permission will be deleted.');
    expect(container.getAttribute('role')).toBe('alertdialog');
    expect([...overlay().querySelectorAll('th')].map((th) => th.getAttribute('scope'))).toEqual([
      'col',
      'col',
      'col',
      'col',
    ]);
    expect(cells()).toEqual(['ext@example.com', 'Edit', 'Permanent', 'Administrator']);
  });

  it('shows the day the entry ends as its writer picked it, and a dash for an unknown granter', async () => {
    // Midnight in Paris on 15 July, which Nuxeo holds as 22:00 UTC on the 14th.
    await open({ ace: ace({ end: '2030-07-14T22:00:00.000Z', creator: null }) });

    expect(cells()[2]).toBe('Until Jul 15, 2030');
    expect(cells()[3]).toBe('—');
  });

  it('prefers the label Nuxeo gives the principal', async () => {
    await open({ ace: ace({ username: 'jdoe', usernameLabel: 'John Doe' }) });

    expect(cells()[0]).toBe('John Doe');
  });

  it('deletes that one entry by its id, on the local ACL, then closes with true', async () => {
    await open();

    deleteButton().click();
    await settle();

    expect(removePermissionById).toHaveBeenCalledWith(
      'doc-1',
      'transient/ext@example.com:Read:true:Administrator::1927929600000',
      'local',
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  it('deletes from the ACL the entry is on', async () => {
    await open({ acl: 'workflow' });

    deleteButton().click();
    await settle();

    expect(removePermissionById.mock.calls[0][2]).toBe('workflow');
  });

  it('names the progress and blocks both buttons while it deletes', async () => {
    const pending = new Subject<unknown>();
    removePermissionById.mockReturnValue(pending);
    await open();

    deleteButton().click();
    deleteButton().click();
    await settle();

    expect(removePermissionById).toHaveBeenCalledTimes(1);
    expect(deleteButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(deleteButton().querySelector('mat-progress-spinner')?.getAttribute('aria-label')).toBe(
      'Deleting the permission',
    );
    pending.next({});
    await settle();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('says a refusal is a refusal, and stays open to retry', async () => {
    removePermissionById.mockReturnValue(throwError(() => ({ status: 403 })));
    await open();

    deleteButton().click();
    await settle();

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to change permissions on this document.",
    );
    expect(close).not.toHaveBeenCalled();
    expect(deleteButton().disabled).toBe(false);
    expect(deleteButton().textContent?.trim()).toBe('Delete');
  });

  it('reports any other failure as one', async () => {
    removePermissionById.mockReturnValue(throwError(() => ({ status: 500 })));
    await open();

    deleteButton().click();
    await settle();

    expect(toastError).toHaveBeenCalledWith('The permission could not be deleted.');
    expect(close).not.toHaveBeenCalled();
  });

  it('deletes nothing when cancelled', async () => {
    await open();

    cancelButton().click();
    await settle();

    expect(removePermissionById).not.toHaveBeenCalled();
  });
});
