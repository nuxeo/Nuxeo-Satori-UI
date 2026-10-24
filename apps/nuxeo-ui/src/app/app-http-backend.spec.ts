import { XhrFactory } from '@angular/common';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { appConfig } from './app.config';

type Listener = (event: ProgressEvent) => void;

class ListenerSet {
  private readonly byType = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.byType.set(type, [...(this.byType.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.byType.set(
      type,
      (this.byType.get(type) ?? []).filter((l) => l !== listener),
    );
  }

  fire(type: string, event: ProgressEvent): void {
    for (const listener of this.byType.get(type) ?? []) listener(event);
  }
}

/** Just enough of an XMLHttpRequest for `HttpXhrBackend`, recording the URL it was opened on. */
class FakeXhr extends ListenerSet {
  readonly DONE = 4;
  readonly readyState = 1;
  readonly upload = new ListenerSet();
  url = '';
  status = 0;
  statusText = '';
  response: unknown = '';
  responseText = '';
  responseURL = '';
  responseType = '';
  withCredentials = false;
  timeout = 0;

  open(_method: string, url: string): void {
    this.url = url;
  }

  setRequestHeader(): void {
    // Headers are not under test here.
  }

  send(): void {
    // Never answered: the spec drives the upload's progress events by hand.
  }

  abort(): void {
    // Nothing is in flight to cancel.
  }

  getAllResponseHeaders(): string {
    return '';
  }
}

/**
 * The application's HTTP backend.
 *
 * Angular 22 made `FetchBackend` the default, and fetch cannot report upload progress: a request
 * with `reportProgress` still completes, but no `UploadProgress` event is ever emitted. The import
 * queue's per-file percentage depends on those events, and no spec of the import service can see
 * the regression — they all replace the backend with `HttpTestingController`. So this runs the
 * real `appConfig.providers` with only the browser's XHR substituted, and requires the upload to
 * go through it and report progress. Seen failing with `withXhr()` removed from `app.config.ts`.
 */
describe('the application HTTP backend', () => {
  let built: FakeXhr[];

  beforeEach(() => {
    built = [];
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        {
          provide: XhrFactory,
          useValue: {
            build: () => {
              const xhr = new FakeXhr();
              built.push(xhr);
              return xhr as unknown as XMLHttpRequest;
            },
          },
        },
      ],
    });
  });

  it('sends an upload through XHR and reports its progress, which fetch cannot', () => {
    const uploadUrl = '/nuxeo/api/v1/upload/batch-1/0';
    const fetchSpy = spyOn(window, 'fetch').and.callThrough();
    const events: HttpEventType[] = [];

    TestBed.inject(HttpClient)
      .post(uploadUrl, new Blob(['content']), {
        responseType: 'text',
        reportProgress: true,
        observe: 'events',
      })
      .subscribe((event) => events.push(event.type));

    const xhr = built.find((candidate) => candidate.url === uploadUrl);
    expect(xhr).withContext('the upload was opened on an XMLHttpRequest').toBeDefined();
    expect(fetchSpy.calls.allArgs().some(([input]) => String(input).includes(uploadUrl)))
      .withContext('the upload did not go through fetch')
      .toBeFalse();

    xhr?.upload.fire('progress', new ProgressEvent('progress', { loaded: 3, total: 7 }));

    expect(events).toContain(HttpEventType.UploadProgress);
  });
});
