import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NxsToastService } from '../toast/toast.service';
import {
  NxsCreateVersionDialogComponent,
  type NxsCreateVersionDialogData,
} from './create-version-dialog.component';

const DATA: NxsCreateVersionDialogData = {
  documentUid: 'doc-1',
  documentTitle: 'Contract',
  major: 1,
  minor: 2,
};

describe('NxsCreateVersionDialogComponent', () => {
  let fixture: ComponentFixture<NxsCreateVersionDialogComponent>;
  let documents: { createVersion: ReturnType<typeof vi.fn> };
  let ref: { close: ReturnType<typeof vi.fn> };
  let shown: ReturnType<typeof vi.spyOn>;
  let failed: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement;
  const radios = (): HTMLInputElement[] => [
    ...el().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
  const createButton = (): HTMLButtonElement =>
    el().querySelector('.nxs-create-version-dialog__create') as HTMLButtonElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    documents = { createVersion: vi.fn(() => of({ uid: 'v-2-0' } as NuxeoDocument)) };
    ref = { close: vi.fn() };
    shown = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    failed = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [NxsCreateVersionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: documents },
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: ref },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsCreateVersionDialogComponent);
    await settle();
  });

  afterEach(() => vi.restoreAllMocks());

  it('names the document and its current version in the title, as Web UI', () => {
    expect(el().querySelector('h2')?.textContent?.trim()).toBe(
      'Create Version for Contract - Version 1.2',
    );
  });

  it('offers the next minor and the next major number, with Major chosen first', () => {
    const labels = [...el().querySelectorAll('mat-radio-button')].map((r) =>
      r.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(['1.3 Minor version', '2.0 Major version']);
    expect(radios().map((r) => r.checked)).toEqual([false, true]);
    expect(el().querySelector('mat-radio-group')?.getAttribute('aria-label')).toBe(
      'Version to create',
    );
  });

  it('creates a major version, says so, and closes with it', async () => {
    createButton().click();
    await settle();
    expect(documents.createVersion).toHaveBeenCalledWith('doc-1', 'Major');
    expect(shown).toHaveBeenCalledWith('Version 2.0 created');
    expect(ref.close).toHaveBeenCalledWith({ uid: 'v-2-0' });
  });

  it('creates the minor version when Minor is chosen', async () => {
    radios()[0].click();
    await settle();
    createButton().click();
    await settle();
    expect(documents.createVersion).toHaveBeenCalledWith('doc-1', 'Minor');
    expect(shown).toHaveBeenCalledWith('Version 1.3 created');
  });

  it('sends one request while one is in flight, and shows it is working', async () => {
    const pending = new Subject<NuxeoDocument>();
    documents.createVersion.mockReturnValue(pending);
    createButton().click();
    await settle();
    expect(createButton().disabled).toBe(true);
    expect(createButton().querySelector('[role="progressbar"]')).toBeNull();
    expect(createButton().querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(createButton().textContent?.replace('autorenew', '').trim()).toBe(
      'Creating the version',
    );
    createButton().click();
    expect(documents.createVersion).toHaveBeenCalledTimes(1);
  });

  it('says a refusal is a refusal, and stays open for another try', async () => {
    documents.createVersion.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    createButton().click();
    await settle();
    expect(failed).toHaveBeenCalledWith(
      'You do not have permission to create a version of this document.',
    );
    expect(ref.close).not.toHaveBeenCalled();
    expect(createButton().disabled).toBe(false);
  });

  it('reports any other failure as one', async () => {
    documents.createVersion.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    createButton().click();
    await settle();
    expect(failed).toHaveBeenCalledWith('The version could not be created.');
    expect(ref.close).not.toHaveBeenCalled();
  });
});
