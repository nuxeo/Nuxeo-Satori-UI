import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  forwardRef,
  input,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { Observable, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { DocumentLayoutFormComponent } from '@agentic-ui/shared/document-layouts';
import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { EditDocumentDialogComponent } from './edit-document-dialog';

const DOC: NuxeoDocument = {
  uid: 'doc-1',
  title: 'Policy 42',
  type: 'File',
  path: '/default-domain/workspaces/ws/doc',
  lastModified: '2026-08-01T00:00:00.000Z',
  properties: { 'dc:title': 'Policy 42' },
};

/**
 * Stands in for the layout form, which has its own spec, under the form's own token so the
 * dialog's `viewChild` finds it. The dialog is tested for what it does with the form's answers.
 */
@Component({
  selector: 'lib-document-layout-form',
  standalone: true,
  template: `<p class="form">{{ mode() }} {{ document()?.uid }} {{ disabled() }}</p>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [
    {
      provide: DocumentLayoutFormComponent,
      useExisting: forwardRef(() => FakeLayoutFormComponent),
    },
  ],
})
class FakeLayoutFormComponent {
  readonly mode = input('');
  readonly document = input<NuxeoDocument | null>(null);
  readonly disabled = input(false);
  readonly headingLevel = input(3);
  readonly ready = signal(true);
  valid = true;
  changes: Record<string, unknown> = { 'dc:title': 'Policy 43' };
  unplaced: string[] = [];
  readonly validate = vi.fn((): boolean => this.valid);
  readonly changedProperties = vi.fn((): Record<string, unknown> => this.changes);
  readonly showServerErrors = vi.fn(
    (_errors: Readonly<Record<string, string>>): string[] => this.unplaced,
  );
}

describe('EditDocumentDialogComponent', () => {
  let fixture: ComponentFixture<EditDocumentDialogComponent>;
  let dialog: EditDocumentDialogComponent;
  let form: FakeLayoutFormComponent;
  const close = vi.fn();
  const updateDocument = vi.fn(
    (_uid: string, _properties: Record<string, unknown>): Observable<NuxeoDocument> =>
      of({ ...DOC, title: 'Policy 43' }),
  );

  const host = (): HTMLElement => fixture.nativeElement;
  const saveButton = (): HTMLButtonElement => {
    const button = host().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')[1];
    if (!button) throw new Error('no Save button');
    return button;
  };
  const alertText = (): string | null =>
    host().querySelector('[role="alert"]')?.querySelector('span')?.textContent?.trim() ?? null;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const clickSave = async () => {
    saveButton().click();
    await settle();
  };
  const failWith = (status: number, error: unknown) =>
    updateDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status, error })));

  beforeEach(async () => {
    close.mockReset();
    updateDocument.mockClear();
    TestBed.configureTestingModule({
      imports: [EditDocumentDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { document: DOC } },
        { provide: BrowseService, useValue: { updateDocument } },
      ],
    });
    TestBed.overrideComponent(EditDocumentDialogComponent, {
      set: {
        imports: [
          FakeLayoutFormComponent,
          MatButtonModule,
          MatDialogModule,
          MatIconModule,
          MatProgressSpinnerModule,
          TranslatePipe,
        ],
      },
    });
    fixture = TestBed.createComponent(EditDocumentDialogComponent);
    dialog = fixture.componentInstance;
    await settle();
    const found = fixture.debugElement.query(
      (el) => el.componentInstance instanceof FakeLayoutFormComponent,
    );
    form = found.componentInstance;
  });

  it("puts the document's edit form under the dialog title", () => {
    expect(host().querySelector('h2')?.textContent?.trim()).toBe('Edit Document');
    expect(host().querySelector('.form')?.textContent?.trim()).toBe('edit doc-1 false');
    expect(alertText()).toBeNull();
  });

  it('sends only what changed and closes with the saved document', async () => {
    await clickSave();
    expect(form.validate).toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalledWith('doc-1', { 'dc:title': 'Policy 43' });
    expect(close).toHaveBeenCalledWith({ ...DOC, title: 'Policy 43' });
  });

  it('locks the form and the buttons while saving, and sends once however often Save is pressed', async () => {
    const pending = new Subject<NuxeoDocument>();
    updateDocument.mockReturnValueOnce(pending);
    await clickSave();
    dialog.save();
    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(host().querySelector('.form')?.textContent?.trim()).toBe('edit doc-1 true');
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().querySelector('mat-spinner')?.getAttribute('aria-label')).toBe('Saving');
    pending.next(DOC);
    await settle();
    expect(close).toHaveBeenCalledWith(DOC);
  });

  it('sends nothing and stays open when the form is not valid', async () => {
    form.valid = false;
    await clickSave();
    expect(updateDocument).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes without a request when nothing changed', async () => {
    form.changes = {};
    await clickSave();
    expect(updateDocument).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith();
  });

  it('does nothing until the form is on screen', async () => {
    form.ready.set(false);
    await clickSave();
    expect(form.validate).not.toHaveBeenCalled();
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("puts Nuxeo's constraint message on the field and says nothing more when the field shows it", async () => {
    failWith(422, {
      'entity-type': 'exception',
      status: 422,
      message: "Constraint violation thrown on property dc:description[0]: 'Too long.'",
    });
    await clickSave();
    expect(form.showServerErrors).toHaveBeenCalledWith({ 'dc:description': 'Too long.' });
    expect(alertText()).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it('reports the messages no field could show, with a fallback for a violation without one', async () => {
    form.unplaced = ['The document is locked.'];
    failWith(400, {
      'entity-type': 'validation_report',
      violations: [
        { message: 'The document is locked.' },
        { path: [{ field_name: 'pol:number' }] },
      ],
    });
    await clickSave();
    expect(form.showServerErrors).toHaveBeenCalledWith({
      '': 'The document is locked.',
      'pol:number': 'Nuxeo did not accept this value.',
    });
    expect(alertText()).toBe('The document is locked.');
  });

  it('says a refused save is a missing permission, not a failure', async () => {
    failWith(403, {
      'entity-type': 'exception',
      status: 403,
      message: 'Privilege WRITE is not granted',
    });
    await clickSave();
    expect(alertText()).toBe('You do not have permission to change this document.');
    expect(form.showServerErrors).not.toHaveBeenCalled();
  });

  it('reports any other failure, keeps the input, and clears the report on the next try', async () => {
    failWith(500, { 'entity-type': 'exception', status: 500, message: 'Boom' });
    await clickSave();
    expect(alertText()).toBe('The changes could not be saved. Try again.');
    expect(close).not.toHaveBeenCalled();

    form.valid = false;
    await clickSave();
    expect(alertText()).toBeNull();
  });
});
