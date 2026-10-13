/**
 * NXSAT-301 — every `<iframe>` the viewer renders carries a non-empty `title` (axe `frame-title`,
 * WCAG 2.0 Level A 4.1.2). Without one a screen reader announces an unnamed frame, and the viewer
 * is the one surface where the frame *is* the content.
 *
 * ## Why this is a component test and not a template scan
 *
 * The violation escaped both accessibility gates, and the reason is the same for both: the ARender
 * frame only renders when `arenderUrl` is set, which happens only once `integrations.arender` is in
 * the served configuration. CI has never configured it, so the runtime axe sweep never had the node
 * to judge. Asserting against the template *source* alone would reproduce that blind spot in a new
 * form — it would pass on a `[title]` binding that resolves to a key no catalogue defines, which is
 * the raw-key-as-accessible-name defect `checkAccessibleNameFallbacks` exists for.
 *
 * So each frame is rendered and its resolved `title` read off the DOM, through the real English
 * catalogue that `provideTestTranslations` serves from `test-setup.ts`. That is what makes a missing
 * catalogue key a failure here rather than a silent pass. The last test then guards the *list*: a
 * sixth untitled iframe would otherwise pass this file by never being rendered by it.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentViewerComponent } from './document-viewer.component';

const templatePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'document-viewer.component.html',
);

describe('Document viewer iframe titles (NXSAT-301)', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;
  let sanitizer: DomSanitizer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentViewerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentViewerComponent);
    sanitizer = TestBed.inject(DomSanitizer);
  });

  /** Every input a rendering branch reads, so each case states its whole world — as in the dispatch spec. */
  interface FrameInputs {
    mimeType: string;
    fileName: string;
    blobUrl: SafeResourceUrl | null;
    rawBlobUrl: string | null;
    blobType: string;
    previewUrl: SafeResourceUrl | null;
    noteContent: string | null;
    hasPdfRendition: boolean;
    annotationsTab: boolean;
    arenderUrl: SafeResourceUrl | null;
  }

  function render(inputs: Partial<FrameInputs>): HTMLIFrameElement[] {
    const world: FrameInputs = {
      mimeType: '',
      fileName: 'quarterly-report.pdf',
      blobUrl: null,
      rawBlobUrl: null,
      blobType: '',
      previewUrl: null,
      noteContent: null,
      hasPdfRendition: false,
      annotationsTab: false,
      arenderUrl: null,
      ...inputs,
    };
    for (const [key, value] of Object.entries(world)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLIFrameElement>('iframe'),
    );
  }

  /** A URL trusted the way the host component trusts it, so `[src]` survives sanitization. */
  function trusted(url: string): SafeResourceUrl {
    return sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  /**
   * The five iframe sites, as the four viewer states that reach them. Only one renders at a time —
   * the ARender frame has its own branch and the rest are `@switch` cases.
   *
   * `inputs` is a thunk because it calls `trusted()`, and this list is built while the suite is
   * collected — before `beforeEach` has injected the sanitizer.
   */
  const CASES: {
    state: string;
    expectedContentType: string | null;
    inputs: () => Partial<FrameInputs>;
    title: string;
  }[] = [
    {
      state: 'ARender annotations',
      expectedContentType: null, // its own branch, taken before the contentType switch
      inputs: () => ({ annotationsTab: true, arenderUrl: trusted('https://nev.example/viewer') }),
      title: 'Annotations for quarterly-report.pdf',
    },
    {
      state: 'Note HTML body',
      expectedContentType: 'html',
      inputs: () => ({ mimeType: 'text/html', noteContent: '<p>body</p>' }),
      title: 'Note content for quarterly-report.pdf',
    },
    {
      state: 'PDF blob',
      expectedContentType: 'pdf',
      inputs: () => ({
        mimeType: 'application/pdf',
        blobUrl: trusted('blob:mock-pdf'),
        rawBlobUrl: 'blob:mock-pdf',
        blobType: 'application/pdf',
      }),
      title: 'PDF preview of quarterly-report.pdf',
    },
    {
      // A separate `<iframe>` element from the PDF one, and it was untitled alongside it. The two
      // share one catalogue key deliberately: the same words, two call sites.
      state: 'PDF rendition of a non-PDF document',
      expectedContentType: 'pdfRendition',
      inputs: () => ({
        mimeType: 'application/msword',
        hasPdfRendition: true,
        blobUrl: trusted('blob:mock-rendition'),
        rawBlobUrl: 'blob:mock-rendition',
        blobType: 'application/pdf',
      }),
      title: 'PDF preview of quarterly-report.pdf',
    },
    {
      state: 'server-generated preview',
      expectedContentType: 'preview',
      inputs: () => ({ previewUrl: trusted('/nuxeo/preview') }),
      title: 'Preview of quarterly-report.pdf',
    },
  ];

  for (const { state, expectedContentType, inputs, title } of CASES) {
    it(`names the ${state} frame`, () => {
      const frames = render(inputs());

      // Asserted so a dispatch change that stops reaching this branch fails loudly here, rather
      // than passing because no iframe rendered and nothing was checked.
      if (expectedContentType) {
        expect(fixture.componentInstance.contentType()).toBe(expectedContentType);
      }
      expect(frames, `${state} should render exactly one iframe`).toHaveLength(1);
      expect(frames[0].getAttribute('title')).toBe(title);
    });
  }

  it('resolves every frame title to real words rather than a raw key', () => {
    for (const { state, inputs } of CASES) {
      const [frame] = render(inputs());
      const name = frame?.getAttribute('title') ?? '';
      expect(name, `${state} frame title`).not.toBe('');
      // A key ngx-translate could not resolve is passed through verbatim, which looks like a name
      // to axe but is not words to a user. `shared-ui.document-viewer.…` reaching the DOM is that.
      expect(name, `${state} frame title should not be a raw key`).not.toMatch(
        /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
      );
    }
  });

  it('leaves no iframe in the template without a title binding', () => {
    const template = readFileSync(templatePath, 'utf8');

    const tags = template.match(/<iframe[\s\S]*?>/g) ?? [];
    // Five, matching the five sites the cases above cover. If this number changes, a site was added
    // or removed and the case list above needs the same edit.
    expect(tags, 'iframes found in the viewer template').toHaveLength(5);
    expect(
      tags.filter((tag) => !/\[title\]=/.test(tag)),
      'iframes with no [title] binding',
    ).toEqual([]);
  });
});
