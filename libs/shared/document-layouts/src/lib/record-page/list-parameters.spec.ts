import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { listParameters } from './list-parameters';

const member: NuxeoDocument = {
  uid: 'm-1',
  title: 'Jane Roe',
  type: 'Member',
  path: '/members/m-1',
  state: 'active',
  lastModified: '2026-11-23T00:00:00.000Z',
  properties: {
    'member:id': 'M-0042',
    'member:tier': 2,
    'member:vip': false,
    'member:plans': ['gold'],
    'member:address': { city: 'Springfield' },
    'member:notes': '',
    'member:token': '$currentUser',
  },
  parentRef: 'p-1',
};

describe('listParameters', () => {
  it('reads a property of the open record, and the system properties Nuxeo returns beside them', () => {
    expect(
      listParameters(
        [
          { field: 'ecm:uuid' },
          { field: 'ecm:path' },
          { field: 'ecm:primaryType' },
          { field: 'ecm:currentLifeCycleState' },
          { field: 'member:id' },
        ],
        member,
      ),
    ).toEqual({ values: ['m-1', '/members/m-1', 'Member', 'active', 'M-0042'] });
  });

  it("reads the record's parent", () => {
    expect(listParameters([{ field: 'ecm:parentId' }], member)).toEqual({ values: ['p-1'] });
  });

  it('refuses a system property it does not read, rather than saying the record has none', () => {
    expect(listParameters([{ field: 'ecm:name' }], member)).toEqual({
      missing: 'parameters[0] reads ecm:name, which this build does not read from a record',
    });
  });

  it("refuses a value from the record that the server would read as its own placeholder, and keeps a literal's", () => {
    expect(listParameters([{ field: 'member:token' }], member)).toEqual({
      missing:
        'parameters[0] reads member:token, whose value starts with "$", which the server would read as its own placeholder',
    });
    expect(listParameters(['$currentUser'], member)).toEqual({ values: ['$currentUser'] });
  });

  it('sends a number or a boolean as text, and a literal as written', () => {
    expect(
      listParameters([{ field: 'member:tier' }, { field: 'member:vip' }, 'open', 5, true], member),
    ).toEqual({ values: ['2', 'false', 'open', '5', 'true'] });
  });

  it('has no parameters to send for a list that takes none', () => {
    expect(listParameters([], null)).toEqual({ values: [] });
  });

  it('says which parameter has no single value: missing, empty, a list or an object', () => {
    for (const field of ['member:nope', 'member:notes', 'member:plans', 'member:address']) {
      expect(listParameters(['open', { field }], member)).toEqual({
        missing: `parameters[1] reads ${field}, which has no single value on this record`,
      });
    }
  });

  it('says a property needs an open record where there is none', () => {
    expect(listParameters([{ field: 'ecm:uuid' }], null)).toEqual({
      missing: 'parameters[0] reads ecm:uuid, which needs an open record',
    });
  });

  it('refuses a literal with no value to send', () => {
    for (const literal of [null, '', Number.NaN]) {
      expect(listParameters([literal], member)).toEqual({
        missing: 'parameters[0] has no value to send',
      });
    }
  });
});
