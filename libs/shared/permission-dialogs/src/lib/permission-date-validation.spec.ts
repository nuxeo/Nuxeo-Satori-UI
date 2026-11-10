import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { DocumentDetailService, UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AddPermissionDialogComponent } from './add-permission-dialog/add-permission-dialog';

describe('Permission date validation in the real add dialog', () => {
  it('blocks malformed From text in the button and the direct write guard, then accepts a date', async () => {
    const write = vi.fn(() => of({ document: { uid: 'doc-1' }, notificationSent: false }));
    await TestBed.configureTestingModule({
      imports: [AddPermissionDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'doc-1' } },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DocumentDetailService,
          useValue: {
            searchUsersGroups: () => of([]),
            addPermissionWithNotification: write,
          },
        },
        { provide: UserService, useValue: {} },
      ],
    }).compileComponents();
    TestBed.overrideProvider(NxsToastService, { useValue: { show: vi.fn(), error: vi.fn() } });
    const fixture = TestBed.createComponent(AddPermissionDialogComponent);
    const component = fixture.componentInstance;
    component.timeFrame = 'date-based';
    component.selectedUser.set({
      id: 'user-1',
      label: 'User',
      kind: 'user',
      prefixedId: 'user:user-1',
    });
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'nxs-date-input input',
    ) as HTMLInputElement;
    input.value = 'not-a-date';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[mat-flat-button]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    component.create(false);
    expect(write).not.toHaveBeenCalled();
    input.value = '12/31/2027';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(button.disabled).toBe(false);
    component.create(false);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
