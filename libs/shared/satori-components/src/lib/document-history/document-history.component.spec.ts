import { HttpErrorResponse } from '@angular/common/http';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  DirectoryService,
  DocumentDetailService,
  type AuditEntry,
  type AuditLogList,
  type AuditLogQuery,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NxsDocumentHistoryComponent } from './document-history.component';

function entry(id: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    category: 'eventDocumentCategory',
    principalName: 'jdoe',
    comment: '',
    docLifeCycle: 'project',
    docPath: '/default-domain/workspaces/ws/Contract',
    docType: 'File',
    docUUID: 'doc-1',
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate: '2026-10-13T09:15:00.000Z',
    logDate: '2026-10-13T09:15:00.000Z',
    extended: {},
    ...overrides,
  };
}

function page(entries: AuditEntry[], resultsCount = entries.length): AuditLogList {
  return { entries, resultsCount } as AuditLogList;
}

@Component({
  standalone: true,
  imports: [NxsDocumentHistoryComponent],
  template: `<nxs-document-history [documentUid]="uid()" />`,
})
class HostComponent {
  readonly uid = signal('doc-1');
}

describe('NxsDocumentHistoryComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let documents: { getAuditLog: ReturnType<typeof vi.fn> };

  const el = (): HTMLElement => fixture.nativeElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  /** What a button says to assistive technology: its text without the icons hidden from it. */
  const nameOf = (node: Element): string => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"], mat-icon').forEach((n) => n.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const retryButton = (): HTMLButtonElement | undefined =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => nameOf(b) === 'Retry');
  const lastCall = (): [string, number, number, AuditLogQuery] =>
    documents.getAuditLog.mock.calls.at(-1) as [string, number, number, AuditLogQuery];
  const rows = (): string[][] =>
    [...el().querySelectorAll('tr.mat-mdc-row')].map((row) =>
      [...row.querySelectorAll('td')].map(
        (cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ),
    );
  const field = (label: string): HTMLElement =>
    [...el().querySelectorAll<HTMLElement>('mat-form-field')].find(
      (f) => f.querySelector('mat-label')?.textContent?.trim() === label,
    ) as HTMLElement;
  async function choose(label: string, option: string): Promise<void> {
    field(label).querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((o) => o.textContent?.trim() === option)
      ?.click();
    await settle();
  }
  async function typeDate(label: string, value: string): Promise<void> {
    const input = field(label).querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  }

  beforeEach(async () => {
    documents = {
      getAuditLog: vi.fn((): Observable<AuditLogList> =>
        of(
          page(
            [
              entry(1, { comment: 'Fixed a typo' }),
              entry(2, { eventId: 'documentLocked', principalName: 'Administrator' }),
              entry(3, { eventId: 'customThing', category: 'eventLifeCycleCategory' }),
            ],
            45,
          ),
        ),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideNativeDateAdapter(),
        { provide: DocumentDetailService, useValue: documents },
        {
          provide: DirectoryService,
          useValue: {
            getEventTypes: () =>
              of([
                { id: 'documentModified', displayLabel: 'Document modified' },
                { id: 'documentLocked', displayLabel: 'Document locked' },
              ]),
            getEventCategories: () =>
              of([{ id: 'eventDocumentCategory', displayLabel: 'Document' }]),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  it('asks the server for the first page, newest first', () => {
    expect(documents.getAuditLog).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual([
      'doc-1',
      20,
      0,
      expect.objectContaining({ sortBy: 'eventDate', sortOrder: 'desc' }),
    ]);
  });

  it('shows Web UI’s six columns, with actions and categories named by their vocabularies', () => {
    const headers = [...el().querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      'Performed action',
      'Date',
      'Username',
      'Category',
      'Comment',
      'State',
    ]);
    expect(rows()[0][0]).toBe('Document modified');
    expect(rows()[0][3]).toBe('Document');
    expect(rows()[0][4]).toBe('Fixed a typo');
    expect(rows()[0][5]).toBe('project');
    expect(rows()[2][0]).toBe('Custom Thing');
    expect(rows()[2][3]).toBe('Life Cycle');
  });

  it('makes an action readable when the vocabulary only repeats its id, as Nuxeo’s stock one does', async () => {
    TestBed.inject(DirectoryService).getEventTypes = () =>
      of([{ id: 'documentCheckedIn', displayLabel: 'documentCheckedIn' }]) as never;
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    documents.getAuditLog.mockReturnValue(of(page([entry(1, { eventId: 'documentCheckedIn' })])));
    await settle();
    expect(rows()[0][0]).toBe('Document Checked In');
    field('Performed action').querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
    await settle();
    expect(
      [...document.querySelectorAll('mat-option')].map((o) => o.textContent?.trim()),
    ).toContain('Document Checked In');
  });

  it('shows the time as well as the day', () => {
    expect(rows()[0][1]).toMatch(/2026.*\d{1,2}:\d{2}/);
  });

  it('names the table and lets the keyboard reach its scroll area', () => {
    const region = el().querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Document history');
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(el().querySelector('caption')?.textContent?.trim()).toBe('Document history');
  });

  it('filters by action on the server, from the first page', async () => {
    el().querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')?.click();
    await settle();
    expect(lastCall()[2]).toBe(1);
    await choose('Performed action', 'Document locked');
    expect(lastCall()[2]).toBe(0);
    expect(lastCall()[3].eventIds).toEqual(['documentLocked']);
  });

  it('filters by category on the server', async () => {
    await choose('Category', 'Document');
    expect(lastCall()[3].eventCategory).toBe('eventDocumentCategory');
  });

  it('sends From as the start of that day and To as the start of the next, so To is included', async () => {
    await typeDate('From', '10/12/2026');
    await typeDate('To', '10/13/2026');
    const query = lastCall()[3];
    expect(query.startDate?.getTime()).toBe(new Date(2026, 9, 12).getTime());
    expect(query.endDate?.getTime()).toBe(new Date(2026, 9, 14).getTime());
  });

  it('filters by the exact username once the user pauses, not per keystroke', async () => {
    vi.useFakeTimers();
    const input = field('Username').querySelector('input') as HTMLInputElement;
    for (const text of ['j', 'jd', 'jdoe']) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    expect(documents.getAuditLog).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    await settle();
    expect(documents.getAuditLog).toHaveBeenCalledTimes(2);
    expect(lastCall()[3].principalName).toBe('jdoe');
    expect(field('Username').textContent).toContain('The exact username');
  });

  it('sorts on the server', async () => {
    const header = [...el().querySelectorAll<HTMLElement>('th')].find(
      (th) => th.textContent?.trim() === 'Username',
    );
    header?.querySelector<HTMLElement>('.mat-sort-header-container')?.click();
    await settle();
    expect(lastCall()[3]).toEqual(
      expect.objectContaining({ sortBy: 'principalName', sortOrder: 'asc' }),
    );
    expect(header?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('pages through every entry on the server', async () => {
    expect(el().querySelector('.mat-mdc-paginator-range-label')?.textContent).toContain('45');
    el().querySelector<HTMLButtonElement>('.mat-mdc-paginator-navigation-next')?.click();
    await settle();
    expect(lastCall().slice(1, 3)).toEqual([20, 1]);
  });

  it('says when there is no history, and when the filters match none', async () => {
    documents.getAuditLog.mockReturnValue(of(page([])));
    host.uid.set('doc-2');
    await settle();
    expect(el().textContent).toContain('No history entries yet');
    await choose('Category', 'Document');
    expect(el().textContent).toContain('No history entries match these filters');
  });

  it('offers Retry for a server error, which asks again', async () => {
    documents.getAuditLog.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    host.uid.set('doc-2');
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'The history could not be loaded.',
    );
    documents.getAuditLog.mockReturnValue(of(page([entry(9)])));
    expect(retryButton()).toBeDefined();
    retryButton()?.click();
    await settle();
    expect(rows()).toHaveLength(1);
  });

  it('reads a 403 as a refusal, with no Retry', async () => {
    documents.getAuditLog.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    host.uid.set('doc-2');
    await settle();
    expect(el().querySelector('[role="alert"]')?.getAttribute('data-status')).toBe('403');
    expect(retryButton()).toBeUndefined();
  });

  it('starts again for another document: filters cleared, page one, a late answer dropped', async () => {
    await choose('Category', 'Document');
    const late = new Subject<AuditLogList>();
    documents.getAuditLog.mockImplementation((uid: string) =>
      uid === 'doc-1' ? late : of(page([entry(7, { comment: 'current' })])),
    );
    await choose('Category', 'Any');
    host.uid.set('doc-2');
    await settle();
    expect(lastCall()[0]).toBe('doc-2');
    expect(lastCall()[2]).toBe(0);
    expect(lastCall()[3].eventCategory).toBeUndefined();
    late.next(page([entry(99, { comment: 'stale' })]));
    await settle();
    expect(el().textContent).toContain('current');
    expect(el().textContent).not.toContain('stale');
  });
});
