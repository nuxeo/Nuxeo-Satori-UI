import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { CompareIconImageComponent } from './compare-icon-image.component';

/**
 * The compare dialog shows a document type's icon through this component. An icon is a Nuxeo
 * resource behind authentication, so it is fetched as a blob and shown from a blob URL — never
 * bound as a Nuxeo URL — and every blob URL it makes is revoked again.
 */
describe('CompareIconImageComponent', () => {
  let fixture: ComponentFixture<CompareIconImageComponent>;
  let http: HttpTestingController;
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:icon-${created.length + 1}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });

    TestBed.configureTestingModule({
      imports: [CompareIconImageComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: 'https://nuxeo.example/' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CompareIconImageComponent);
  });

  afterEach(() => {
    http.verify();
    // Before the stubs go: destroying the component revokes, and TestBed's own teardown runs later.
    fixture.destroy();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  const show = async (path: string, alt = '') => {
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('alt', alt);
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const img = (): HTMLImageElement | null => fixture.nativeElement.querySelector('img');
  const fallback = (): string | undefined =>
    fixture.nativeElement.querySelector('.compare-icon-fallback')?.textContent?.trim();
  const icon = () => new Blob(['GIF89a'], { type: 'image/gif' });

  it('fetches an icon path from the Nuxeo origin, as a blob', async () => {
    await show('/icons/note.gif');

    const request = http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif');
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(icon());
  });

  it('shows the icon from a blob URL, never from the Nuxeo URL', async () => {
    await show('/icons/note.gif', 'icon');

    http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif').flush(icon());
    await settle();

    expect(img()?.getAttribute('src')).toBe('blob:icon-1');
    expect(img()?.alt).toBe('icon');
    expect(fallback()).toBeUndefined();
  });

  it('names the image as a document type icon when it is given no alt text', async () => {
    await show('/icons/note.gif');

    http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif').flush(icon());
    await settle();

    expect(img()?.alt).toBe('Document type icon');
  });

  it('shows the path as text until the icon arrives', async () => {
    await show('/icons/note.gif');

    expect(img()).toBeNull();
    expect(fallback()).toBe('/icons/note.gif');
    http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif').flush(icon());
  });

  it('keeps the path as text when the icon cannot be fetched', async () => {
    await show('/icons/missing.gif');

    http
      .expectOne('https://nuxeo.example/nuxeo/icons/missing.gif')
      .flush(null, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(img()).toBeNull();
    expect(fallback()).toBe('/icons/missing.gif');
    expect(created).toEqual([]);
  });

  it('fetches nothing and shows nothing for an empty path', async () => {
    await show('');

    http.expectNone(() => true);
    expect(img()).toBeNull();
    expect(fallback()).toBeUndefined();
  });

  it('revokes the old icon’s blob URL when the path changes, and shows the new one', async () => {
    await show('/icons/note.gif');
    http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif').flush(icon());
    await settle();

    await show('/icons/file.gif');

    expect(revoked).toEqual(['blob:icon-1']);
    expect(img()).toBeNull();
    http.expectOne('https://nuxeo.example/nuxeo/icons/file.gif').flush(icon());
    await settle();
    expect(img()?.getAttribute('src')).toBe('blob:icon-2');
  });

  it('drops the old path’s request when the path changes before it answers', async () => {
    await show('/icons/note.gif');
    const stale = http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif');

    await show('/icons/file.gif');

    expect(stale.cancelled).toBe(true);
    http.expectOne('https://nuxeo.example/nuxeo/icons/file.gif').flush(icon());
    await settle();
    expect(created).toEqual(['blob:icon-1']);
    expect(img()?.getAttribute('src')).toBe('blob:icon-1');
  });

  it('revokes its blob URL when it is destroyed', async () => {
    await show('/icons/note.gif');
    http.expectOne('https://nuxeo.example/nuxeo/icons/note.gif').flush(icon());
    await settle();

    fixture.destroy();

    expect(revoked).toEqual(['blob:icon-1']);
  });
});
