import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsToastService, provideNxsComponents } from '@nuxeo/satori-platform/components';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  CURRENT_USERNAME,
  DocumentDetailService,
  type NuxeoDocument,
  PERMISSION_DENIED_KEY,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import axe from 'axe-core';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { DocumentTypeDefinition } from '../layout.model';
import { ConnectorRecordService } from './connector-record.service';
import { RECORD_TIMELINE_AUDIT_DELAY } from './record-clock';
import { readRecordLayout } from './record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY, RecordPageComponent } from './record-page';
import { resolveRecordLayout, type ResolvedRecordLayout } from './resolve-record-layout';

/**
 * The `file` widget on the record page (layout-v2.md, section 3): one file of the record, by its
 * name, downloaded as the reader through the blob service when pressed.
 */

const REQUEST_TYPE: DocumentTypeDefinition = {
  name: 'ESignatureRequest',
  schemas: [
    {
      name: 'esignaturerequest',
      prefix: 'sigreq',
      fields: {
        signedFile: { type: 'blob' },
        evidence: { type: 'blob' },
        number: { type: 'string' },
      },
    },
  ],
};

const PAGE = {
  version: 2,
  cards: [
    {
      id: 'signed',
      label: 'Signed',
      fields: [
        'sigreq:number',
        { field: 'sigreq:signedFile', widget: 'file' },
        { field: 'sigreq:evidence', widget: 'file' },
      ],
    },
  ],
};

const request = (properties: Record<string, unknown>): NuxeoDocument =>
  ({
    uid: 'request-1',
    title: 'Account agreement',
    type: 'ESignatureRequest',
    path: '/requests/request-1',
    lastModified: '2026-11-20T10:00:00.000Z',
    properties: { 'sigreq:number': 'SIG-1', ...properties },
  }) as NuxeoDocument;

const SIGNED = {
  name: 'account-agreement-signed.pdf',
  'mime-type': 'application/pdf',
  length: 48213,
  data: '/nuxeo/nxfile/default/request-1/sigreq:signedFile/account-agreement-signed.pdf',
};

