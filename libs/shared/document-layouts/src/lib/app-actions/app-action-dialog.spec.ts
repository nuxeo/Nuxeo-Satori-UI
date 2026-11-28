import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { PACKAGED_REGISTRIES } from '@agentic-ui/shared/app-definition';
import {
  AppExtensionsService,
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import { DirectoryService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { of, Subject } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from '../record-page/record-clock';
import {
  AppActionDialogComponent,
  type AppActionDialogData,
  type AppActionOutcome,
} from './app-action-dialog';
import { appActionForm } from './app-action-form';

// The confirmation step of an operation button, with the Payers kit's form drawn by the version 2
// form engine: nothing runs until the form's own checks pass, and what was entered is what is sent.

const CLAIM: NuxeoDocument = {
  uid: 'c1',
  title: 'CLAIM-000130',
  type: 'Claim',
  path: '/claims/c1',
  lastModified: '',
  state: 'inReview',
  properties: { 'claim:number': 'CLAIM-000130' },
};

const FORM = [
  { field: 'var:urgent', label: 'Urgent', widget: 'boolean' },
  { field: 'var:note', label: 'Note', widget: 'long-text', required: true },
];

describe('AppActionDialogComponent', () => {
  let fixture: ComponentFixture<AppActionDialogComponent>;
  let runs: Readonly<Record<string, unknown>>[];
  let answers: Subject<AppActionOutcome>;
  const close = vi.fn();
  const ref = { close, disableClose: false };

  const host = (): HTMLElement => fixture.nativeElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const runButton = () => host().querySelector<HTMLButtonElement>('[data-app-action-run] button');

  async function open(form: boolean): Promise<void> {
    const read = appActionForm(FORM, 'Claim', Object.keys(PACKAGED_REGISTRIES.rules));
    if ('refused' in read) throw new Error(read.refused);
    const data: AppActionDialogData = {
      title: 'Request medical records',
      question: "Ask the provider for this claim's medical records?",
      document: CLAIM,
      form: form ? read.form : null,
      run: (values) => {
        runs.push(values);
        return answers;
      },
    };
    TestBed.configureTestingModule({
      imports: [AppActionDialogComponent, MatIconTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: ref },
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            linkedRecords: () => of(new Map()),
          },
        },
        { provide: AppExtensionsService, useValue: { resolve: () => [] } },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-25T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    fixture = TestBed.createComponent(AppActionDialogComponent);
    await settle();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    runs = [];
    answers = new Subject();
    ref.disableClose = false;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('asks the question, and runs nothing until the form’s required note is entered', async () => {
    await open(true);
    expect(host().querySelector('.lib-app-action__question')?.textContent?.trim()).toBe(
      "Ask the provider for this claim's medical records?",
    );
    expect(host().querySelector('[data-layout-source="version-2"]')).not.toBeNull();
    runButton()?.click();
    await settle();
    expect(runs).toEqual([]);
    expect(host().querySelector('mat-error')).not.toBeNull();

    const note = host().querySelector<HTMLTextAreaElement>('textarea[data-xpath="var:note"]');
    if (!note) throw new Error('no note field');
    note.value = 'Before Friday';
    note.dispatchEvent(new Event('input'));
    note.dispatchEvent(new Event('blur'));
    await settle();
    runButton()?.click();
    await settle();
    expect(runs).toHaveLength(1);
    expect(runs[0]['note']).toBe('Before Friday');
    expect(Object.keys(runs[0]).every((name) => !name.startsWith('var:'))).toBe(true);
    expect(runButton()?.disabled).toBe(true);
    expect(ref.disableClose).toBe(true);

    answers.next({ kind: 'done' });
    await settle();
    expect(close).toHaveBeenCalledWith('done');
  });

  it('keeps a failure on screen, with what was entered, so it can be corrected or cancelled', async () => {
    await open(false);
    runButton()?.click();
    await settle();
    expect(runs).toEqual([{}]);
    answers.next({ kind: 'failed', message: 'You may not run this action on this record.' });
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(host().querySelector('nxs-banner')?.textContent).toContain(
      'You may not run this action on this record.',
    );
    expect(runButton()?.disabled).toBe(false);
    expect(ref.disableClose).toBe(false);
  });

  it('offers no second run when no answer came, since the first may have run', async () => {
    await open(false);
    runButton()?.click();
    await settle();
    answers.next({ kind: 'unknown', message: 'The action may have run.' });
    await settle();
    expect(host().querySelector('nxs-banner')?.textContent).toContain('The action may have run.');
    expect(runButton()?.disabled).toBe(true);
    runButton()?.click();
    await settle();
    expect(runs).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
  });

  describe('drawn with the nxs- components', () => {
    const cancelButton = () =>
      host().querySelector<HTMLButtonElement>('[data-app-action-cancel] button');

    it('is framed as a dialog: its title a level-two heading, then the question, then the buttons', async () => {
      await open(false);
      const title = host().querySelector('nxs-dialog .nxs-dialog__title');
      expect(title?.tagName).toBe('H2');
      expect(title?.textContent?.trim()).toBe('Request medical records');
      expect(
        host().querySelector('.nxs-dialog__content .lib-app-action__question')?.textContent?.trim(),
      ).toBe("Ask the provider for this claim's medical records?");
      expect(
        [...host().querySelectorAll('.nxs-dialog__actions button')].map((button) =>
          button.textContent?.trim(),
        ),
      ).toEqual(['document-layouts.action.cancel', 'Request medical records']);
    });

    it('closes with nothing on Cancel, and runs nothing', async () => {
      await open(true);
      cancelButton()?.click();
      await settle();
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith();
      expect(runs).toEqual([]);
    });

    it('describes the run button by the question, and disables Cancel while it runs', async () => {
      await open(false);
      const question = host().querySelector('.lib-app-action__question');
      expect(runButton()?.getAttribute('aria-describedby')).toBe(question?.id);
      expect(question?.id).toBeTruthy();
      runButton()?.click();
      await settle();
      expect(cancelButton()?.disabled).toBe(true);
      cancelButton()?.click();
      expect(close).not.toHaveBeenCalled();
    });

    it('passes axe at WCAG 2.2 AA, with its form and without', async () => {
      for (const form of [true, false]) {
        await open(form);
        const results = await axe.run(host(), {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
          // jsdom lays nothing out, so contrast cannot be measured here.
          rules: { 'color-contrast': { enabled: false } },
        });
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        TestBed.resetTestingModule();
      }
    });
  });
});
