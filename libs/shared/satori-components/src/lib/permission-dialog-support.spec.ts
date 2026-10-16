import { formatAceDateRange } from '@nuxeo/satori-platform/nuxeo-client';

import { nxsAceTimeFrame, offeredRights } from './permission-dialog-support';

const translate = (key: string, params?: Record<string, unknown>): string =>
  params ? `${key} ${Object.values(params).join(' - ')}` : key;

describe('nxsAceTimeFrame', () => {
  // Midnight in Paris on 15 July, as Web UI there writes it and Nuxeo returns it.
  const parisMidnight = '2030-07-14T22:00:00.000Z';

  it('shows the day its writer picked, where the UTC date is the day before', () => {
    expect(nxsAceTimeFrame({ begin: null, end: parisMidnight }, translate, 'en-US')).toBe(
      'permissions.time-frame.until Jul 15, 2030',
    );
    expect(formatAceDateRange(null, parisMidnight, translate, 'en-US')).toContain('Jul 14, 2030');
  });

  it('reads an entry written from the user’s own zone as written', () => {
    const begin = new Date(2030, 0, 2).toISOString();
    const end = new Date(2030, 2, 4).toISOString();

    expect(nxsAceTimeFrame({ begin, end }, translate, 'en-US')).toContain('Jan 02, 2030');
    expect(nxsAceTimeFrame({ begin, end }, translate, 'en-US')).toContain('Mar 04, 2030');
  });

  it('calls an entry with neither date permanent', () => {
    expect(nxsAceTimeFrame({ begin: null, end: null }, translate, 'en-US')).toBe(
      'permissions.time-frame.permanent',
    );
  });
});

describe('offeredRights', () => {
  it('does not repeat an entry’s right the type already lists', () => {
    expect(offeredRights(['Read', 'ReadWrite'], 'Read')).toEqual(['Read', 'ReadWrite']);
  });
});
