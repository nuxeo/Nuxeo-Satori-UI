import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  SHARE_LINK_MAX_DAYS,
  endInRange,
  fieldDate,
  fieldDay,
  itemTitle,
  refusalKey,
  shareableItems,
  utcDay,
} from './share-links';

const record = (properties: Record<string, unknown>): NuxeoDocument => ({
  uid: 'a1',
  title: 'Asset',
  type: 'AcmeAsset',
  path: '/a1',
  lastModified: '2026-11-25T00:00:00Z',
  properties,
});

describe('what a picture offers to share', () => {
  it('is its original, when it has one, then its views with a file and a title, each title once', () => {
    const items = shareableItems(
      record({
        'file:content': { name: 'jacket.tif' },
        'picture:views': [
          { title: 'Medium', content: { data: 'x' } },
          { title: ' ', content: { data: 'x' } },
          { title: 'FullHD', content: { data: 'x' } },
          { title: 'Medium', content: { data: 'y' } },
          { title: 'Pending' },
          { content: { data: 'x' } },
          'nonsense',
        ],
      }),
    );
    expect(items).toEqual([
      { item: 'original', title: null },
      { item: 'view:Medium', title: 'Medium' },
      { item: 'view:FullHD', title: 'FullHD' },
    ]);
  });

  it('is nothing for a record with no file and no views', () => {
    expect(shareableItems(record({}))).toEqual([]);
    expect(shareableItems(record({ 'file:content': null, 'picture:views': 'x' }))).toEqual([]);
  });
});

describe('a link’s last day', () => {
  it('counts today in UTC, whatever the reader’s zone', () => {
    const lateOn25th = new Date(Date.UTC(2026, 10, 25, 23, 30));
    expect(utcDay(lateOn25th)).toBe('2026-11-25');
    expect(utcDay(lateOn25th, 7)).toBe('2026-12-02');
    expect(utcDay(new Date(Date.UTC(2026, 11, 31, 1)), 1)).toBe('2027-01-01');
  });

  it('is the day a date field holds, by its local parts, both ways', () => {
    expect(fieldDay(new Date(2026, 11, 2))).toBe('2026-12-02');
    expect(fieldDay(fieldDate('2027-02-23'))).toBe('2027-02-23');
    expect(fieldDay(null)).toBeNull();
    expect(fieldDay(new Date(Number.NaN))).toBeNull();
  });

  it('is in range from today to the server’s last day, both included', () => {
    const today = new Date(Date.UTC(2026, 10, 25, 22));
    expect(endInRange('2026-11-24', today)).toBe(false);
    expect(endInRange('2026-11-25', today)).toBe(true);
    expect(endInRange(utcDay(today, SHARE_LINK_MAX_DAYS), today)).toBe(true);
    expect(endInRange(utcDay(today, SHARE_LINK_MAX_DAYS + 1), today)).toBe(false);
    expect(endInRange(null, today)).toBe(false);
  });
});

describe('how the page words an item and a refusal', () => {
  it('names a view by its title, the original by the page, and anything else as written', () => {
    expect(itemTitle('view:FullHD')).toBe('FullHD');
    expect(itemTitle('original')).toBeNull();
    expect(itemTitle('rendition:pdf')).toBe('rendition:pdf');
  });

  it('translates each reason the server gives, and a generic one for any other', () => {
    expect(refusalKey('channel-not-covered')).toBe(
      'document-layouts.share-links.refused.channel-not-covered',
    );
    expect(refusalKey('no-such-rendition')).toBe(
      'document-layouts.share-links.refused.no-such-rendition',
    );
    expect(refusalKey('constructor')).toBe('document-layouts.share-links.refused.other');
  });
});
