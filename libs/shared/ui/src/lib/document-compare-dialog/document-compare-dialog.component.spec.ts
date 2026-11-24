import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  DocumentCompareDialogComponent,
  type DocumentCompareDialogData,
} from './document-compare-dialog.component';

const doc = (uid: string, properties: Record<string, unknown>): NuxeoDocument =>
  ({
    uid,
    title: String(properties['dc:title'] ?? uid),
    type: 'File',
    properties,
  }) as NuxeoDocument;

const contractV1 = doc('d1', {
  'dc:title': 'Contract v1',
  'dc:coverage': 'EU',
  'common:icon': '/icons/file.gif',
});
const contractV2 = doc('d2', {
  'dc:title': 'Contract v2',
  'dc:coverage': 'EU',
  'common:icon': '/icons/note.gif',
});
const contractV3 = doc('d3', {
  'dc:title': 'Contract v3',
  'dc:coverage': 'EU',
  'common:icon': '/icons/file.gif',
});

const ITEMS: DocumentCompareDialogData['items'] = [
  { id: 'd1', name: 'Contract v1' },
  { id: 'd2', name: 'Contract v2' },
  { id: 'd3', name: 'Contract v3' },
];

/**
 * Bulk "Compare" opens this dialog over the selected documents. It reads two of them in full
 * and lays their metadata side by side, or as one unified list of what changed.
 */
