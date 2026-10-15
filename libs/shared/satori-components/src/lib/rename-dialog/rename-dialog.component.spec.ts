import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NxsRenameDialogComponent, type NxsRenameDialogData } from './rename-dialog.component';

describe('NxsRenameDialogComponent', () => {
  let fixture: ComponentFixture<NxsRenameDialogComponent>;
  const close = vi.fn();
  const updateDocument = vi.fn();

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => el().querySelector('input') as HTMLInputElement;
  const save = (): HTMLButtonElement =>
    el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const alert = (): string | undefined => el().querySelector('[role="alert"]')?.textContent?.trim();

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await render();
  }

  async function create(data: NxsRenameDialogData = { documentId: 'doc-1', title: 'Report' }) {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NxsRenameDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: BrowseService, useValue: { updateDocument } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsRenameDialogComponent);
    await render();
  }

  beforeEach(() => create());

  it('starts from the title, with Rename off until it changes', () => {
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Rename');
    expect(input().value).toBe('Report');
    expect(save().disabled).toBe(true);
  });

  it('refuses a blank title, whitespace included', async () => {
    await type('   ');
    expect(save().disabled).toBe(true);
  });

  it('writes the trimmed title to dc:title and closes with the updated document', async () => {
    const updated = { uid: 'doc-1', title: 'Annual report' } as NuxeoDocument;
    updateDocument.mockReturnValue(of(updated));
    await type('  Annual report ');
    save().click();
    await render();
    expect(updateDocument).toHaveBeenCalledWith('doc-1', { 'dc:title': 'Annual report' });
    expect(close).toHaveBeenCalledWith(updated);
  });

  it('cannot be submitted twice while saving', async () => {
    const pending = new Subject<NuxeoDocument>();
    updateDocument.mockReturnValue(pending);
    await type('Annual report');
    save().click();
    await render();
    expect(save().disabled).toBe(true);
    save().click();
    expect(updateDocument).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'You do not have permission to rename this document.'],
    [409, 'This document is locked by someone else, so it cannot be renamed now.'],
    [404, 'This document no longer exists.'],
    [500, 'The title could not be changed. Try again in a moment.'],
  ])('stays open and says why after a %i', async (status, message) => {
    updateDocument.mockReturnValue(throwError(() => ({ status })));
    await type('Annual report');
    save().click();
    await render();
    expect(alert()).toBe(message);
    expect(close).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });

  it('closes with nothing on Cancel', async () => {
    (el().querySelector('button[type="button"]') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith();
    expect(updateDocument).not.toHaveBeenCalled();
  });
});
