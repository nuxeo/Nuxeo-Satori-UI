import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';

import { SavedSearchDialogComponent } from './saved-search-dialog.component';

describe('SavedSearchDialogComponent', () => {
  let fixture: ComponentFixture<SavedSearchDialogComponent>;
  const close = vi.fn();

  async function open(data: Record<string, string> = {}): Promise<void> {
    close.mockClear();
    await TestBed.configureTestingModule({
      imports: [SavedSearchDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SavedSearchDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const box = () => el().querySelector('input') as HTMLInputElement;
  const saveButton = () =>
    [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Save')) as
      HTMLButtonElement | undefined;

  async function type(value: string): Promise<void> {
    box().value = value;
    box().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('saves the trimmed name, on the button or on Enter', async () => {
    await open({ title: 'Saved Search' });
    expect(saveButton()?.disabled).toBe(true);

    await type('  Q3 contracts  ');
    expect(saveButton()?.disabled).toBe(false);
    saveButton()?.click();
    expect(close).toHaveBeenCalledWith('Q3 contracts');

    close.mockClear();
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(close).toHaveBeenCalledWith('Q3 contracts');
  });

  it('starts from the name it is given, for a rename', async () => {
    await open({ initialValue: 'Old name' });
    expect(box().value).toBe('Old name');
  });

  it('refuses a blank name', async () => {
    await open();
    await type('   ');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(close).not.toHaveBeenCalled();
  });

  it('refuses a name with a slash, says why, and ties the message to the box', async () => {
    await open();
    await type('Q3/contracts');

    expect(saveButton()?.disabled).toBe(true);
    const message = el().querySelector('#saved-search-dialog-error');
    expect(message?.textContent?.trim()).toBe("You cannot use the character '/' in the name");
    expect(message?.getAttribute('role')).toBe('alert');
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(box().getAttribute('aria-describedby')).toBe('saved-search-dialog-error');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(close).not.toHaveBeenCalled();

    await type('Q3 contracts');
    expect(el().querySelector('#saved-search-dialog-error')).toBeNull();
    expect(box().getAttribute('aria-invalid')).toBe('false');
    expect(box().hasAttribute('aria-describedby')).toBe(false);
  });
});
