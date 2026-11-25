import { TestBed } from '@angular/core/testing';
import { NuxeoApiBase } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom, of } from 'rxjs';

import { ConnectorRecordService, connectorAnswerOf } from './connector-record.service';

describe('ConnectorRecordService', () => {
  it('asks Connector.Read for the record by its id, naming the connector and nothing else', async () => {
    const post = vi.fn(() =>
      of({ connector: 'payers.claimPayments', status: 'found', fields: { paymentStatus: 'Paid' } }),
    );
    TestBed.configureTestingModule({ providers: [{ provide: NuxeoApiBase, useValue: { post } }] });

    const answer = await firstValueFrom(
      TestBed.inject(ConnectorRecordService).read('payers.claimPayments', 'c1'),
    );

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/nuxeo/api/v1/automation/Connector.Read', {
      params: { connector: 'payers.claimPayments' },
      context: {},
      input: 'doc:c1',
    });
    expect(answer).toEqual({
      connector: 'payers.claimPayments',
      status: 'found',
      fields: { paymentStatus: 'Paid' },
    });
  });
});

describe('connectorAnswerOf', () => {
  const sound = { connector: 'c', status: 'found', fields: {} };

  it('takes each of the three statuses', () => {
    for (const status of ['found', 'not-found', 'no-key']) {
      expect(connectorAnswerOf({ ...sound, status }, 'c').status).toBe(status);
    }
  });

  it("keeps a text, a number or a boolean under a field's name, and drops anything else", () => {
    expect(
      connectorAnswerOf(
        {
          ...sound,
          fields: {
            status: 'Paid',
            amount: 412.5,
            paid: true,
            nested: { iban: 'FICTIONAL' },
            list: [1],
            none: null,
            'claim:number': 'x',
            __proto__: 'x',
          },
        },
        'c',
      ).fields,
    ).toEqual({ status: 'Paid', amount: 412.5, paid: true });
  });

  it('refuses, as a server error, an answer that is not the operation’s', () => {
    for (const body of [
      null,
      'text',
      [],
      { ...sound, connector: 'another' },
      { ...sound, status: 'maybe' },
      { ...sound, fields: [] },
      { connector: 'c', status: 'found' },
    ]) {
      expect(() => connectorAnswerOf(body, 'c')).toThrow(expect.objectContaining({ status: 500 }));
    }
  });
});
