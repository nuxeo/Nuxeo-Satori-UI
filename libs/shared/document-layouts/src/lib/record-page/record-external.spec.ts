import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { type ConnectorAnswer, ConnectorRecordService } from './connector-record.service';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import { RecordExternalComponent } from './record-external';
import type { RecordExternalEntry, RecordExternalField } from './record-layout';

const claim = (overrides: Partial<NuxeoDocument> = {}): NuxeoDocument => ({
  uid: 'c1',
  title: 'Claim 1',
  type: 'Claim',
  path: '/c1',
  lastModified: '2026-11-23T10:00:00.000Z',
  properties: { 'claim:number': 'CLAIM-000130' },
  ...overrides,
});

const field = (name: string, more: Partial<RecordExternalField> = {}): RecordExternalField => ({
  place: `cards[1].external.fields[${name}]`,
  name,
  label: { keys: [], fallback: name },
  widget: null,
  parameters: {},
  visibleWhen: null,
  ...more,
});

const PAYMENT: RecordExternalEntry = {
  connector: 'payers.claimPayments',
  fields: [
    field('paymentStatus', {
      widget: 'status-badge',
      parameters: { tones: { Paid: 'positive', Pending: 'warning' } },
    }),
    field('paidAmount', { widget: 'currency', parameters: { currency: 'USD' } }),
    field('paidOn', { widget: 'date', parameters: { format: 'long' } }),
    field('deductibleMet'),
    field('policyNumber', { label: { literal: 'Policy', keys: [], fallback: 'policyNumber' } }),
    field('installments'),
  ],
};

const found = (fields: ConnectorAnswer['fields']): ConnectorAnswer => ({
  connector: 'payers.claimPayments',
  status: 'found',
  fields,
});

