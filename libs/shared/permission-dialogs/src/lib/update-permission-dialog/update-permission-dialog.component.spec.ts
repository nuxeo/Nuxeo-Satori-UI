import { provideZonelessChangeDetection } from '@angular/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  NuxeoAce,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
} from '@nuxeo-satori/platform/nuxeo-client';

import { UpdatePermissionDialogComponent } from './update-permission-dialog';
import { NxsToastService } from '@nuxeo-satori/platform/components';

const ace: NuxeoAce = {
  id: 'ace-1',
  username: 'user-readonly01',
  externalUser: false,
  permission: 'Read',
  granted: true,
  creator: 'admin',
  begin: null,
  end: null,
  status: 'effective',
};

describe('UpdatePermissionDialogComponent (NXSAT-159)', () => {
  let fixture: ComponentFixture<UpdatePermissionDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let replacePermissionWithNotification: ReturnType<typeof vi.fn>;
  let removePermission: ReturnType<typeof vi.fn>;
  let addExternalPermissionWithNotification: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    closeSpy = vi.fn();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    replacePermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));
    removePermission = vi.fn().mockReturnValue(of({ uid: 'doc-1' }));
    addExternalPermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), UpdatePermissionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { documentUid: 'doc-1', ace, isExternal: false },
        },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: DocumentDetailService,
          useValue: {
            replacePermissionWithNotification,
            removePermission,
            addExternalPermissionWithNotification,
          },
        },
      ],
    })
      .overrideComponent(UpdatePermissionDialogComponent, {
        set: { imports: [], providers: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(UpdatePermissionDialogComponent);
    fixture.componentInstance.sendNotify = true;
    fixture.componentInstance.notifyComment = 'Updated access';
  });

  it('exposes SMTP mail hint constant', () => {
    expect(fixture.componentInstance.mailHintKey).toBe(PERMISSION_NOTIFICATION_MAIL_HINT_KEY);
  });

  it('updates local permission via replacePermissionWithNotification', () => {
    fixture.componentInstance.update();

    expect(replacePermissionWithNotification).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        id: 'ace-1',
        username: 'user-readonly01',
        notify: true,
        comment: 'Updated access',
      }),
    );
    expect(toast.show).toHaveBeenCalledWith('Permission updated and notification sent', {
      duration: 7000,
    });
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('warns when local update saves but notification fails', () => {
    replacePermissionWithNotification.mockReturnValue(
      of({
        document: { uid: 'doc-1' },
        notificationSent: false,
        notificationErrorKey: 'permissions.notification.mail-send-failed-update',
      }),
    );

    fixture.componentInstance.update();

    expect(toast.show).toHaveBeenCalledWith(
      'Permission was updated, but the notification email could not be sent. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  it('shows SMTP error when update fails due to mail', () => {
    replacePermissionWithNotification.mockReturnValue(
      throwError(() => ({
        error: { message: 'An error occurred while sending a mail' },
      })),
    );

    fixture.componentInstance.update();

    expect(toast.error).toHaveBeenCalledWith(
      'Permission could not be updated. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe('UpdatePermissionDialogComponent external (NXSAT-159)', () => {
  let fixture: ComponentFixture<UpdatePermissionDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let replacePermissionWithNotification: ReturnType<typeof vi.fn>;
  let removePermission: ReturnType<typeof vi.fn>;
  let addExternalPermissionWithNotification: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    closeSpy = vi.fn();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    replacePermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));
    removePermission = vi.fn().mockReturnValue(of({ uid: 'doc-1' }));
    addExternalPermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), UpdatePermissionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            documentUid: 'doc-1',
            ace: { ...ace, username: 'transient/guest@example.com', externalUser: true },
            isExternal: true,
          },
        },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: DocumentDetailService,
          useValue: {
            replacePermissionWithNotification,
            removePermission,
            addExternalPermissionWithNotification,
          },
        },
      ],
    })
      .overrideComponent(UpdatePermissionDialogComponent, {
        set: { imports: [], providers: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(UpdatePermissionDialogComponent);
    fixture.componentInstance.endDate = new Date('2026-12-31');
    fixture.componentInstance.notifyComment = 'External invite';
  });

  it('updates external permission via addExternalPermissionWithNotification', () => {
    fixture.componentInstance.update();

    expect(removePermission).toHaveBeenCalled();
    expect(addExternalPermissionWithNotification).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        email: 'guest@example.com',
        notify: true,
        comment: 'External invite',
      }),
    );
    expect(toast.show).toHaveBeenCalledWith('Permission updated and notification sent', {
      duration: 7000,
    });
  });
});
