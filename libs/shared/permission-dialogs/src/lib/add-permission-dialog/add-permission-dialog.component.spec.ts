import { provideZonelessChangeDetection } from '@angular/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  UserService,
  PERMISSION_NOTIFICATION_MAIL_HINT_KEY,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AddPermissionDialogComponent } from './add-permission-dialog';
import { NxsToastService } from '@nuxeo/satori-platform/components';

describe('AddPermissionDialogComponent (NXSAT-159)', () => {
  let fixture: ComponentFixture<AddPermissionDialogComponent>;
  let component: AddPermissionDialogComponent;
  let closeSpy: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let addPermissionWithNotification: ReturnType<typeof vi.fn>;

  const selectedUser = {
    id: 'user-readonly01',
    label: 'Read Only User',
    kind: 'user' as const,
    prefixedId: 'user:user-readonly01',
  };

  beforeEach(async () => {
    closeSpy = vi.fn();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    addPermissionWithNotification = vi
      .fn()
      .mockReturnValue(of({ document: { uid: 'doc-1' }, notificationSent: true }));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), AddPermissionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'doc-1' } },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: DocumentDetailService,
          useValue: {
            searchUsersGroups: vi.fn().mockReturnValue(of([])),
            addPermissionWithNotification,
          },
        },
      ],
    })
      .overrideComponent(AddPermissionDialogComponent, {
        set: { imports: [], providers: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AddPermissionDialogComponent);
    component = fixture.componentInstance;
    component.selectedUser.set(selectedUser);
    component.sendNotify = true;
    component.notifyComment = 'Please review this document';
  });

  it('exposes SMTP mail hint constant', () => {
    expect(component.mailHintKey).toBe(PERMISSION_NOTIFICATION_MAIL_HINT_KEY);
    expect(TestBed.inject(TranslateService).instant(component.mailHintKey)).toContain('SMTP');
  });

  it('creates permission with notification via addPermissionWithNotification', () => {
    component.create(false);

    expect(addPermissionWithNotification).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        username: 'user-readonly01',
        permission: 'Read',
        notify: true,
        comment: 'Please review this document',
      }),
    );
    expect(toast.show).toHaveBeenCalledWith('Permission added and notification sent', {
      duration: 7000,
    });
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('creates permission without notification when checkbox is off', () => {
    component.sendNotify = false;
    addPermissionWithNotification.mockReturnValue(
      of({ document: { uid: 'doc-1' }, notificationSent: false }),
    );

    component.create(false);

    expect(addPermissionWithNotification).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ notify: false, comment: '' }),
    );
    expect([...toast.show.mock.calls, ...toast.error.mock.calls]).toEqual([]);
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('warns when permission is saved but notification email fails', () => {
    addPermissionWithNotification.mockReturnValue(
      of({
        document: { uid: 'doc-1' },
        notificationSent: false,
        notificationErrorKey: 'permissions.notification.mail-send-failed-add',
      }),
    );

    component.create(false);

    expect(toast.show).toHaveBeenCalledWith(
      'Permission was added, but the notification email could not be sent. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
    expect(closeSpy).toHaveBeenCalledWith(true);
  });

  it('resets form and shows snackbar on create-and-add-another', () => {
    component.create(true);

    expect(toast.show).toHaveBeenCalledWith('Permission added and notification sent', {
      duration: 7000,
    });
    expect(component.selectedUser()).toBeNull();
    expect(component.notifyComment).toBe('');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('shows SMTP error when permission creation fails due to mail', () => {
    addPermissionWithNotification.mockReturnValue(
      throwError(() => ({
        error: { message: 'An error occurred while sending a mail' },
      })),
    );

    component.create(false);

    expect(toast.error).toHaveBeenCalledWith(
      'Permission could not be created. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('does not create after the picker clears a selection', () => {
    component.selectedUser.set(null);
    component.create(false);
    expect(addPermissionWithNotification).not.toHaveBeenCalled();
  });

  it('preserves the selected principal for retry after a server error', () => {
    addPermissionWithNotification.mockReturnValue(throwError(() => ({ status: 403 })));
    component.create(false);
    expect(component.selectedUser()).toEqual(selectedUser);
    expect(component.saving()).toBe(false);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('Add permission — rendered principal picker', () => {
  let fixture: ComponentFixture<AddPermissionDialogComponent>;
  const search = vi.fn((_term: string) =>
    of([
      {
        id: 'legal-team',
        displayLabel: 'Legal team',
        type: 'GROUP_TYPE' as const,
        prefixed_id: 'group:legal-team',
      },
    ]),
  );
  const add = vi.fn(() => of({ document: { uid: 'doc-1' }, notificationSent: false }));

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('searches only from three typed characters', async () => {
    vi.clearAllMocks();
    TestBed.overrideProvider(NxsToastService, { useValue: { show: vi.fn(), error: vi.fn() } });
    await TestBed.configureTestingModule({
      imports: [AddPermissionDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'doc-1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DocumentDetailService,
          useValue: { searchUsersGroups: search, addPermissionWithNotification: add },
        },
        { provide: UserService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AddPermissionDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const box: HTMLInputElement = fixture.nativeElement.querySelector(
      'nxs-user-group-picker input',
    );
    const typeText = async (text: string): Promise<void> => {
      box.focus();
      box.value = text;
      box.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 350));
      fixture.detectChanges();
      await fixture.whenStable();
    };

    await typeText('le');
    expect(search).not.toHaveBeenCalled();
    await typeText('leg');
    expect(search.mock.calls[0]?.[0]).toBe('leg');
  });

  it('sends the selected raw group id and clears the form, error-free, after create-and-add-another', async () => {
    vi.clearAllMocks();
    TestBed.overrideProvider(NxsToastService, { useValue: { show: vi.fn(), error: vi.fn() } });
    await TestBed.configureTestingModule({
      imports: [AddPermissionDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'doc-1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DocumentDetailService,
          useValue: { searchUsersGroups: search, addPermissionWithNotification: add },
        },
        { provide: UserService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AddPermissionDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const box: HTMLInputElement = fixture.nativeElement.querySelector(
      'nxs-user-group-picker input',
    );
    box.focus();
    box.value = 'legal';
    box.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    const option = document.querySelector<HTMLElement>(
      '.mat-mdc-autocomplete-panel mat-option:not([aria-disabled="true"])',
    );
    expect(option).not.toBeNull();
    option?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedUser()?.kind).toBe('group');
    // Leaving the picker for the button touches it.
    box.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    fixture.componentInstance.create(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(add).toHaveBeenCalledWith('doc-1', expect.objectContaining({ username: 'legal-team' }));
    expect(fixture.componentInstance.selectedUser()).toBeNull();
    expect(box.value).toBe('');
    // Emptied for the next entry, not flagged as a missed required field.
    expect(
      fixture.nativeElement.querySelector('nxs-user-group-picker .mat-form-field-invalid'),
    ).toBeNull();
  });
});
