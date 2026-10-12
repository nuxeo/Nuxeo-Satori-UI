import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsThumbnailComponent } from './thumbnail.component';

/** Hosted, because the fallback is projected content and the document id is an input that changes. */
@Component({
  standalone: true,
  imports: [NxsThumbnailComponent],
  template: `
    @if (shown()) {
      <nxs-thumbnail class="probe-thumb" [documentId]="documentId()" [alt]="alt()">
        <span class="probe-fallback">icon</span>
      </nxs-thumbnail>
    }
  `,
})
class HostComponent {
  readonly documentId = signal('doc-1');
  readonly alt = signal('');
  readonly shown = signal(true);
}

describe('NxsThumbnailComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  /** One subject per requested id, so each test decides when and how each request answers. */
  let requests: Map<string, Subject<Blob>>;
  let fetchThumbnail: ReturnType<typeof vi.fn>;
  let created: string[];
  let revoked: string[];

  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function image(): HTMLImageElement | null {
    return fixture.nativeElement.querySelector('img.nxs-thumbnail__image');
  }

  function thumbnail(): HTMLElement | null {
    return fixture.nativeElement.querySelector('nxs-thumbnail');
  }

  function fallback(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.probe-fallback');
  }

  function answer(id: string, blob: Blob): void {
    requests.get(id)?.next(blob);
    requests.get(id)?.complete();
  }

  beforeEach(async () => {
    requests = new Map();
    created = [];
    revoked = [];
    let counter = 0;
    // jsdom implements neither, so they are installed rather than spied on, and removed after.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:thumb-${++counter}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url);
      }),
    });
    fetchThumbnail = vi.fn((id: string): Observable<Blob> => {
      const subject = new Subject<Blob>();
      requests.set(id, subject);
      return subject;
    });

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentDetailService, useValue: { fetchThumbnail } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => {
    fixture.destroy();
    Object.assign(URL, { createObjectURL: undefined, revokeObjectURL: undefined });
  });

  it('fetches the rendition through DocumentDetailService.fetchThumbnail', () => {
    expect(fetchThumbnail).toHaveBeenCalledWith('doc-1');
  });

  it('shows the projected fallback, with no box of its own, until the image arrives', () => {
    expect(fallback()?.textContent).toBe('icon');
    expect(image()).toBeNull();
    expect(thumbnail()?.classList.contains('nxs-thumbnail--empty')).toBe(true);
  });

  it('shows the image from a blob URL it created, in place of the fallback', async () => {
    answer('doc-1', png());
    await render();

    expect(image()?.getAttribute('src')).toBe('blob:thumb-1');
    expect(created).toEqual(['blob:thumb-1']);
    expect(fallback()).toBeNull();
    expect(thumbnail()?.classList.contains('nxs-thumbnail--empty')).toBe(false);
  });

  it('is decorative by default and takes a text alternative when given one', async () => {
    answer('doc-1', png());
    await render();
    expect(image()?.getAttribute('alt')).toBe('');

    host.alt.set('Thumbnail of Report.pdf');
    await render();
    expect(image()?.getAttribute('alt')).toBe('Thumbnail of Report.pdf');
  });

  it('revokes the blob URL when it is destroyed', async () => {
    answer('doc-1', png());
    await render();
    host.shown.set(false);
    await render();

    expect(revoked).toEqual(['blob:thumb-1']);
  });

  it('revokes the previous blob URL as soon as the document changes, and fetches the new one', async () => {
    answer('doc-1', png());
    await render();

    host.documentId.set('doc-2');
    await render();
    // The old image is gone before the new request has answered.
    expect(revoked).toEqual(['blob:thumb-1']);
    expect(image()).toBeNull();
    expect(fallback()).not.toBeNull();
    expect(fetchThumbnail).toHaveBeenLastCalledWith('doc-2');

    answer('doc-2', png());
    await render();
    expect(image()?.getAttribute('src')).toBe('blob:thumb-2');
  });

  it('drops a response for a document it no longer shows, so no URL is minted for it', async () => {
    host.documentId.set('doc-2');
    await render();
    // doc-1's request was superseded; its late answer must not reach the screen or the ledger.
    answer('doc-1', png());
    await render();

    expect(created).toEqual([]);
    expect(image()).toBeNull();

    answer('doc-2', png());
    await render();
    expect(created).toEqual(['blob:thumb-1']);
  });

  it('never leaves a URL unrevoked across several changes and a destroy', async () => {
    for (const id of ['doc-2', 'doc-3', 'doc-4']) {
      answer(host.documentId(), png());
      await render();
      host.documentId.set(id);
      await render();
    }
    answer('doc-4', png());
    await render();
    host.shown.set(false);
    await render();

    expect(created).toHaveLength(4);
    expect([...revoked].sort()).toEqual([...created].sort());
  });

  it('keeps the fallback when the request fails', async () => {
    fetchThumbnail.mockReturnValueOnce(throwError(() => new Error('500')));
    host.documentId.set('doc-err');
    await render();

    expect(image()).toBeNull();
    expect(fallback()).not.toBeNull();
    expect(created).toEqual([]);
  });

  it('keeps the fallback for an empty rendition', async () => {
    answer('doc-1', new Blob([]));
    await render();

    expect(image()).toBeNull();
    expect(fallback()).not.toBeNull();
    expect(created).toEqual([]);
  });

  it('requests nothing for a blank document id', async () => {
    fetchThumbnail.mockClear();
    host.documentId.set('');
    await render();

    expect(fetchThumbnail).not.toHaveBeenCalled();
    expect(fallback()).not.toBeNull();
  });

  it('falls back and revokes when the bytes do not decode as an image', async () => {
    answer('doc-1', png());
    await render();
    image()?.dispatchEvent(new Event('error'));
    await render();

    expect(image()).toBeNull();
    expect(fallback()).not.toBeNull();
    expect(revoked).toEqual(['blob:thumb-1']);
  });
});
