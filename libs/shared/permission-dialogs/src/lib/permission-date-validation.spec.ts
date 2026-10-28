import { provideZonelessChangeDetection, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { DocumentDetailService, UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AddPermissionDialogComponent } from './add-permission-dialog/add-permission-dialog';
import { UpdatePermissionDialogComponent } from './update-permission-dialog/update-permission-dialog';

describe.each([
  { name: 'add', component: AddPermissionDialogComponent },
  { name: 'update', component: UpdatePermissionDialogComponent },
])('Permission date validation in the real $name dialog', ({ name, component: type }) => {
  it('blocks malformed From text in the button and the direct write guard, then accepts a date', async () => {
    const write = vi.fn(() => of({ document: { uid: 'doc-1' }, notificationSent: false }));
    await TestBed.configureTestingModule({
      imports: [type, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            documentUid: 'doc-1',
            isExternal: false,
            ace: {
              id: 'ace-1',
              username: 'user-1',
              permission: 'Read',
              granted: true,
              creator: 'Administrator',
              begin: null,
              end: null,
            },
          },
        },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DocumentDetailService,
          useValue: {
            searchUsersGroups: () => of([]),
            addPermissionWithNotification: write,
            replacePermissionWithNotification: write,
          },
        },
        { provide: UserService, useValue: {} },
      ],
    }).compileComponents();
    TestBed.overrideProvider(NxsToastService, { useValue: { show: vi.fn(), error: vi.fn() } });
    const fixture = TestBed.createComponent(type as Type<unknown>);
    const component = fixture.componentInstance as
      AddPermissionDialogComponent | UpdatePermissionDialogComponent;
    component.timeFrame = 'date-based';
    if (component instanceof AddPermissionDialogComponent)
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
    const save = () =>
      name === 'add'
        ? (component as AddPermissionDialogComponent).create(false)
        : (component as UpdatePermissionDialogComponent).update();
    save();
    expect(write).not.toHaveBeenCalled();
    input.value = '12/31/2027';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(button.disabled).toBe(false);
    save();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
