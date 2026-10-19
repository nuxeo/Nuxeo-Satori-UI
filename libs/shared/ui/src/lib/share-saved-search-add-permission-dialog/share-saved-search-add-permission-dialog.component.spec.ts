import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { DocumentDetailService, UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ShareSavedSearchAddPermissionDialogComponent,
  type ShareSavedSearchAddPermissionDialogData,
} from './share-saved-search-add-permission-dialog.component';

describe('Saved-search sharing — principal picker integration', () => {
  let fixture: ComponentFixture<ShareSavedSearchAddPermissionDialogComponent>;
  let search: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  const group = {
    id: 'legal-team',
    displayLabel: 'Legal team',
    type: 'GROUP_TYPE' as const,
    prefixed_id: 'group:legal-team',
  };
  const box = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('nxs-user-group-picker input');
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (text: string): Promise<void> => {
    box().focus();
    box().value = text;
    box().dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
  };
  const pick = async (): Promise<void> => {
    await type('legal');
    const option = document.querySelector<HTMLElement>(
      '.mat-mdc-autocomplete-panel mat-option:not([aria-disabled="true"])',
    );
    expect(option).not.toBeNull();
    option?.click();
    await settle();
  };

  async function render(data: ShareSavedSearchAddPermissionDialogData = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ShareSavedSearchAddPermissionDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: DocumentDetailService, useValue: { searchUsersGroups: search } },
        { provide: UserService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShareSavedSearchAddPermissionDialogComponent);
    await settle();
  }

  beforeEach(() => {
    search = vi.fn(() => of([group]));
    close = vi.fn();
  });
  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('waits for three characters and returns the chosen group label and kind', async () => {
    await render();
    await type('le');
    expect(search).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isSubmitDisabled()).toBe(true);
    await pick();
    expect(search).toHaveBeenCalledWith('legal');
    fixture.componentInstance.create(false);
    expect(close).toHaveBeenCalledWith([
      { userGroup: 'Legal team', right: 'Read', timeFrame: 'Permanent', grantedBy: 'Group' },
    ]);
  });

  it('clears selection when typing and keeps failed searches retryable', async () => {
    await render();
    await pick();
    search.mockReturnValueOnce(throwError(() => new Error('Network')));
    await type('offline');
    expect(fixture.componentInstance.selectedPrincipal()).toBeNull();
    expect(fixture.componentInstance.isSubmitDisabled()).toBe(true);
    fixture.componentInstance.create(false);
    expect(close).not.toHaveBeenCalled();
    await pick();
    expect(fixture.componentInstance.selectedPrincipal()?.id).toBe('legal-team');
  });

  it('clears the picker after create-and-add-another and accumulates entries', async () => {
    await render();
    await pick();
    fixture.componentInstance.create(true);
    await settle();
    expect(box().value).toBe('');
    expect(fixture.componentInstance.isSubmitDisabled()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    await pick();
    fixture.componentInstance.create(false);
    expect(close.mock.calls[0][0]).toHaveLength(2);
  });

  it('keeps an existing principal read-only and preserves its group kind on edit', async () => {
    await render({
      initialData: {
        userGroup: 'Legal team',
        right: 'Edit',
        timeFrame: 'Permanent',
        grantedBy: 'Group',
      },
    });
    expect(fixture.nativeElement.querySelector('nxs-user-group-picker')).toBeNull();
    expect(fixture.nativeElement.querySelector('.user-group-display').textContent).toContain(
      'Legal team',
    );
    fixture.componentInstance.create(false);
    expect(close).toHaveBeenCalledWith([
      { userGroup: 'Legal team', right: 'ReadWrite', timeFrame: 'Permanent', grantedBy: 'Group' },
    ]);
    expect(search).not.toHaveBeenCalled();
  });
});
