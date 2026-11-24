import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { CURRENT_USERNAME } from '../current-user.token';
import { NUXEO_SERVER_URL } from '../nuxeo-api.config';
import { NuxeoDriveService } from './nuxeo-drive.service';

const TOKEN_URL = '/nuxeo/api/v1/token';

describe('NuxeoDriveService', () => {
  let service: NuxeoDriveService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_SERVER_URL, useValue: 'https://nuxeo.example:8443/nuxeo' },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
      ],
    });
    service = TestBed.inject(NuxeoDriveService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  describe('hasDriveToken', () => {
    const answer = (body: unknown) => {
      let installed: boolean | undefined;
      service.hasDriveToken().subscribe((v) => (installed = v));
      const request = http.expectOne((r) => r.url === TOKEN_URL);
      request.flush(body);
      return { installed, request };
    };

    it('asks for the user’s Nuxeo Drive tokens, as Web UI does', () => {
      const { request } = answer({ entries: [] });

      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('application')).toBe('Nuxeo Drive');
    });

    it('reports Drive connected when the user holds a token for it', () => {
      expect(answer({ entries: [{ id: 't1' }] }).installed).toBe(true);
    });

    it('reports Drive not connected when the user holds none', () => {
      expect(answer({ entries: [] }).installed).toBe(false);
    });

    it('reads an answer without entries as not connected', () => {
      expect(answer({}).installed).toBe(false);
    });

    it('reports not connected, rather than failing, when the token read fails', () => {
      let installed: boolean | undefined;
      let failed = false;
      service
        .hasDriveToken()
        .subscribe({ next: (v) => (installed = v), error: () => (failed = true) });

      http
        .expectOne((r) => r.url === TOKEN_URL)
        .flush('nope', { status: 401, statusText: 'Unauthorized' });

      expect(installed).toBe(false);
      expect(failed).toBe(false);
    });
  });

  describe('buildEditUrl', () => {
    const blobUrl =
      'https://nuxeo.example:8443/nuxeo/nxfile/default/doc-1/file:content/Q3%20report.docx?changeToken=1-0';

    it('builds the nxdrive://edit URL Drive opens: server, user, repository, document, file', () => {
      expect(service.buildEditUrl('doc-1', blobUrl, 'Q3 report.docx')).toBe(
        'nxdrive://edit/https/nuxeo.example:8443/nuxeo' +
          '/user/jdoe/repo/default/nxdocid/doc-1' +
          '/filename/Q3%20report.docx' +
          '/downloadUrl/nxfile/default/doc-1/file:content/Q3%20report.docx',
      );
    });

    it('drops the blob URL’s query string, which Drive would read as its own', () => {
      expect(service.buildEditUrl('doc-1', blobUrl, 'a.docx')).not.toContain('changeToken');
    });

    it('encodes the file name, so a slash in it cannot add a path segment', () => {
      const url = service.buildEditUrl('doc-1', blobUrl, 'a/b.docx');

      expect(url).toContain('/filename/a%2Fb.docx/');
    });

    it('sends no download URL when the blob URL is not an nxfile URL', () => {
      const url = service.buildEditUrl('doc-1', 'https://cdn.example/a.docx', 'a.docx');

      expect(url).toBe(
        'nxdrive://edit/https/nuxeo.example:8443/nuxeo/user/jdoe/repo/default/nxdocid/doc-1/filename/a.docx',
      );
    });

    it('names whoever is signed in now, not whoever was when the service was made', () => {
      let user = 'jdoe';
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: NUXEO_SERVER_URL, useValue: 'https://nuxeo.example/nuxeo' },
          { provide: CURRENT_USERNAME, useValue: () => user },
        ],
      });
      const drive = TestBed.inject(NuxeoDriveService);

      user = 'asmith';

      expect(drive.buildEditUrl('doc-1', blobUrl, 'a.docx')).toContain('/user/asmith/');
    });
  });

  describe('buildDirectTransferUrl', () => {
    it('builds the nxdrive://direct-transfer URL for the target folder’s path', () => {
      expect(service.buildDirectTransferUrl('/default-domain/workspaces/Projects')).toBe(
        'nxdrive://direct-transfer/https/nuxeo.example:8443/nuxeo/default-domain/workspaces/Projects',
      );
    });

    it('accepts a path with or without its leading slash', () => {
      expect(service.buildDirectTransferUrl('default-domain/workspaces')).toBe(
        service.buildDirectTransferUrl('/default-domain/workspaces'),
      );
    });
  });

  describe('openDriveUrl', () => {
    it('clicks a hidden link to the URL, so the OS hands it to Drive and the app stays put', () => {
      const clicked: { href: string; hidden: boolean; attached: boolean }[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clicked.push({
          href: this.href,
          hidden: this.style.display === 'none',
          attached: document.body.contains(this),
        });
      });

      service.openDriveUrl('nxdrive://edit/https/nuxeo.example/nuxeo/user/jdoe');

      expect(clicked).toEqual([
        {
          href: 'nxdrive://edit/https/nuxeo.example/nuxeo/user/jdoe',
          hidden: true,
          attached: true,
        },
      ]);
      click.mockRestore();
    });

    it('removes the link afterwards, once the browser has had time to hand the URL over', () => {
      vi.useFakeTimers();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
      const before = document.body.querySelectorAll('a').length;

      service.openDriveUrl('nxdrive://direct-transfer/https/nuxeo.example/nuxeo/ws');
      expect(document.body.querySelectorAll('a').length).toBe(before + 1);

      vi.advanceTimersByTime(500);
      expect(document.body.querySelectorAll('a').length).toBe(before);
      click.mockRestore();
    });
  });
});
