import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT } from '@angular/common';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { type Observable, Subject, of, throwError } from 'rxjs';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { AdminDiagnosticsPageComponent } from './admin-diagnostics-page.component';
import { serverReport } from './diagnostics-fixtures.testing';
import {
  DIAGNOSTICS_PATH,
  type DiagnosticsReport,
  readDiagnosticsReport,
} from './diagnostics-report';
import { DiagnosticsFormatError, DiagnosticsService } from './diagnostics.service';

const flush = async (fixture: ComponentFixture<unknown>) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

/** axe at WCAG 2.2 AA, in jsdom: contrast needs layout, which jsdom does not do. */
async function wcag22(root: Element): Promise<axe.Result[]> {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const text = (root: HTMLElement, selector: string) =>
  (root.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('AdminDiagnosticsPageComponent', () => {
  let load: Mock<() => Observable<DiagnosticsReport>>;

  async function open(answer: ReturnType<DiagnosticsService['load']>) {
    load = vi.fn().mockReturnValue(answer);
    TestBed.configureTestingModule({
      imports: [AdminDiagnosticsPageComponent, testTranslateModule()],
      providers: [{ provide: DiagnosticsService, useValue: { load } }],
    });
    const fixture = TestBed.createComponent(AdminDiagnosticsPageComponent);
    // Attached, so that axe sees it as a person would and a label's `for` reaches its field.
    TestBed.inject(DOCUMENT).body.appendChild(fixture.nativeElement);
    await flush(fixture);
    return fixture;
  }

  const report = (): DiagnosticsReport => readDiagnosticsReport(serverReport())!;

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the versions, the packages, the checks, the layers and the errors, which axe passes', async () => {
    const fixture = await open(of(report()));
    const page = fixture.nativeElement as HTMLElement;

    expect(text(page, 'h1')).toBe('Diagnostics');
    expect(text(page, '[data-diagnostics-versions]')).toContain('Nuxeo Platform 2025.10.18');
    expect(text(page, '[data-diagnostics-versions]')).toContain('nuxeo-agentic-ui 2026.0.2');

    const rows = [...page.querySelectorAll('[data-diagnostics-packages] tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim()),
    );
    expect(rows).toEqual([
      ['nuxeo-agentic-ui', '2026.0.2', 'The app', 'started', 'Not recorded by the server'],
      ['payers-claims-demo', '0.7.0', 'Kit', 'started', 'Not recorded by the server'],
      ['nuxeo-agentic-assets', '0.3.0', 'Add-on', 'installed', 'Not recorded by the server'],
    ]);

    expect(text(page, '[data-check="retention"]')).toContain('Not installed');
    expect(text(page, '[data-check="template-rendering"]')).toContain('Present');
    expect(text(page, '[data-check="ai"]')).toContain('Present');
    expect(text(page, '[data-check="deployment-layer"]')).toContain('On');
    expect(text(page, '[data-check="development-overrides"]')).toContain('Off');
    expect(text(page, '[data-check="operation-allow-list"]')).toContain('In force');

    expect(text(page, '[data-app="payers-claims"] [data-app-files]')).toBe(
      'app.json, actions.json, queues/my-claims.json',
    );
    expect(text(page, '[data-app="payers-claims"] [data-app-deployment]')).toBe(
      'layouts/Claim/view.layout.json, version 3',
    );
    expect(text(page, '[data-app="payers-claims"] [data-app-errors]')).toBe('1 logged');

    const errors = [...page.querySelectorAll('[data-diagnostics-errors] tbody tr')];
    expect(errors.map((row) => row.getAttribute('data-level'))).toEqual(['error', 'warning']);
    expect(errors[1].textContent).toContain('Every app');
    expect(text(page, '[data-diagnostics-omitted]')).toContain('2 for information only');

    expect(await wcag22(page)).toEqual([]);
  });

  it('offers the same facts as text for support, and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const fixture = await open(of(report()));
    const page = fixture.nativeElement as HTMLElement;
    const field = page.querySelector<HTMLTextAreaElement>('[data-diagnostics-support]')!;

    expect(field.readOnly).toBe(true);
    expect(field.value).toContain('nuxeo-agentic-ui-diagnostics/1');
    expect(field.value).toContain('payers-claims-demo 0.7.0 role=kit');
    expect(page.querySelector('label[for="diagnostics-support-text"]')).not.toBeNull();

    page.querySelector<HTMLElement>('[data-diagnostics-copy] button')!.click();
    await flush(fixture);

    expect(writeText).toHaveBeenCalledWith(field.value);
    expect(text(page, '[data-diagnostics-copied]')).toBe('Copied to the clipboard.');
    expect(page.querySelector('[data-diagnostics-copied]')!.getAttribute('role')).toBe('status');
  });

  it('selects the text for the person to copy when the browser refuses the clipboard', async () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const fixture = await open(of(report()));
    const page = fixture.nativeElement as HTMLElement;

    page.querySelector<HTMLElement>('[data-diagnostics-copy] button')!.click();
    await flush(fixture);

    expect(document.activeElement).toBe(page.querySelector('[data-diagnostics-support]'));
    expect(text(page, '[data-diagnostics-copied]')).toContain('copy it yourself');
  });

  it('shows a signature it does not know as not known, never as verified', async () => {
    const raw = serverReport();
    (raw['packages'] as { entries: Record<string, unknown>[] }).entries[1]['signature'] =
      'verified';
    const fixture = await open(of(readDiagnosticsReport(raw)!));
    const page = fixture.nativeElement as HTMLElement;

    const cells = [...page.querySelectorAll('[data-diagnostics-packages] tbody tr')].map((row) =>
      row.lastElementChild!.textContent!.trim(),
    );
    expect(cells).toEqual([
      'Not recorded by the server',
      'Not known',
      'Not recorded by the server',
    ]);
  });

  it('says so when the server keeps no list of packages', async () => {
    const raw = serverReport();
    raw['packages'] = { recorded: false, problem: 'no-list', entries: [] };
    const fixture = await open(of(readDiagnosticsReport(raw)!));
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[data-diagnostics-packages]')).toBeNull();
    expect(text(page, '[data-diagnostics-packages-problem]')).toContain(
      'keeps no list of packages',
    );
    expect(await wcag22(page)).toEqual([]);
  });

  it('shows the server refusing anyone who is not an administrator, and nothing of the report', async () => {
    const fixture = await open(
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[data-diagnostics-failed]')).not.toBeNull();
    expect(page.querySelector('[data-diagnostics-versions]')).toBeNull();
    expect(page.querySelector('[data-diagnostics-support]')).toBeNull();
    expect(await wcag22(page)).toEqual([]);
  });

  it('shows a spinner, labelled, while the report is read, then the report', async () => {
    const answer = new Subject<DiagnosticsReport>();
    const fixture = await open(answer);
    const page = fixture.nativeElement as HTMLElement;

    expect(page.querySelector('[data-diagnostics-loading]')).not.toBeNull();
    expect(await wcag22(page)).toEqual([]);

    answer.next(report());
    answer.complete();
    await flush(fixture);
    expect(page.querySelector('[data-diagnostics-loading]')).toBeNull();
    expect(page.querySelector('[data-diagnostics-versions]')).not.toBeNull();
  });

  it('offers Retry after a server error, and reads the report again', async () => {
    const answers = [throwError(() => new HttpErrorResponse({ status: 500 })), of(report())];
    load = vi.fn(() => answers.shift()!);
    TestBed.configureTestingModule({
      imports: [AdminDiagnosticsPageComponent, testTranslateModule()],
      providers: [{ provide: DiagnosticsService, useValue: { load: () => load() } }],
    });
    const fixture = TestBed.createComponent(AdminDiagnosticsPageComponent);
    await flush(fixture);
    const page = fixture.nativeElement as HTMLElement;

    const retry = [...page.querySelectorAll('button')].find((button) =>
      /retry|try again/i.test(button.textContent ?? ''),
    );
    expect(retry).toBeDefined();
    retry!.click();
    await flush(fixture);

    expect(load).toHaveBeenCalledTimes(2);
    expect(page.querySelector('[data-diagnostics-versions]')).not.toBeNull();
  });
});

describe('DiagnosticsService', () => {
  let http: HttpTestingController;
  let service: DiagnosticsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: 'https://nuxeo.example.invalid' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DiagnosticsService);
  });

  afterEach(() => http.verify());

  it('reads the report with a GET below the app registry', () => {
    let read: DiagnosticsReport | undefined;
    service.load().subscribe((report) => (read = report));

    const request = http.expectOne(`https://nuxeo.example.invalid${DIAGNOSTICS_PATH}`);
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    request.flush(serverReport());

    expect(read?.app.version).toBe('2026.0.2');
  });

  it('fails on an answer that is not the report', () => {
    let failed: unknown;
    service.load().subscribe({ error: (error: unknown) => (failed = error) });

    http.expectOne(`https://nuxeo.example.invalid${DIAGNOSTICS_PATH}`).flush({ format: 'other' });

    expect(failed).toBeInstanceOf(DiagnosticsFormatError);
  });

  it("passes the server's refusal on", () => {
    let failed: HttpErrorResponse | undefined;
    service.load().subscribe({ error: (error: HttpErrorResponse) => (failed = error) });

    http
      .expectOne(`https://nuxeo.example.invalid${DIAGNOSTICS_PATH}`)
      .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(failed?.status).toBe(403);
  });
});
