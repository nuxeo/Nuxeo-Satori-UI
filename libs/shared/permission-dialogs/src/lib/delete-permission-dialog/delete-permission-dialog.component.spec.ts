import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';

import type { NuxeoAce } from '@nuxeo/satori-platform/nuxeo-client';

import {
  DeletePermissionDialogComponent,
  type DeletePermissionDialogData,
} from './delete-permission-dialog';

const REMOVE_URL = '/nuxeo/api/v1/id/doc-1/@op/Document.RemovePermission';

const ace = (overrides: Partial<NuxeoAce> = {}): NuxeoAce => ({
  id: 'members:Read:true:Administrator::',
  username: 'members',
  externalUser: false,
  permission: 'Read',
  granted: true,
  creator: 'Administrator',
  begin: null,
  end: null,
  status: 'effective',
  ...overrides,
});

/**
 * Browse's permissions panel opens this dialog to confirm, then delete, one entry. The request it
 * sends is the behaviour that matters, so the real `DocumentDetailService` runs against
 * `HttpTestingController` rather than a stub that would accept any call.
 */
describe('DeletePermissionDialogComponent', () => {
  let fixture: ComponentFixture<DeletePermissionDialogComponent>;
  let http: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;

  async function open(data: Partial<DeletePermissionDialogData> = {}): Promise<void> {
    close = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DeletePermissionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            documentUid: 'doc-1',
            ace: ace(),
            permissionLabel: 'Read',
            timeFrameLabel: 'Permanent',
            ...data,
          } satisfies DeletePermissionDialogData,
        },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DeletePermissionDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  const cells = () =>
    [...fixture.nativeElement.querySelectorAll('tbody td')].map((td: Element) =>
      td.textContent?.trim(),
    );
  const button = (label: string): HTMLButtonElement => {
    const found = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no "${label}" button`);
    return found as HTMLButtonElement;
  };
  const deleteButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button[color="warn"]');
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('asks for confirmation, naming the entry by principal, right, time frame and grantor', async () => {
    await open({ permissionLabel: 'Read & Write', timeFrameLabel: 'Until 31/12/2026' });

    expect(fixture.nativeElement.querySelector('h2').textContent.trim()).toBe(
      'The following permission will be deleted.',
    );
    expect(cells()).toEqual(['members', 'Read & Write', 'Until 31/12/2026', 'Administrator']);
    expect(deleteButton().textContent.trim()).toBe('Delete');
  });

  it('shows a dash for the grantor when Nuxeo recorded none', async () => {
    await open({ ace: ace({ creator: null }) });

    expect(cells()[3]).toBe('—');
  });

  it('closes on Cancel without deleting anything', async () => {
    await open();

    button('Cancel').click();
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.calls[0][0]).toBeFalsy();
    http.expectNone(REMOVE_URL);
  });

  it('deletes from the document’s local ACL, and closes with true once Nuxeo has', async () => {
    await open();

    deleteButton().click();
    await settle();

    const request = http.expectOne(REMOVE_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.params.acl).toBe('local');
    expect(close).not.toHaveBeenCalled();

    request.flush({ uid: 'doc-1' });
    await settle();

    expect(close).toHaveBeenCalledWith(true);
  });

  it('deletes only this entry, by its id, and leaves the principal’s other entries', async () => {
    // Checked against the local server: `Document.RemovePermission` with `user: members,
    // permission: Read` removed both of members' entries, Read and Write; with
    // `id: members:Read:true:Administrator::` it removed Read and kept Write.
    await open({ ace: ace({ id: 'members:Read:true:Administrator::', permission: 'Read' }) });

    deleteButton().click();
    await settle();

    const request = http.expectOne(REMOVE_URL);
    expect(request.request.body).toEqual({
      params: { id: 'members:Read:true:Administrator::', acl: 'local' },
      context: {},
    });
    expect(request.request.body.params).not.toHaveProperty('user');
    request.flush({ uid: 'doc-1' });
  });

  it('sends one request however often Delete is pressed while it is on its way', async () => {
    await open();

    fixture.componentInstance.confirmDelete();
    fixture.componentInstance.confirmDelete();
    await settle();

    expect(deleteButton().disabled).toBe(true);
    expect(deleteButton().querySelector('mat-spinner')).not.toBeNull();
    http.expectOne(REMOVE_URL).flush({ uid: 'doc-1' });
  });

  it('stays open with Delete enabled again when the delete fails, so it can be retried', async () => {
    await open();

    deleteButton().click();
    await settle();
    http.expectOne(REMOVE_URL).flush('nope', { status: 403, statusText: 'Forbidden' });
    await settle();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance.deleting()).toBe(false);
    expect(deleteButton().disabled).toBe(false);
    expect(deleteButton().textContent.trim()).toBe('Delete');
  });
});
