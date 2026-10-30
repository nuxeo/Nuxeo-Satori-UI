import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AdminUserDetailsPageComponent } from './admin-user-details-page.component';

describe('AdminUserDetailsPageComponent', () => {
  let fixture: ComponentFixture<AdminUserDetailsPageComponent>;
  const navigate = vi.fn(() => Promise.resolve(true));

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AdminUserDetailsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        {
          provide: UserService,
          useValue: {
            getUser: () => of({ id: 'jdoe', properties: { groups: [] } }),
            getGroup: () => of({}),
          },
        },
        {
          provide: PrincipalPermissionsService,
          useValue: {
            listLocalPermissionRows: () =>
              of({
                rows: [],
                totalDocuments: 0,
                numberOfPages: 0,
                currentPageIndex: 0,
                currentPageSize: 0,
              }),
          },
        },
        { provide: DocumentDetailService, useValue: { removePermission: () => of({}) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminUserDetailsPageComponent);
    fixture.componentRef.setInput('userId', 'jdoe');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the packaged page for the username the route supplies', () => {
    expect(fixture.nativeElement.querySelector('nxs-admin-user-details-page')).not.toBeNull();
  });

  it('routes onward when a group or a document is chosen, and back to the list when deleted', () => {
    const page = fixture.componentInstance as unknown as {
      callbacks: {
        deleted(): void;
        groupChosen(g: string): void;
        documentChosen(d: string): void;
      };
    };
    page.callbacks.groupChosen('editors');
    page.callbacks.documentChosen('doc-1');
    page.callbacks.deleted();
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/group', 'editors']);
    expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-1']);
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups']);
  });
});