describe('RecordPageComponent: a file field', () => {
  let fixture: ComponentFixture<RecordPageComponent>;
  let fetchBlobByXpath: ReturnType<
    typeof vi.fn<(uid: string, xpath: string, options?: unknown) => Observable<Blob>>
  >;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let clicked: { href: string; download: string }[];

  beforeEach(() => {
    fetchBlobByXpath = vi.fn(() => of(new Blob(['%PDF'], { type: 'application/pdf' })));
    toast = { show: vi.fn(), error: vi.fn() };
    clicked = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // jsdom has no blob URLs; the page makes one, clicks a link to it, and revokes it.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:http://localhost/1'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    TestBed.configureTestingModule({
      imports: [RecordPageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        { provide: PageProviderService, useValue: { execute: vi.fn(() => new Subject()) } },
        { provide: ConnectorRecordService, useValue: { read: vi.fn(() => new Subject()) } },
        {
          provide: DocumentDetailService,
          useValue: {
            getAuditLog: vi.fn(() => new Subject()),
            fetchBlobByXpath: (uid: string, xpath: string, options?: unknown) =>
              fetchBlobByXpath(uid, xpath, options),
          },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'kai.lindqvist' },
        {
          provide: DocumentLayoutService,
          useValue: {
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            rowPropertiesOf: () => of(new Map()),
            linkedRecords: () => of(new Map()),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-27T12:00:00.000Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
        { provide: RECORD_TIMELINE_AUDIT_DELAY, useValue: null },
      ],
    });
    // The page lists the toast among its own providers, which only an override reaches.
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
  });

  afterEach(() => vi.restoreAllMocks());

  function layoutOf(content: Record<string, unknown>): ResolvedRecordLayout {
    const read = readRecordLayout(content, {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    if ('invalid' in read) throw new Error(read.invalid);
    return resolveRecordLayout(REQUEST_TYPE, read).layout;
  }

  async function render(document: NuxeoDocument, readOnly = false): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordPageComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('layout', layoutOf(PAGE));
    if (readOnly) fixture.componentRef.setInput('readOnly', true);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (root: HTMLElement, field: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-field="${field}"] nxs-button button`);

  it("draws the file's name as a button named for its download", async () => {
    const root = await render(request({ 'sigreq:signedFile': SIGNED }));
    const shown = button(root, 'sigreq:signedFile');
    expect(shown?.textContent?.replace(/\s+/g, ' ').trim()).toContain(
      'account-agreement-signed.pdf',
    );
    // The accessible name holds the visible one, so a voice command by it reaches the button.
    expect(shown?.getAttribute('aria-label')).toBe('Download account-agreement-signed.pdf');
    expect(shown?.getAttribute('type')).toBe('button');
  });

  it('downloads the property as the reader, under its name, through a blob URL revoked at once', async () => {
    const root = await render(request({ 'sigreq:signedFile': SIGNED }));
    button(root, 'sigreq:signedFile')?.click();
    await settle();
    expect(fetchBlobByXpath).toHaveBeenCalledWith('request-1', 'sigreq:signedFile', {
      clientReason: 'download',
    });
    expect(clicked).toEqual([
      { href: 'blob:http://localhost/1', download: 'account-agreement-signed.pdf' },
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/1');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('asks once while the file is fetched, keeps the focus on its button, then asks again', async () => {
    const answer = new Subject<Blob>();
    fetchBlobByXpath = vi.fn(() => answer);
    const root = await render(
      request({
        'sigreq:signedFile': SIGNED,
        'sigreq:evidence': { ...SIGNED, name: 'evidence.json' },
      }),
    );
    const pressed = button(root, 'sigreq:signedFile') as HTMLButtonElement;
    pressed.focus();
    // A double click, and a press once the page is drawn again: the second and third ask nothing.
    pressed.click();
    pressed.click();
    await settle();
    pressed.click();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(1);
    // Never disabled, so the focus stays where the person pressed.
    expect(pressed.disabled).toBe(false);
    expect(document.activeElement).toBe(pressed);
    // Another file of the record is downloaded beside it.
    button(root, 'sigreq:evidence')?.click();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(2);
    answer.next(new Blob(['%PDF']));
    answer.complete();
    await settle();
    pressed.click();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(3);
  });

  it('says why in a toast when the server refuses it, or it fails, and downloads nothing', async () => {
    fetchBlobByXpath = vi.fn(() =>
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );
    let root = await render(request({ 'sigreq:signedFile': SIGNED }));
    button(root, 'sigreq:signedFile')?.click();
    await settle();
    const translate = TestBed.inject(TranslateService);
    expect(toast.error).toHaveBeenCalledWith(translate.instant(PERMISSION_DENIED_KEY));
    fixture.destroy();
    fetchBlobByXpath = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    root = await render(request({ 'sigreq:signedFile': SIGNED }));
    button(root, 'sigreq:signedFile')?.click();
    await settle();
    expect(toast.error).toHaveBeenLastCalledWith('The file could not be downloaded.');
    expect(clicked).toEqual([]);
  });

  it('shows an empty property, or a file with no name, as empty, with no button', async () => {
    const root = await render(request({ 'sigreq:evidence': { name: ' ', length: 3 } }));
    expect(button(root, 'sigreq:signedFile')).toBeNull();
    expect(button(root, 'sigreq:evidence')).toBeNull();
    expect(
      root
        .querySelector('[data-field="sigreq:signedFile"] .record-page__value')
        ?.textContent?.trim(),
    ).toBe('—');
  });

  it('offers the download on a read-only page too: it is a read', async () => {
    const root = await render(request({ 'sigreq:signedFile': SIGNED }), true);
    button(root, 'sigreq:signedFile')?.click();
    await settle();
    expect(fetchBlobByXpath).toHaveBeenCalledTimes(1);
  });

  it('passes axe at WCAG 2.2 AA', async () => {
    const root = await render(
      request({
        'sigreq:signedFile': SIGNED,
        'sigreq:evidence': { ...SIGNED, name: 'evidence.json' },
      }),
    );
    const results = await axe.run(root, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
