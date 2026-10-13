import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NuxeoApiBase, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NXS_SEARCH_DEBOUNCE_MS } from '../pickers/search-as-you-type';
import {
  NxsDocumentReferenceInputComponent,
  nxsDocumentSuggestionQuery,
  type NxsDocumentReference,
} from './document-reference-input.component';

const doc = (uid: string, title: string, type = 'File'): NuxeoDocument =>
  ({ uid, title, type, path: `/default-domain/workspaces/${title}` }) as NuxeoDocument;

describe('nxsDocumentSuggestionQuery', () => {
  const BASE =
    " AND ecm:mixinType != 'HiddenInNavigation' AND ecm:isVersion = 0 AND ecm:isTrashed = 0";

  it('runs the query Web UI’s default_document_suggestion page provider runs', () => {
    expect(nxsDocumentSuggestionQuery('contr')).toBe(
      `SELECT * FROM Document WHERE ecm:fulltext LIKE 'contr*'${BASE}`,
    );
  });

  it.each([
    ['an apostrophe', "O'Brien", "O\\'Brien"],
    ['a backslash before a quote', "a\\'b", "a\\\\\\'b"],
    [
      'a quote that would close the literal',
      "x' OR ecm:isTrashed = 1 OR 'y",
      "x\\' OR ecm:isTrashed = 1 OR \\'y",
    ],
  ])('keeps %s inside the literal', (_case, term, escaped) => {
    expect(nxsDocumentSuggestionQuery(term)).toBe(
      `SELECT * FROM Document WHERE ecm:fulltext LIKE '${escaped}*'${BASE}`,
    );
  });

  it('narrows to the types given, each escaped, skipping blanks', () => {
    expect(nxsDocumentSuggestionQuery('a', ['File', ' ', "No'te"])).toBe(
      `SELECT * FROM Document WHERE ecm:fulltext LIKE 'a*'${BASE} AND ecm:primaryType IN ('File', 'No\\'te')`,
    );
  });
});

@Component({
  standalone: true,
  imports: [NxsDocumentReferenceInputComponent, ReactiveFormsModule],
  template: `<nxs-document-reference-input
    label="Related contract"
    [documentTypes]="types()"
    [formControl]="reference"
  />`,
})
class HostComponent {
  readonly types = signal<readonly string[]>([]);
  readonly reference = new FormControl<NxsDocumentReference | null>(null);
}

describe('NxsDocumentReferenceInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let nxqlSearch: ReturnType<typeof vi.fn>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => root().querySelector('input') as HTMLInputElement;
  const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('mat-option')];

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(value: string): Promise<void> {
    input().focus();
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await render();
    vi.advanceTimersByTime(NXS_SEARCH_DEBOUNCE_MS);
    await render();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    nxqlSearch = vi.fn(() =>
      of({ entries: [doc('c1', 'Supplier contract'), doc('n1', 'Contract notes', 'Note')] }),
    );
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NuxeoApiBase, useValue: { nxqlSearch } },
        { provide: LiveAnnouncer, useValue: { announce: vi.fn(() => Promise.resolve()) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => vi.useRealTimers());

  it('asks for three characters before it searches', async () => {
    await type('co');
    expect(nxqlSearch).not.toHaveBeenCalled();
    expect(root().querySelector('mat-hint')?.textContent?.trim()).toBe(
      'Type at least 3 characters',
    );
  });

  it('searches twenty documents at a time with the escaped query', async () => {
    host.types.set(['File']);
    await render();
    await type("o'b");
    expect(nxqlSearch).toHaveBeenCalledExactlyOnceWith(
      nxsDocumentSuggestionQuery("o'b", ['File']),
      20,
    );
  });

  it('lists each result with its type icon, title and path', async () => {
    await type('contract');
    expect(options().map((option) => option.getAttribute('data-uid'))).toEqual(['c1', 'n1']);
    expect(options()[0].querySelector('nxs-doc-type-icon')).not.toBeNull();
    expect(options()[0].textContent?.trim()).toContain(
      'Supplier contract /default-domain/workspaces/Supplier contract',
    );
  });

  it('returns a reference to the document chosen', async () => {
    await type('contract');
    options()[1].click();
    await render();
    expect(host.reference.value).toEqual({
      uid: 'n1',
      title: 'Contract notes',
      type: 'Note',
      path: '/default-domain/workspaces/Contract notes',
    });
    expect(input().value).toBe('Contract notes');
  });

  it('clears the choice when the user types again, and the half-typed text is an error', async () => {
    await type('contract');
    options()[0].click();
    await render();
    await type('Supplier');
    expect(host.reference.value).toBeNull();
    expect(host.reference.hasError('nxsChooseFromList')).toBe(true);
  });

  it('says the search failed rather than throwing', async () => {
    nxqlSearch.mockReturnValue(throwError(() => ({ status: 400 })));
    await type('a -b "c');
    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Search failed. Try again.',
    ]);
  });

  it('shows a reference the form already holds, and clears it with the x button', async () => {
    host.reference.setValue({ uid: 'c1', title: 'Supplier contract', type: 'File', path: '/p' });
    await render();
    expect(input().value).toBe('Supplier contract');
    root().querySelector<HTMLButtonElement>('button.nxs-picker__clear')?.click();
    await render();
    expect(host.reference.value).toBeNull();
  });
});
