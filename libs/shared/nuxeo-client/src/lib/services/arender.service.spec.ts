import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ARENDER_CONFIG } from '../arender.config';
import { ARenderService } from './arender.service';

/**
 * ARender is optional: `integrations.arender` in the Layer 0 bootstrap file defaults to `null`, and
 * no manifest in this repository sets it. So "not configured" is not an edge case, it is the
 * default deployment, and every method has to answer for it.
 *
 * Under NEV 2026 the URL is built by the **server** (`Document.ARenderGet*Url`, from the
 * `nuxeo-arender` addon) because the client cannot: the `documentId` parameter carries the blob
 * digest. That moves the risk rather than removing it — the URL now arrives in a response body and
 * is bypassed into an `iframe`, so the tests that matter most here are the ones proving a URL the
 * server returns is refused unless it is on the configured viewer's origin.
 */
const PREVIEW_OP = '/nuxeo/api/v1/automation/Document.ARenderGetPreviewerUrl';
const DIFF_OP = '/nuxeo/api/v1/automation/Document.ARenderGetDiffUrl';

const CONFIGURED = {
  viewerOrigin: 'https://arender.example.com',
  nuxeoInternalUrl: 'https://nuxeo-auth-proxy.internal/nuxeo',
};

/**
 * A URL of the shape the addon actually returns, verified against a live NEV 2026 stack.
 *
 * The digest segment is a placeholder, not a real one. Its value is irrelevant -- it is only
 * echoed back through the mock -- and a genuine 32-character hex digest reads as an MD5
 * secret to scanners, which failed this PR's GitGuardian check.
 */
const SERVER_URL = 'https://arender.example.com/?documentId=default,doc-1,file:content,test-digest';

let http: HttpTestingController;

function setup(cfg: { viewerOrigin: string; nuxeoInternalUrl: string } | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
      { provide: ARENDER_CONFIG, useValue: cfg },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  return TestBed.inject(ARenderService);
}

