import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';

import {
  NxsChangePasswordDialogComponent,
  type NxsChangePasswordDialogData,
} from './change-password-dialog.component';

describe('NxsChangePasswordDialogComponent', () => {
  let fixture: ComponentFixture<NxsChangePasswordDialogComponent>;
  const close = vi.fn();

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const inputs = (): HTMLInputElement[] => Array.from(el().querySelectorAll('input'));
  const save = (): HTMLButtonElement =>
    el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const cancel = (): HTMLButtonElement => el().querySelectorAll('button')[0] as HTMLButtonElement;
  const mismatch = (): boolean => el().querySelector('[role="alert"]') !== null;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(index: number, value: string): Promise<void> {
    inputs()[index].value = value;
    inputs()[index].dispatchEvent(new Event('input'));
    await render();
  }

  async function create(data: NxsChangePasswordDialogData = { username: 'jdoe' }): Promise<void> {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NxsChangePasswordDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsChangePasswordDialogComponent);
    await render();
  }

  beforeEach(() => create());

  it('names the account whose password changes', () => {
    expect(el().querySelector('strong')?.textContent?.trim()).toBe('jdoe');
  });

  it('keeps Set password off until both fields are filled and match', async () => {
    expect(save().disabled).toBe(true);
    await type(0, 'secret-1');
    expect(save().disabled).toBe(true);
    await type(1, 'secret-1');
    expect(save().disabled).toBe(false);
  });

  it('says the fields differ once the confirmation is typed', async () => {
    await type(0, 'secret-1');
    expect(mismatch()).toBe(false);
    await type(1, 'secret-2');
    expect(mismatch()).toBe(true);
    expect(save().disabled).toBe(true);
  });

  it('refuses a blank password, whitespace included, even if submitted', async () => {
    await type(0, '   ');
    await type(1, '   ');
    expect(save().disabled).toBe(true);
    // The button is disabled, so the guard in save() is what must hold if the form is submitted.
    (fixture.componentInstance as unknown as { save(): void }).save();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the password trimmed, and nothing else', async () => {
    await type(0, ' secret-1 ');
    await type(1, 'secret-1');
    save().click();
    expect(close).toHaveBeenCalledWith('secret-1');
  });

  it('closes with nothing when cancelled', () => {
    cancel().click();
    expect(close).toHaveBeenCalledWith();
  });
});
