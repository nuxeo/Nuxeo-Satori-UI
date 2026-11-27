import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentChangesService,
  NUXEO_API_ORIGIN,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { ACME_CLAIM_ESCALATE_PLUGIN_IDS, provideAcmeClaimEscalatePlugin } from '../extensions';
import { AcmeClaimEscalateComponent, canEscalate } from './acme-claim-escalate';

/** A claim as Nuxeo's REST API returns one, with the permissions its enricher lists. */
function claim(number: string, state: string, permissions: readonly string[]): NuxeoDocument {
  return {
    uid: `claim-${number.toLowerCase()}`,
    title: number,
    type: 'Claim',
    path: `/claims/${number}`,
    lastModified: '2026-11-20T09:00:00.000Z',
    state,
    properties: { 'cl:number': number },
    contextParameters: { permissions: [...permissions] },
  };
}

/** Each piece of text shown, one space between, as check 9 reads it. */
function shown(fixture: ComponentFixture<unknown>): string {
  const host = fixture.nativeElement as HTMLElement;
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) pieces.push(text);
  }
  return pieces.join(' ');
}

/**
 * The plugin held to what the custom element `acme-claim-escalate` does, as the inventory read it
 * from the package, on the records of its observed behaviour.
 */
describe('acme-claim-escalate, as a plugin', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideAcmeClaimEscalatePlugin(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(document: NuxeoDocument, reason?: string) {
    const fixture = TestBed.createComponent(AcmeClaimEscalateComponent);
    fixture.componentRef.setInput('document', document);
    if (reason !== undefined) fixture.componentRef.setInput('reason', reason);
    fixture.detectChanges();
    const fired: { output: string; detail: unknown }[] = [];
    const component = fixture.componentInstance;
    component.claimEscalated.subscribe((detail) =>
      fired.push({ output: 'claimEscalated', detail }),
    );
    component.documentUpdated.subscribe(() =>
      fired.push({ output: 'documentUpdated', detail: null }),
    );
    component.notify.subscribe((detail) => fired.push({ output: 'notify', detail }));
    const button = (): HTMLButtonElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector('button');
    return { fixture, fired, button };
  }

  it('is registered under its component ID, and resolves', async () => {
    const registry = TestBed.inject(ExtensionComponentRegistry);
    expect(await registry.resolve(ACME_CLAIM_ESCALATE_PLUGIN_IDS.components[0])).toBe(
      AcmeClaimEscalateComponent,
    );
  });

  // What it shows: the text bindings of its template.
  it("shows [[i18n('label.claim.escalate')]] as the element does, on each record", () => {
    expect(shown(render(claim('CL-1001', 'open', ['Read', 'Write', 'Everything'])).fixture)).toBe(
      'Escalate',
    );
  });

  // What its template gives the elements it holds, and its conditions.
  it('shows what dom-if [[_canEscalate(document)]] holds only while it passes', () => {
    expect(canEscalate(claim('CL-1001', 'open', ['Read', 'Write']))).toBe(true);
    // No Write permission.
    expect(canEscalate(claim('CL-1002', 'open', ['Read']))).toBe(false);
    // Closed, whoever may write it.
    expect(canEscalate(claim('CL-1003', 'closed', ['Read', 'Write']))).toBe(false);
    // No permissions enricher: Web UI's hasPermission finds none.
    expect(canEscalate({ ...claim('CL-1005', 'open', []), contextParameters: {} })).toBe(false);
    expect(shown(render(claim('CL-1002', 'open', ['Read'])).fixture)).toBe('');
    expect(shown(render(claim('CL-1003', 'closed', ['Read', 'Write'])).fixture)).toBe('');
  });

  it('offers its button only where that dom-if passes', () => {
    expect(render(claim('CL-1001', 'open', ['Write'])).button()).not.toBeNull();
    expect(render(claim('CL-1002', 'open', ['Read'])).button()).toBeNull();
  });

  // What it listens to, the operation it runs, and the events it fires.
  it('on tap, does what _escalate does', () => {
    const { fixture, fired, button } = render(claim('CL-1001', 'open', ['Read', 'Write']));
    button()?.click();
    fixture.detectChanges();
    // `_running` first, then the operation, then what it fires once the server answers.
    expect(button()?.disabled).toBe(true);
    http
      .expectOne('/nuxeo/api/v1/automation/Claim.Escalate')
      .flush({ 'entity-type': 'document', properties: { 'cl:level': 2 } });
    expect(fired.map((event) => event.output)).toEqual(['claimEscalated', 'documentUpdated']);
  });

  it('runs Claim.Escalate through the app\'s HTTP service, as nuxeo-operation does with op="Claim.Escalate" input="[[document.uid]]" params="[[_params(reason)]]"', () => {
    const { button } = render(claim('CL-1001', 'open', ['Read', 'Write']));
    button()?.click();
    const request = http.expectOne('/nuxeo/api/v1/automation/Claim.Escalate');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      input: 'doc:claim-cl-1001',
      params: { reason: 'manual' },
      context: {},
    });
    request.flush({ 'entity-type': 'document', properties: { 'cl:level': 2 } });
  });

  it("runs it with the page's reason when the page gives one", () => {
    const { button } = render(claim('CL-1001', 'open', ['Write']), 'audit');
    button()?.click();
    const request = http.expectOne('/nuxeo/api/v1/automation/Claim.Escalate');
    expect(request.request.body.params).toEqual({ reason: 'audit' });
    request.flush({ properties: {} });
  });

  it('gives paper-button disabled [[_running]] as the element does', () => {
    const { fixture, button } = render(claim('CL-1001', 'open', ['Write']));
    button()?.click();
    fixture.detectChanges();
    expect(button()?.disabled).toBe(true);
    // A second press while it runs sends nothing more.
    button()?.click();
    const request = http.expectOne('/nuxeo/api/v1/automation/Claim.Escalate');
    request.flush({ properties: { 'cl:level': 1 } });
    fixture.detectChanges();
    expect(button()?.disabled).toBe(false);
  });

  it("emits claim-escalated as the element fires it, with { claim: this.document.uid, level: response.properties['cl:level'] }", () => {
    const { fired, button } = render(claim('CL-1001', 'open', ['Read', 'Write', 'Everything']));
    button()?.click();
    http
      .expectOne('/nuxeo/api/v1/automation/Claim.Escalate')
      .flush({ 'entity-type': 'document', properties: { 'cl:level': 2 } });
    expect(fired[0]).toEqual({
      output: 'claimEscalated',
      detail: { claim: 'claim-cl-1001', level: 2 },
    });
  });

  it('emits document-updated as the element fires it', () => {
    // And has the app read the record and its lists again, as Web UI's page read the claim.
    const changes: number[] = [];
    TestBed.inject(DocumentChangesService).changes.subscribe(() => changes.push(1));
    const { fired, button } = render(claim('CL-1001', 'open', ['Write']));
    button()?.click();
    http.expectOne('/nuxeo/api/v1/automation/Claim.Escalate').flush({ properties: {} });
    expect(fired.map((event) => event.output)).toEqual(['claimEscalated', 'documentUpdated']);
    expect(changes).toEqual([1]);
  });

  it("emits notify as the element fires it, with { message: this.i18n('label.claim.escalateFailed') }", () => {
    const changes: number[] = [];
    TestBed.inject(DocumentChangesService).changes.subscribe(() => changes.push(1));
    const { fixture, fired, button } = render(claim('CL-1004', 'open', ['Read', 'Write']));
    button()?.click();
    http
      .expectOne('/nuxeo/api/v1/automation/Claim.Escalate')
      .flush('failed', { status: 500, statusText: 'Server Error' });
    expect(fired).toEqual([
      { output: 'notify', detail: { message: 'The claim could not be escalated' } },
    ]);
    // Nothing changed, so nothing is read again, and the button is offered again.
    expect(changes).toEqual([]);
    fixture.detectChanges();
    expect(button()?.disabled).toBe(false);
  });
});
