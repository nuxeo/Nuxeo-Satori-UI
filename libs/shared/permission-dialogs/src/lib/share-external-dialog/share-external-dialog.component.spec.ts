import { provideZonelessChangeDetection } from '@angular/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
} from '@nuxeo-satori/platform/nuxeo-client';

import { ShareExternalDialogComponent } from './share-external-dialog';
import { NxsToastService } from '@nuxeo-satori/platform/components';

describe('ShareExternalDialogComponent (NXSAT-159)', () => {
  let fixture: ComponentFixture<ShareExternalDialogComponent>;
  let closeSpy: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let addExternalPermissionWithNotification: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    closeSpy = vi.fn();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    addExternalPermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), ShareExternalDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'doc-1' } },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: DocumentDetailService,
          useValue: { addExternalPermissionWithNotification },
        },
      ],
    })
      .overrideComponent(ShareExternalDialogComponent, {
        set: { imports: [], providers: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ShareExternalDialogComponent);
    fixture.componentInstance.email = 'guest@example.com';
    fixture.componentInstance.endDate = new Date('2026-12-31');
    fixture.componentInstance.notifyComment = 'Please review';
  });

  it('exposes SMTP mail hint constant', () => {
    expect(fixture.componentInstance.mailHintKey).toBe(PERMISSION_NOTIFICATION_MAIL_HINT_KEY);
    expect(
      TestBed.inject(TranslateService).instant(fixture.componentInstance.mailHintKey),
    ).toContain('SMTP');
  });

  it('creates external permission with notification and date-only end', () => {
    fixture.componentInstance.create(false);

    expect(addExternalPermissionWithNotification).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        email: 'guest@example.com',
        notify: true,
        comment: 'Please review',
        end: '2026-12-31',
      }),
    );
    expect(toast.show).toHaveBeenCalledWith('Permission added and notification sent', {
      duration: 7000,
    });
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('warns when permission is saved but notification fails', () => {
    addExternalPermissionWithNotification.mockReturnValue(
      of({
        document: { uid: 'doc-1' },
        notificationSent: false,
        notificationErrorKey: 'permissions.notification.mail-send-failed-add',
      }),
    );

    fixture.componentInstance.create(false);

    expect(toast.show).toHaveBeenCalledWith(
      'Permission was added, but the notification email could not be sent. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('handles permission creation when notification is not sent', () => {
    addExternalPermissionWithNotification.mockReturnValue(
      of({
        document: { uid: 'doc-1' },
        notificationSent: false,
      }),
    );

    toast.show.mockClear();
    toast.error.mockClear();

    fixture.componentInstance.create(false);

    // The load-bearing assertion. `notificationSent: false` with no `notificationErrorKey` makes
    // `successMessage` return null, so nothing should be announced — but the dialog still closes
    // with `true`, exactly as it does on success. Asserting only the close leaves this test green
    // if a regression starts reporting success for an email that was never sent.
    expect([...toast.show.mock.calls, ...toast.error.mock.calls]).toEqual([]);
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('resets form on create-and-add-another without closing', () => {
    fixture.componentInstance.create(true);

    expect(fixture.componentInstance.email).toBe('');
    expect(fixture.componentInstance.notifyComment).toBe('');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('closes with true on cancel after create-and-add-another', () => {
    fixture.componentInstance.create(true);
    fixture.componentInstance.cancel();

    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('closes with false on cancel when nothing was created', () => {
    fixture.componentInstance.cancel();

    expect(closeSpy).toHaveBeenCalledWith(false);
  });

  it('shows SMTP error when create fails due to mail', () => {
    addExternalPermissionWithNotification.mockReturnValue(
      throwError(() => ({
        error: { message: 'An error occurred while sending a mail' },
      })),
    );

    fixture.componentInstance.create(false);

    expect(toast.error).toHaveBeenCalledWith(
      'Permission could not be created. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