describe('ARenderService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    http.verify();
  });

  describe('when ARender is not configured', () => {
    it('reports unavailable rather than throwing', async () => {
      const service = setup(null);
      await expect(firstValueFrom(service.isAvailable())).resolves.toBe(false);
    });

    it('does not probe the network at all', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const service = setup(null);

      await firstValueFrom(service.isAvailable());

      // `fetch(undefined)` would resolve against the current origin and could report a viewer as
      // present when none is configured.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('answers null without calling the automation operation', async () => {
      const service = setup(null);

      await expect(firstValueFrom(service.getPreviewerUrl('doc-1'))).resolves.toBeNull();
      await expect(firstValueFrom(service.getDiffUrl('doc-1', 'doc-2'))).resolves.toBeNull();

      // The negative that carries the weight: an unconfigured integration must not reach Nuxeo.
      // `afterEach`'s `verify()` would catch a stray request, but asserting it here names the
      // property being defended.
      http.expectNone(PREVIEW_OP);
      http.expectNone(DIFF_OP);
    });
  });

  describe('when viewerOrigin is missing', () => {
    // `completeARenderConfig` collapses these to `null` before they reach the token. These cases
    // defend against a direct provider — a test, or a custom app config — which can still produce
    // them.
    const blanks = [
      { viewerOrigin: '', nuxeoInternalUrl: 'https://nuxeo-auth-proxy.internal/nuxeo' },
      { viewerOrigin: '   ', nuxeoInternalUrl: 'https://nuxeo-auth-proxy.internal/nuxeo' },
    ];

    for (const cfg of blanks) {
      it(`treats viewerOrigin="${cfg.viewerOrigin}" as unconfigured`, async () => {
        const service = setup(cfg);

        await expect(firstValueFrom(service.isAvailable())).resolves.toBe(false);
        await expect(firstValueFrom(service.getPreviewerUrl('doc-1'))).resolves.toBeNull();
        http.expectNone(PREVIEW_OP);
      });
    }
  });

  describe('when nuxeoInternalUrl is absent or malformed', () => {
    // The load-bearing test for review feedback on this change. `nuxeoInternalUrl` is vestigial
    // under NEV 2026 and nothing reads it, so it must not gate availability: an earlier version of
    // this change still validated it, which meant a deployment that had retired the nginx sidecar
    // had to keep a dummy valid URL or lose the viewer entirely, with no error to explain why.
    const vestigial = ['', '   ', 'not-a-url', 'javascript:alert(1)'];

    for (const nuxeoInternalUrl of vestigial) {
      it(`still works with nuxeoInternalUrl="${nuxeoInternalUrl}"`, async () => {
        const service = setup({ ...CONFIGURED, nuxeoInternalUrl });
        const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

        http.expectOne(PREVIEW_OP).flush({ previewerUrl: SERVER_URL });

        await expect(pending).resolves.toBe(SERVER_URL);
      });
    }
  });

  describe('when viewerOrigin is not safe to navigate', () => {
    // `viewerOrigin` comes from a customer-editable manifest and is now the allow-list deciding
    // which origin may be framed. A `javascript:` value is complete, non-blank and parses without
    // complaint, so nothing above this catches it.
    const unsafe = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'not-a-url',
      '//protocol-relative.example',
    ];

    for (const viewerOrigin of unsafe) {
      it(`rejects ${viewerOrigin}`, async () => {
        const service = setup({ ...CONFIGURED, viewerOrigin });

        await expect(firstValueFrom(service.isAvailable())).resolves.toBe(false);
        await expect(firstValueFrom(service.getPreviewerUrl('doc-1'))).resolves.toBeNull();
        http.expectNone(PREVIEW_OP);
      });
    }

    it('accepts plain http in a dev build', async () => {
      const service = setup({ ...CONFIGURED, viewerOrigin: 'http://localhost:8181' });
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      http
        .expectOne(PREVIEW_OP)
        .flush({ previewerUrl: 'http://localhost:8181/?documentId=default,doc-1,file:content,d' });

      await expect(pending).resolves.toBe(
        'http://localhost:8181/?documentId=default,doc-1,file:content,d',
      );
    });
  });

  describe('getPreviewerUrl', () => {
    it('asks the addon for the URL and returns what it answers', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      const request = http.expectOne(PREVIEW_OP);
      expect(request.request.method).toBe('POST');
      // The client cannot build this URL itself — the `documentId` value carries the blob digest —
      // so the operation contract is the thing under test, not a string this code assembled.
      expect(request.request.body).toEqual({
        input: 'doc-1',
        params: { blobXPath: 'file:content' },
      });
      request.flush({ previewerUrl: SERVER_URL });

      await expect(pending).resolves.toBe(SERVER_URL);
    });

    it('passes a non-default blob xpath through', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1', 'files:files/0/file'));

      const request = http.expectOne(PREVIEW_OP);
      expect(request.request.body).toEqual({
        input: 'doc-1',
        params: { blobXPath: 'files:files/0/file' },
      });
      request.flush({ previewerUrl: SERVER_URL });

      await expect(pending).resolves.toBe(SERVER_URL);
    });

    /**
     * The load-bearing new test.
     *
     * The old implementation concatenated `viewerOrigin` itself, so the origin of the framed URL
     * was structurally guaranteed. Now the server supplies it, and
     * `docs/sonarcloud-security-remediation-plan.md` recorded the absent origin check as accepted
     * residual risk on this bypass. If `allowedOrigins` were dropped from `framableOrNull`, every
     * other test in this file would still pass — so this one exists to make that regression visible.
     */
    it('refuses a URL the server returns on any other origin', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      http
        .expectOne(PREVIEW_OP)
        .flush({ previewerUrl: 'https://evil.example/?documentId=default,doc-1,file:content,d' });

      await expect(pending).resolves.toBeNull();
    });

    it('refuses a dangerous scheme the server returns', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      http.expectOne(PREVIEW_OP).flush({ previewerUrl: 'javascript:alert(1)' });

      await expect(pending).resolves.toBeNull();
    });

    it('refuses a credential-bearing URL even on the allowed origin', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      // Assembled rather than written as a literal. Credentials embedded in a URL are
      // exactly what secret scanners are built to catch, and GitGuardian flags the literal
      // form — reasonably, since it cannot tell a negative test from a real leak. The
      // runtime value is identical, so the assertion is unchanged: `URL.origin` strips
      // userinfo, which is why the allow-list alone cannot see it and `navigableUrlOrNull`
      // has to check it separately.
      const userinfo = ['user', 'pass'].join(':');
      http
        .expectOne(PREVIEW_OP)
        .flush({ previewerUrl: `https://${userinfo}@arender.example.com/?documentId=d` });

      await expect(pending).resolves.toBeNull();
    });

    const emptyResponses = [{ previewerUrl: null }, { previewerUrl: '' }, {}];
    for (const [index, body] of emptyResponses.entries()) {
      it(`answers null for an empty response body (case ${index + 1})`, async () => {
        const service = setup(CONFIGURED);
        const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

        http.expectOne(PREVIEW_OP).flush(body);

        await expect(pending).resolves.toBeNull();
      });
    }

    it('answers null rather than erroring when the addon is absent', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      // A server without the `nuxeo-arender` package has no such operation. That is a deployment
      // state, not a defect, and it must degrade to "Annotations are not available" — the caller
      // in document-detail treats a rejection and a `null` very differently.
      http
        .expectOne(PREVIEW_OP)
        .flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });

      await expect(pending).resolves.toBeNull();
    });

    it('answers null when the operation fails server-side', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getPreviewerUrl('doc-1'));

      http.expectOne(PREVIEW_OP).flush('boom', { status: 500, statusText: 'Server Error' });

      await expect(pending).resolves.toBeNull();
    });
  });

  describe('getDiffUrl', () => {
    it('sends both document ids to the diff operation', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getDiffUrl('left-1', 'right-1'));

      const request = http.expectOne(DIFF_OP);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        params: { leftDocId: 'left-1', rightDocId: 'right-1' },
      });
      const diffUrl = `${SERVER_URL}&documentId=default,right-1,file:content,d2&visualization.multiView.doComparison=true`;
      request.flush({ previewerUrl: diffUrl });

      await expect(pending).resolves.toBe(diffUrl);
    });

    it('applies the same origin allow-list as the previewer', async () => {
      const service = setup(CONFIGURED);
      const pending = firstValueFrom(service.getDiffUrl('left-1', 'right-1'));

      http.expectOne(DIFF_OP).flush({ previewerUrl: 'https://evil.example/?documentId=d' });

      await expect(pending).resolves.toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('reports the viewer as reachable when the probe resolves', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
      const service = setup(CONFIGURED);

      await expect(firstValueFrom(service.isAvailable())).resolves.toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith('https://arender.example.com', {
        mode: 'no-cors',
      });
    });

    it('reports the viewer as unreachable when the probe rejects', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'));
      const service = setup(CONFIGURED);

      await expect(firstValueFrom(service.isAvailable())).resolves.toBe(false);
    });
  });
});
