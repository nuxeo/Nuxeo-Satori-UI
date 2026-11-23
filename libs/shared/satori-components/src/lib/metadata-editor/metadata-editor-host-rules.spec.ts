import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DirectoryService } from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';

import { NxsMetadataEditorComponent } from './metadata-editor.component';
import type { NxsEditorField, NxsEditorSection, NxsEditorValues } from './metadata-editor.model';

// What a host whose own rules and checks read the form needs of the editor: fields it shows
// read-only, messages from its own checks, and the values as they are entered. A version 2 layout
// file's form is such a host (libs/shared/document-layouts, `form-view.ts`).

const VALUES: NxsEditorValues = {
  'claim:status': 'open',
  'claim:amount': 1200,
  'claim:start': '2026-03-10T00:00:00.000Z',
  'claim:end': '2026-03-12T00:00:00.000Z',
  'claim:notes': 'Line one',
};

const AMOUNT: NxsEditorField = {
  xpath: 'claim:amount',
  label: 'Amount',
  definition: { type: 'double' },
};

const section = (...fields: NxsEditorField[]): NxsEditorSection => ({
  id: 'claim',
  heading: 'Claim',
  fields,
});

@Component({
  standalone: true,
  imports: [NxsMetadataEditorComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-metadata-editor
      [sections]="sections()"
      [values]="values()"
      [dublinCore]="false"
      [fieldErrors]="fieldErrors()"
      [disabled]="disabled()"
      (validChange)="validity.push($event)"
      (valuesChange)="entered.push($event)"
    />
  `,
})
class HostComponent {
  readonly sections = signal<readonly NxsEditorSection[]>([
    section({ xpath: 'claim:status', label: 'Status', definition: { type: 'string' } }, AMOUNT, {
      xpath: 'claim:end',
      label: 'Service end',
      definition: { type: 'date' },
    }),
  ]);
  readonly values = signal<NxsEditorValues>(VALUES);
  readonly fieldErrors = signal<Readonly<Record<string, string>>>({});
  readonly disabled = signal(false);
  readonly editor = viewChild.required(NxsMetadataEditorComponent);
  readonly validity: boolean[] = [];
  readonly entered: NxsEditorValues[] = [];
}

describe('NxsMetadataEditorComponent, for a host with rules and checks of its own', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const field = <T extends HTMLElement = HTMLInputElement>(xpath: string): T | null => {
    const found = element.querySelector<T>(`[data-xpath="${xpath}"]`);
    return (found?.tagName === 'NXS-DATE-INPUT' ? found.querySelector('input') : found) as T | null;
  };
  const type = async (xpath: string, text: string) => {
    const input = field<HTMLInputElement | HTMLTextAreaElement>(xpath);
    if (!input) throw new Error(`no field ${xpath}`);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  };
  const errors = () =>
    [...element.querySelectorAll('mat-error, .nxs-metadata-editor__error, nxs-date-input')]
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => text !== '');
  const readOnly = (xpath: string) =>
    element.querySelector<HTMLElement>(`.nxs-metadata-editor__read-only[data-xpath="${xpath}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    await settle();
  });

  describe('a field listed read-only', () => {
    it('shows the text the host gives, never sends the value, and is never checked', async () => {
      host.sections.set([
        section({
          ...AMOUNT,
          definition: { type: 'double', required: true },
          readOnly: true,
          readOnlyText: '$1,200.00',
        }),
      ]);
      host.values.set({ ...VALUES, 'claim:amount': null });
      await settle();
      expect(readOnly('claim:amount')?.textContent).toContain('$1,200.00');
      expect(element.querySelector('input[data-xpath="claim:amount"]')).toBeNull();
      // Required, and empty, but read-only: nothing the person can fix stops the save.
      expect(host.editor().validate()).toBe(true);
      expect(host.editor().properties()).toEqual({});
    });

    it('shows its own text of the value when the host gives none', async () => {
      host.sections.set([section({ ...AMOUNT, readOnly: true })]);
      await settle();
      expect(readOnly('claim:amount')?.textContent).toContain('1200');
    });

    it('goes back to the document’s value when it turns read-only, and starts from it again after', async () => {
      await type('claim:amount', '900');
      expect(host.editor().dirtyProperties()).toEqual({ 'claim:amount': 900 });
      host.sections.set([section({ ...AMOUNT, readOnly: true })]);
      await settle();
      expect(readOnly('claim:amount')?.textContent).toContain('1200');
      expect(host.editor().dirtyProperties()).toEqual({});
      host.sections.set([section(AMOUNT)]);
      await settle();
      expect(field('claim:amount')?.value).toBe('1200');
      expect(host.editor().dirtyProperties()).toEqual({});
    });

    it('stays read-only when the form is enabled again after saving', async () => {
      host.sections.set([section({ ...AMOUNT, readOnly: true }, { ...AMOUNT, xpath: 'x:y' })]);
      host.disabled.set(true);
      await settle();
      host.disabled.set(false);
      await settle();
      expect(readOnly('claim:amount')).not.toBeNull();
      expect(host.editor().properties()).toEqual({ 'x:y': null });
    });

    it('is not held to a host message after saving either: there is nothing to correct', async () => {
      host.sections.set([section({ ...AMOUNT, readOnly: true }, { ...AMOUNT, xpath: 'x:y' })]);
      host.fieldErrors.set({ 'claim:amount': 'Too much' });
      await settle();
      expect(host.editor().validate()).toBe(true);
      // Saving disables the whole form, and enabling it again must leave the field read-only.
      host.disabled.set(true);
      await settle();
      host.disabled.set(false);
      await settle();
      expect(host.editor().validate()).toBe(true);
    });

    it('hands back a server message for it, which it could not show', async () => {
      host.sections.set([section({ ...AMOUNT, readOnly: true })]);
      await settle();
      expect(host.editor().showServerErrors({ 'claim:amount': 'Too large' })).toEqual([
        'Too large',
      ]);
    });

    it('is one control with any other listing of it, read-only when one says so', async () => {
      host.sections.set([
        section(AMOUNT),
        { id: 'again', heading: 'Again', fields: [{ ...AMOUNT, readOnly: true }] },
      ]);
      await settle();
      expect(element.querySelectorAll('.nxs-metadata-editor__read-only')).toHaveLength(2);
      expect(element.querySelector('input[data-xpath="claim:amount"]')).toBeNull();
    });
  });

  describe('a message from the host’s own check', () => {
    it('shows beside its field, stops the save, and lapses when the host clears it', async () => {
      host.fieldErrors.set({ 'claim:amount': 'No more than the billed amount' });
      await settle();
      expect(validityNow()).toBe(false);
      expect(host.editor().validate()).toBe(false);
      await settle();
      expect(errors()).toContain('No more than the billed amount');
      host.fieldErrors.set({});
      await settle();
      expect(validityNow()).toBe(true);
      expect(host.editor().validate()).toBe(true);
      expect(errors()).not.toContain('No more than the billed amount');
    });

    it('shows on a date field too', async () => {
      host.fieldErrors.set({ 'claim:end': 'Service end cannot be before Service start.' });
      await settle();
      host.editor().validate();
      await settle();
      expect(
        element.querySelector('nxs-date-input[data-xpath="claim:end"]')?.textContent,
      ).toContain('Service end cannot be before Service start.');
    });

    it('comes after the schema’s own checks', async () => {
      host.sections.set([section({ ...AMOUNT, definition: { type: 'double', required: true } })]);
      host.fieldErrors.set({ 'claim:amount': 'Too much' });
      await settle();
      await type('claim:amount', '');
      host.editor().validate();
      await settle();
      expect(errors()).toContain('Amount is required.');
      expect(errors()).not.toContain('Too much');
    });

    function validityNow(): boolean | undefined {
      return host.validity.at(-1);
    }
  });

  describe('the values being entered', () => {
    it('are given once when the form is built, then each time one changes, never twice the same', async () => {
      expect(host.entered).toHaveLength(1);
      expect(host.entered[0]).toEqual({
        'claim:status': 'open',
        'claim:amount': 1200,
        'claim:end': '2026-03-12T00:00:00.000Z',
      });
      await type('claim:status', 'closed');
      expect(host.entered.at(-1)?.['claim:status']).toBe('closed');
      const count = host.entered.length;
      await type('claim:status', 'closed');
      expect(host.entered).toHaveLength(count);
    });

    it('follow the set of fields: a field no longer listed is no longer given', async () => {
      host.sections.set([section(AMOUNT)]);
      await settle();
      expect(host.entered.at(-1)).toEqual({ 'claim:amount': 1200 });
    });
  });

  it('gives a multi-line field the rows asked for, and two otherwise', async () => {
    host.sections.set([
      section(
        {
          xpath: 'claim:notes',
          label: 'Notes',
          definition: { type: 'string' },
          multiline: true,
          rows: 6,
        },
        { xpath: 'claim:other', label: 'Other', definition: { type: 'string' }, multiline: true },
      ),
    ]);
    await settle();
    expect(field<HTMLTextAreaElement>('claim:notes')?.rows).toBe(6);
    expect(field<HTMLTextAreaElement>('claim:other')?.rows).toBe(2);
  });
});
