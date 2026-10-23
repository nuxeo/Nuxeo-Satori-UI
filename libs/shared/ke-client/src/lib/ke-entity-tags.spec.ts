import { describe, expect, it } from 'vitest';

import { KE_TAG_ENTITY_CATEGORIES, toKeEntityTags } from './ke-entity-tags';

describe('toKeEntityTags', () => {
  it('keeps only the allowed entity categories, in the order they are listed', () => {
    const tags = toKeEntityTags({
      urls: ['http://localhost:8080/nuxeo/site/automation/HylandKnowledgeEnrichment.Enrich'],
      custom_entities: ['nuxeo.hyland.cic.ingest.clientSecret', 'Acme-300326-060908.pdf'],
      organizations: ['Nuxeo', 'Hyland'],
      locations: ['Dev tenant'],
      products_brands: ['Knowledge Enrichment'],
      titles: ['Solution Owner'],
      dates_times: ['3 March 2026'],
    });

    expect(tags).toEqual([
      'Nuxeo',
      'Hyland',
      'Dev tenant',
      'Knowledge Enrichment',
      'Solution Owner',
      '3 March 2026',
    ]);
  });

  it('excludes urls and custom_entities even when they are the only categories', () => {
    expect(
      toKeEntityTags({ urls: ['https://auth.example/idp'], custom_entities: ['x.y.z'] }),
    ).toEqual([]);
  });

  it('trims values, drops blanks and removes duplicates across categories', () => {
    expect(
      toKeEntityTags({ organizations: [' Nuxeo ', '', 'Nuxeo'], titles: ['Nuxeo', '   '] }),
    ).toEqual(['Nuxeo']);
  });

  it('returns no tags for a missing or empty map', () => {
    expect(toKeEntityTags(null)).toEqual([]);
    expect(toKeEntityTags(undefined)).toEqual([]);
    expect(toKeEntityTags({})).toEqual([]);
  });

  it('lists exactly the categories shown as tags', () => {
    expect([...KE_TAG_ENTITY_CATEGORIES]).toEqual([
      'organizations',
      'locations',
      'products_brands',
      'titles',
      'dates_times',
    ]);
  });
});
