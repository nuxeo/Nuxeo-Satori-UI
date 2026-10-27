import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { vi } from 'vitest';

import { NxsConfirmDialogComponent, type NxsConfirmDialogData } from './confirm-dialog.component';

const DATA: NxsConfirmDialogData = {
  title: 'Delete user',
  message: 'Delete user "jdoe"? This cannot be undone.',
  confirmLabel: 'Delete',
};

describe('NxsConfirmDialogComponent', () => {
  let fixture: ComponentFixture<NxsConfirmDialogComponent>;
  const close = vi.fn();

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (text: string): HTMLButtonElement =>
    Array.from(el().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NxsConfirmDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: DATA },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', {
      'satori-components.confirm-dialog.cancel': 'Cancel',
    });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsConfirmDialogComponent);
    fixture.detectChanges();
  });

  it('shows the title and the question it was given', () => {
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Delete user');
    expect(el().querySelector('.nxs-confirm-dialog__message')?.textContent?.trim()).toBe(
      'Delete user "jdoe"? This cannot be undone.',
    );
  });

  it('closes with true when the user confirms', () => {
    button('Delete').click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('closes with nothing when the user cancels', () => {
    button('Cancel').click();
    expect(close).not.toHaveBeenCalledWith(true);
  });
});
