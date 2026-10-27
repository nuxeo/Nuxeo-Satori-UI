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

  it('waits for three characters and returns the chosen group id, not its label', async () => {
    await render();
    await type('le');
    expect(search).not.toHaveBeenCalled();
    expect(fixture.componentInstance.isSubmitDisabled()).toBe(true);
    await pick();
    expect(search).toHaveBeenCalledWith('legal');
    fixture.componentInstance.create(false);
    expect(close).toHaveBeenCalledWith([
      { userGroup: 'legal-team', right: 'Read', timeFrame: 'Permanent', grantedBy: 'Group' },
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

  it('clears the picker, error-free, after create-and-add-another and accumulates entries', async () => {
    await render();
    await pick();
    // Leaving the picker for the button touches it.
    box().dispatchEvent(new FocusEvent('blur'));
    fixture.componentInstance.create(true);
    await settle();
    expect(box().value).toBe('');
    expect(
      fixture.nativeElement.querySelector('nxs-user-group-picker .mat-form-field-invalid'),
    ).toBeNull();
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

  const values = (dialog: ShareSavedSearchAddPermissionDialogComponent) =>
    dialog.rightOptions.map((option) => option.value);

  it("offers the saved search's own list, which has no Can collect", async () => {
    await render({ permissions: ['Read', 'ReadWrite', 'Everything'] });
    const dialog = fixture.componentInstance;
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything']);
    expect(dialog.rightOptions.map((option) => option.label)).toEqual([
      'Read',
      'Edit',
      'Manage everything',
    ]);
  });

  it('offers whatever the server lists for the type rather than a fixed list', async () => {
    await render({ permissions: ['Read', 'ReadCanCollect', 'ReadWrite', 'Everything'] });
    expect(values(fixture.componentInstance)).toEqual([
      'Read',
      'ReadCanCollect',
      'ReadWrite',
      'Everything',
    ]);
  });

  it('starts a new entry on the first right offered when Read is absent', async () => {
    await render({ permissions: ['ReadWrite', 'Everything'] });
    expect(fixture.componentInstance.right).toBe('ReadWrite');
  });

  it('resets to the first offered right and clears the picker after adding another', async () => {
    await render({ permissions: ['ReadWrite', 'Everything'] });
    await pick();
    const dialog = fixture.componentInstance;
    dialog.right = 'Everything';
    dialog.create(true);
    await settle();
    expect(dialog.right).toBe('ReadWrite');
    expect(dialog.selectedPrincipal()).toBeNull();
    expect(box().value).toBe('');
    expect(close).not.toHaveBeenCalled();
  });

  it('disables submission when the selected right is not offered', async () => {
    await render({ permissions: ['ReadWrite', 'Everything'] });
    await pick();
    const dialog = fixture.componentInstance;
    expect(dialog.isSubmitDisabled()).toBe(false);
    dialog.right = 'Read';
    expect(dialog.isSubmitDisabled()).toBe(true);
  });

  it('does not create an entry for a right the server does not offer', async () => {
    await render({ permissions: ['ReadWrite', 'Everything'] });
    await pick();
    fixture.componentInstance.right = 'Read';
    fixture.componentInstance.create(false);
    expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance.saving()).toBe(false);
  });

  it("falls back to Nuxeo's default three when the read carried no list", async () => {
    await render();
    expect(values(fixture.componentInstance)).toEqual(['Read', 'ReadWrite', 'Everything']);
  });

  it("keeps an edited entry's permission when the type no longer offers it", async () => {
    await render({
      permissions: ['Read', 'ReadWrite', 'Everything'],
      initialData: { userGroup: 'members', right: 'ReadCanCollect', timeFrame: 'Permanent' },
    });
    const dialog = fixture.componentInstance;
    expect(dialog.right).toBe('ReadCanCollect');
    expect(values(dialog)).toEqual(['Read', 'ReadWrite', 'Everything', 'ReadCanCollect']);
  });

  it('falls back to Read when an empty permissions list is provided', async () => {
    await render({ permissions: [] });
    expect(fixture.componentInstance.right).toBe('Read');
    expect(values(fixture.componentInstance)).toEqual(['Read', 'ReadWrite', 'Everything']);
  });

  it('translates each offered right label', async () => {
    await render({ permissions: ['Read', 'Everything'] });
    expect(fixture.componentInstance.rightOptions).toEqual([
      { value: 'Read', label: 'Read' },
      { value: 'Everything', label: 'Manage everything' },
    ]);
  });
});