describe('DocumentCompareDialogComponent', () => {
  let fixture: ComponentFixture<DocumentCompareDialogComponent>;
  let component: DocumentCompareDialogComponent;
  let reads: Map<string, Subject<NuxeoDocument>>;
  let getFullDocument: ReturnType<typeof vi.fn>;

  async function open(items: DocumentCompareDialogData['items'] = ITEMS): Promise<void> {
    reads = new Map();
    getFullDocument = vi.fn((uid: string) => {
      const read = new Subject<NuxeoDocument>();
      reads.set(uid, read);
      return read;
    });
    await TestBed.configureTestingModule({
      imports: [DocumentCompareDialogComponent],
      providers: [
        provideNoopAnimations(),
        // The icon rows' images fetch through HttpClient; nothing here answers them.
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: MAT_DIALOG_DATA, useValue: { items } satisfies DocumentCompareDialogData },
        { provide: DocumentDetailService, useValue: { getFullDocument } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentCompareDialogComponent);
    component = fixture.componentInstance;
    await settle();
  }

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const answer = (...docs: NuxeoDocument[]) => {
    for (const d of docs) {
      const read = reads.get(d.uid);
      if (!read) throw new Error(`${d.uid} was not read`);
      read.next(d);
      read.complete();
    }
  };
  const text = (selector: string): string | undefined =>
    fixture.nativeElement.querySelector(selector)?.textContent?.trim();
  /** Each row's label and the values shown for it, in order. */
  const rows = (): { label: string; values: string[] }[] =>
    [...fixture.nativeElement.querySelectorAll('.compare-field-row')].map((row: Element) => ({
      label: row.querySelector('.compare-field-label')?.textContent?.trim() ?? '',
      values: [...row.querySelectorAll('.compare-field-value')].map(
        (v) => v.textContent?.trim() ?? '',
      ),
    }));
  const row = (label: string) => rows().find((r) => r.label === label);

  it('reads the first two documents it was opened with, showing a spinner meanwhile', async () => {
    await open();

    expect(getFullDocument.mock.calls.map(([uid]) => uid)).toEqual(['d1', 'd2']);
    expect(component.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('nxs-spinner')).not.toBeNull();

    answer(contractV1, contractV2);
    await settle();

    expect(component.loading()).toBe(false);
    expect(fixture.nativeElement.querySelector('nxs-spinner')).toBeNull();
  });

  it('lays the two side by side, marking the values that differ', async () => {
    await open();
    answer(contractV1, contractV2);
    await settle();

    expect(row('title')?.values).toEqual(['Contract v1', 'Contract v2']);
    const changed = [
      ...fixture.nativeElement.querySelectorAll('.compare-field-value--changed'),
    ].map((v: Element) => v.textContent?.trim());
    expect(changed).toEqual(expect.arrayContaining(['Contract v1', 'Contract v2']));
  });

  it('shows only the metadata that differs, until "View all data" is ticked', async () => {
    await open();
    answer(contractV1, contractV2);
    await settle();
    expect(row('coverage')).toBeUndefined();

    component.viewAllData.set(true);
    await settle();

    expect(row('coverage')?.values).toEqual(['EU', 'EU']);
  });

  it('shows a change as the old value and the new one in the unified view, icons as images', async () => {
    await open();
    answer(contractV1, contractV2);
    await settle();

    component.unifiedView.set(true);
    await settle();

    const title = [...fixture.nativeElement.querySelectorAll('.compare-field-row--unified')].find(
      (r: Element) => r.querySelector('.compare-field-label')?.textContent?.trim() === 'title',
    ) as Element;
    expect(title.querySelector('.compare-field-value--removed')?.textContent?.trim()).toBe(
      'Contract v1',
    );
    expect(title.querySelector('.compare-field-value--added')?.textContent?.trim()).toBe(
      'Contract v2',
    );
    const icons = [...fixture.nativeElement.querySelectorAll('lib-compare-icon-image')].map(
      (el: Element) => el.textContent?.trim(),
    );
    // Until an icon arrives, each image shows its path.
    expect(icons).toEqual(expect.arrayContaining(['/icons/file.gif', '/icons/note.gif']));
  });

  it('shows an icon that did not change once, not twice, in the unified view', async () => {
    await open();
    component.rightId.set('d3');
    await settle();
    answer(contractV1, contractV3);
    await settle();

    component.unifiedView.set(true);
    await settle();

    // The empty `icon-expanded` row renders an image with no path, which shows nothing.
    const icons = [...fixture.nativeElement.querySelectorAll('lib-compare-icon-image')]
      .map((el: Element) => el.textContent?.trim())
      .filter(Boolean);
    expect(icons).toEqual(['/icons/file.gif']);
  });

  it('reads the new pair when either side is changed', async () => {
    await open();
    answer(contractV1, contractV2);
    await settle();

    component.leftId.set('d3');
    await settle();

    expect(getFullDocument.mock.calls.slice(2).map(([uid]) => uid)).toEqual(['d3', 'd2']);
    answer(contractV3, contractV2);
    await settle();
    expect(row('title')?.values).toEqual(['Contract v3', 'Contract v2']);
  });

  it('ignores a pair that answers after another was chosen', async () => {
    await open();
    const firstLeft = reads.get('d1') as Subject<NuxeoDocument>;
    const firstRight = reads.get('d2') as Subject<NuxeoDocument>;

    component.leftId.set('d3');
    await settle();
    answer(contractV3, contractV2);
    await settle();

    firstLeft.next(contractV1);
    firstLeft.complete();
    firstRight.next(contractV2);
    firstRight.complete();
    await settle();

    expect(component.leftDoc()?.uid).toBe('d3');
    expect(row('title')?.values).toEqual(['Contract v3', 'Contract v2']);
  });

  it('asks for two different documents when the same one is on both sides, and reads nothing', async () => {
    await open();
    answer(contractV1, contractV2);
    await settle();
    getFullDocument.mockClear();

    component.rightId.set('d1');
    await settle();

    expect(getFullDocument).not.toHaveBeenCalled();
    expect(text('.compare-error')).toBe('Select two different documents to compare.');
    expect(rows()).toEqual([]);
  });

  it('asks for two different documents when it was opened with only one', async () => {
    await open([{ id: 'd1', name: 'Contract v1' }]);

    expect(getFullDocument).not.toHaveBeenCalled();
    expect(text('.compare-error')).toBe('Select two different documents to compare.');
  });

  it('says it could not load them when a read fails, and stops the spinner', async () => {
    await open();

    reads.get('d1')?.error(new Error('HTTP 500'));
    await settle();

    expect(component.loading()).toBe(false);
    expect(text('.compare-error')).toBe('Failed to load documents for comparison.');
    expect(fixture.nativeElement.querySelector('nxs-spinner')).toBeNull();
  });

  it('offers every document it was opened with on both sides', async () => {
    await open();

    expect(component.leftId()).toBe('d1');
    expect(component.rightId()).toBe('d2');
    expect(fixture.nativeElement.querySelectorAll('mat-select')).toHaveLength(2);
  });
});
