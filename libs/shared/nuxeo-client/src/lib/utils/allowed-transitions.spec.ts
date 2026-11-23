import type { NuxeoDocument } from '../models/document.model';
import {
  ALLOWED_TRANSITIONS_ENRICHER,
  allowedTransitions,
  canFollowAnyTransition,
} from './allowed-transitions';

function documentWith(contextParameters?: NuxeoDocument['contextParameters']): NuxeoDocument {
  return {
    uid: 'claim-1',
    title: 'Claim 1',
    type: 'Claim',
    path: '/claims/claim-1',
    lastModified: '2026-11-23T10:00:00Z',
    properties: {},
    state: 'submitted',
    contextParameters,
  };
}

describe('allowedTransitions', () => {
  it('reads the enricher the Java bundle registers, by that name', () => {
    // `AllowedTransitionsJsonEnricher.NAME` in nuxeo-agentic-core; a different name here and the
    // server would never be asked.
    expect(ALLOWED_TRANSITIONS_ENRICHER).toBe('allowedTransitions');
  });

  it('lists the transitions in the order the server sent them, with where each leads', () => {
    const document = documentWith({
      allowedTransitions: [
        { name: 'approve', destinationState: 'approved' },
        { name: 'deny', destinationState: 'denied' },
      ],
    });

    expect(allowedTransitions(document)).toEqual([
      { name: 'approve', destinationState: 'approved' },
      { name: 'deny', destinationState: 'denied' },
    ]);
    expect(canFollowAnyTransition(document)).toBe(true);
  });

  it('has none for a document fetched without the enricher, or with none to follow', () => {
    expect(allowedTransitions(documentWith())).toEqual([]);
    expect(allowedTransitions(documentWith({}))).toEqual([]);
    expect(allowedTransitions(documentWith({ allowedTransitions: [] }))).toEqual([]);
    expect(allowedTransitions(null)).toEqual([]);
    expect(allowedTransitions(undefined)).toEqual([]);
    expect(canFollowAnyTransition(documentWith({ allowedTransitions: [] }))).toBe(false);
    expect(canFollowAnyTransition(null)).toBe(false);
  });

  it('reads no transition from a value that is not a list', () => {
    expect(allowedTransitions(documentWith({ allowedTransitions: 'approve' }))).toEqual([]);
    expect(allowedTransitions(documentWith({ allowedTransitions: { name: 'approve' } }))).toEqual(
      [],
    );
  });

  it('skips entries with no usable name, and keeps a repeated name once', () => {
    const document = documentWith({
      allowedTransitions: [
        'approve',
        null,
        ['deny'],
        { destinationState: 'approved' },
        { name: '', destinationState: 'approved' },
        { name: 42, destinationState: 'approved' },
        { name: 'approve', destinationState: 'approved' },
        { name: 'approve', destinationState: 'elsewhere' },
      ],
    });

    expect(allowedTransitions(document)).toEqual([
      { name: 'approve', destinationState: 'approved' },
    ]);
  });

  it('skips an entry with no destination, which the server could not follow', () => {
    const document = documentWith({
      allowedTransitions: [
        { name: 'a' },
        { name: 'b', destinationState: null },
        { name: 'c', destinationState: '' },
        { name: 'd', destinationState: 7 },
        { name: 'e', destinationState: 'approved' },
      ],
    });

    expect(allowedTransitions(document)).toEqual([{ name: 'e', destinationState: 'approved' }]);
  });

  it('keeps the first of a repeated name only once it has a destination', () => {
    const document = documentWith({
      allowedTransitions: [{ name: 'approve' }, { name: 'approve', destinationState: 'approved' }],
    });

    expect(allowedTransitions(document)).toEqual([
      { name: 'approve', destinationState: 'approved' },
    ]);
  });
});