describe('RecordExternalComponent', () => {
  let fixture: ComponentFixture<RecordExternalComponent>;
  let read: ReturnType<
    typeof vi.fn<(connector: string, uid: string) => Observable<ConnectorAnswer>>
  >;

  beforeEach(() => {
    read = vi.fn(() =>
      of(
        found({
          paymentStatus: 'Paid',
          paidAmount: 412.5,
          paidOn: '2026-10-02',
          deductibleMet: true,
          policyNumber: 'POL-FICT-0048',
          installments: 3,
          bankAccount: 'FICTIONAL-ACCOUNT-0001',
        }),
      ),
    );
    TestBed.configureTestingModule({
      imports: [RecordExternalComponent, MatIconTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: ConnectorRecordService, useValue: { read } },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-24T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0530' },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    external: RecordExternalEntry = PAYMENT,
    document = claim(),
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordExternalComponent);
    fixture.componentRef.setInput('document', document);
    fixture.componentRef.setInput('external', external);
    fixture.componentRef.setInput('source', 'Claim/view layout: cards[1]');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const shown = (element: HTMLElement): [string, string][] =>
    [...element.querySelectorAll('.record-external__field')].map((row) => [
      row.querySelector('dt')?.textContent?.trim() ?? '',
      row.querySelector('dd')?.textContent?.trim() ?? '',
    ]);

  it("asks the server's connector for the open record, naming nothing else", async () => {
    await render();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('payers.claimPayments', 'c1');
  });

  it('shows the fields the file names, in its order, through their widgets, and no other', async () => {
    const element = await render();

    expect(
      [...element.querySelectorAll('.record-external__field')].map((row) =>
        row.getAttribute('data-field'),
      ),
    ).toEqual([
      'paymentStatus',
      'paidAmount',
      'paidOn',
      'deductibleMet',
      'policyNumber',
      'installments',
    ]);
    const rows = shown(element);
    expect(rows[1]).toEqual(['paidAmount', '$412.50']);
    // A stored day, in UTC, whatever the reader's zone.
    expect(rows[2]).toEqual(['paidOn', 'October 2, 2026']);
    expect(rows[3]).toEqual(['deductibleMet', 'Yes']);
    expect(rows[4]).toEqual(['Policy', 'POL-FICT-0048']);
    expect(rows[5]).toEqual(['installments', '3']);
    expect(element.textContent).not.toContain('FICTIONAL-ACCOUNT-0001');
    const badge = element.querySelector('[data-field="paymentStatus"] lib-extension-outlet');
    expect(badge).not.toBeNull();
  });

  it("shows another system's markup as text, never as HTML or a link", async () => {
    const markup = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">pay</a>';
    read.mockReturnValue(of(found({ policyNumber: markup, paymentStatus: markup })));
    const element = await render({
      connector: 'payers.claimPayments',
      fields: [
        field('policyNumber', { widget: 'long-text' }),
        field('paymentStatus', {
          widget: 'status-badge',
          parameters: { tones: { Paid: 'positive' } },
        }),
      ],
    });
    expect(element.querySelector('.record-external__fields img')).toBeNull();
    expect(element.querySelector('.record-external__fields a')).toBeNull();
    expect(element.querySelector('[data-field="policyNumber"] dd')?.textContent?.trim()).toBe(
      markup,
    );
  });

  describe('how old the answer is', () => {
    const age = (element: HTMLElement): string | null =>
      element.querySelector('.record-external__age')?.textContent?.trim() ?? null;

    it('says so under the fields, from the age the server gives', async () => {
      for (const [seconds, said] of [
        [0, 'Read from the other system just now'],
        [59, 'Read from the other system just now'],
        [60, 'Read from the other system 1 minute ago'],
        [300, 'Read from the other system 5 minutes ago'],
        [7200, 'Read from the other system 2 hours ago'],
      ] as const) {
        read.mockReturnValue(of({ ...found({ policyNumber: 'POL-FICT-0048' }), age: seconds }));
        const element = await render();
        expect(shown(element)).toEqual([['Policy', 'POL-FICT-0048']]);
        expect(age(element)).toBe(said);
      }
    });

    it('says so under nothing found too, which the server keeps as well', async () => {
      read.mockReturnValue(
        of({ connector: 'payers.claimPayments', status: 'not-found', fields: {}, age: 120 }),
      );
      const element = await render();
      expect(element.querySelector('nxs-empty-state')).not.toBeNull();
      expect(age(element)).toBe('Read from the other system 2 minutes ago');
    });

    it('says nothing of it for an answer with no age, nor while loading or after an error', async () => {
      read.mockReturnValue(of(found({ policyNumber: 'POL-FICT-0048' })));
      expect(age(await render())).toBeNull();
      read.mockReturnValue(of({ connector: 'payers.claimPayments', status: 'no-key', fields: {} }));
      expect(age(await render())).toBeNull();
      read.mockReturnValue(new Subject<ConnectorAnswer>());
      expect(age(await render())).toBeNull();
      read.mockReturnValue(throwError(() => ({ status: 504 })));
      expect(age(await render())).toBeNull();
    });
  });

  it('shows the loading state until the server answers', async () => {
    const answer = new Subject<ConnectorAnswer>();
    read.mockReturnValue(answer);
    const element = await render();
    expect(element.querySelector('nxs-spinner')).not.toBeNull();
    expect(element.querySelector('.record-external')?.getAttribute('aria-busy')).toBe('true');

    answer.next(found({ policyNumber: 'POL-FICT-0048' }));
    fixture.detectChanges();
    expect(element.querySelector('nxs-spinner')).toBeNull();
    expect(shown(element)).toEqual([['Policy', 'POL-FICT-0048']]);
  });

  it('shows the empty states for each answer with no field to show', async () => {
    for (const [answer, heading] of [
      [
        { connector: 'payers.claimPayments', status: 'not-found', fields: {} },
        'Nothing found in the other system',
      ],
      [
        { connector: 'payers.claimPayments', status: 'no-key', fields: {} },
        'This record names nothing to look up in the other system',
      ],
      [
        found({ bankAccount: 'FICTIONAL-ACCOUNT-0001', paymentStatus: '' }),
        'Nothing found in the other system',
      ],
    ] as const) {
      read.mockReturnValue(of(answer));
      const element = await render();
      expect(element.querySelector('nxs-empty-state')).not.toBeNull();
      expect(element.textContent).toContain(heading);
      expect(element.querySelector('.record-external__fields')).toBeNull();
    }
  });

  it('shows the error state, with Retry for a server error, which asks again', async () => {
    read.mockReturnValueOnce(throwError(() => ({ status: 504 })));
    const element = await render();
    const error = element.querySelector('nxs-error-state');
    expect(error).not.toBeNull();
    expect(element.textContent).toContain("The other system's information could not be loaded");

    const retry = [...element.querySelectorAll('button')].find((button) =>
      /retry/i.test(button.textContent ?? ''),
    );
    expect(retry).toBeDefined();
    retry?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelector('nxs-error-state')).toBeNull();
    expect(shown(element).length).toBe(6);
  });

  it('offers no Retry when the reader may not read the record', async () => {
    read.mockReturnValue(throwError(() => ({ status: 403 })));
    const element = await render();
    expect(element.querySelector('nxs-error-state')).not.toBeNull();
    expect(
      [...element.querySelectorAll('button')].some((button) =>
        /retry/i.test(button.textContent ?? ''),
      ),
    ).toBe(false);
  });

  it('leaves out a field whose widget does not show the value the system gave, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    read.mockReturnValue(of(found({ paidOn: 412.5, policyNumber: 'POL-FICT-0048' })));
    const element = await render({
      connector: 'payers.claimPayments',
      fields: [field('paidOn', { widget: 'date' }), field('policyNumber')],
    });
    expect(shown(element)).toEqual([['policyNumber', 'POL-FICT-0048']]);
    expect(warn).toHaveBeenCalledWith(
      '[agentic-ui-layouts] Claim/view layout: cards[1]: cards[1].external.fields[paidOn] left out: the widget "date" does not show the double the connector gave',
    );
  });

  it('asks again for another record or the same one modified, and not for the same one again', async () => {
    await render();
    expect(read).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('document', claim());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('document', claim({ lastModified: '2026-11-24T09:00:00.000Z' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('document', claim({ uid: 'c2' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(read).toHaveBeenLastCalledWith('payers.claimPayments', 'c2');
  });
});
