import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { vi } from 'vitest';

import { DocumentDetailService, NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { KdCitationDialogComponent } from './kd-citation-dialog';

/**
 * jsdom implements neither `URL.createObjectURL` nor `revokeObjectURL`, and this dialog calls both.
 *
 * Without this stub `setBlobPreview` throws on the very first line after the served-type gate, so the
 * error path runs and `previewMode` is left at the `'unsupported'` that `clearPreview` set. Every
 * assertion expecting `'unsupported'` then passes for that reason instead of the gate's — which is
 * precisely how the two negative tests below passed before this was added, while the positive control
 * failed and exposed it. A stub that makes the real path executable is what makes the negatives mean
 * anything.
 */
let blobSeq = 0;
(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(
  () => `blob:mock/${(blobSeq += 1)}`,
);
(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

describe('KdCitationDialogComponent', () => {
  let fixture: ComponentFixture<KdCitationDialogComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KdCitationDialogComponent, HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            initialIndex: 1,
            answer: {
              questionId: 'q-1',
              agentId: 'agent-1',
              question: 'Who is Holmes?',
              status: 'Complete',
              answer: 'Holmes is a detective [1].',
              citations: [{ objectId: 'source__doc-1', title: 'Sherlock', referenceId: 'chunk-1' }],
              objectReferences: [
                {
                  objectId: 'source__doc-1',
                  references: [
                    {
                      referenceId: 'chunk-1',
                      content: 'Pray take a seat, said Holmes.',
                      pageNumber: 1,
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          provide: MatDialogRef,
          useValue: { close: vi.fn() },
        },
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        DocumentDetailService,
        // `DomSanitizer` is deliberately NOT provided here. Listing the abstract class overrides
        // Angular's real `DomSanitizerImpl`, so `bypassSecurityTrustResourceUrl` threw — which meant
        // `setBlobPreview` aborted before setting `previewMode`, leaving it at the `'unsupported'`
        // that `clearPreview` had set. Every assertion expecting `'unsupported'` passed for that
        // reason rather than the served-type gate's.
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KdCitationDialogComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads the source document and renders the active reference excerpt', () => {
    fixture.detectChanges();

    const docReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-1');
    expect(docReq.request.method).toBe('GET');
    docReq.flush({
      uid: 'doc-1',
      title: 'Sherlock story',
      path: '/default-domain/workspaces/demo/sherlock.png',
      properties: {
        'file:content': { name: 'sherlock.png', 'mime-type': 'image/png' },
      },
      contextParameters: {},
    });

    const blobReq = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/id/doc-1/@blob/file:content' &&
        r.params.get('clientReason') === 'view',
    );
    blobReq.flush(new Blob(['image'], { type: 'image/png' }));

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('chunk-1');
    expect(element.textContent).toContain('[1]');
    expect(element.textContent).toContain('Pray take a seat, said Holmes.');
    expect(element.textContent).toContain('Page 1');
  });

  /**
   * The served-type gate on the PDF iframe.
   *
   * `'pdf'` mode is chosen from document metadata — the recorded mime type, or the presence of a `pdf`
   * rendition — and neither is what the browser consults. It parses a `blob:` document by its
   * `Content-Type`, and a blob URL inherits this origin, so a document recorded as PDF but served as
   * `text/html` executed as script in a same-origin iframe. This was the third component with the
   * defect, after the attachment preview dialog and `DocumentViewerComponent`.
   */
  describe('the pdf iframe requires the served type to be PDF', () => {
    /** Loads a document recorded as PDF, then serves its blob with the given Content-Type. */
    function loadPdfDocumentServedAs(servedType: string): void {
      fixture.detectChanges();

      httpMock.expectOne('/nuxeo/api/v1/id/doc-1').flush({
        uid: 'doc-1',
        title: 'Report',
        path: '/default-domain/workspaces/demo/report.pdf',
        properties: {
          'file:content': { name: 'report.pdf', 'mime-type': 'application/pdf' },
        },
        contextParameters: {},
      });

      httpMock
        .expectOne(
          (r) =>
            r.url === '/nuxeo/api/v1/id/doc-1/@blob/file:content' &&
            r.params.get('clientReason') === 'view',
        )
        .flush(new Blob(['payload'], { type: servedType }));

      fixture.detectChanges();
    }

    it('refuses the iframe when the blob is served as html', () => {
      loadPdfDocumentServedAs('text/html');
      expect(fixture.componentInstance.previewMode()).toBe('unsupported');
    });

    it('refuses the iframe when the server sent no Content-Type', () => {
      // `blob.type` is '' here, which is the case where the browser would otherwise sniff.
      loadPdfDocumentServedAs('');
      expect(fixture.componentInstance.previewMode()).toBe('unsupported');
    });

    it('accepts a genuine pdf, including one carrying parameters', () => {
      // The positive control: the gate must be discriminating, not refuse every PDF.
      loadPdfDocumentServedAs('application/pdf; version=1.7');
      expect(fixture.componentInstance.previewMode()).toBe('pdf');
    });
  });
});
