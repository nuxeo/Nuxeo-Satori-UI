import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type {
  DirectoryService,
  DirectoryEntry,
  L10nDirectoryEntry,
} from '@nuxeo-satori/platform/nuxeo-client';

import { loadFacetLabels } from './facet-labels';

const nature = (id: string, displayLabel: string): DirectoryEntry => ({
  id,
  label: `label.directories.nature.${id}`,
  displayLabel,
  ordering: 1,
  obsolete: 0,
  directoryName: 'nature',
});

const l10n = (id: string, label_en?: string, label_fr?: string): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10nsubjects',
  properties: { id, parent: '', ordering: 1, obsolete: 0, label_en, label_fr },
});

function directories(overrides: Partial<Record<'getEntries' | 'getAllL10nEntries', unknown>> = {}) {
  return {
    getEntries: vi.fn(() => of([nature('contract', 'Contract')])),
    getAllL10nEntries: vi.fn(() => of([l10n('finance', 'Finance', 'Finances')])),
    ...overrides,
  };
}

describe('loadFacetLabels', () => {
  it('labels nature from the nature vocabulary, in the requested language', async () => {
    const service = directories({
      getEntries: vi.fn(() => of([nature('contract', 'Contrat')])),
    });
    const labels = await firstValueFrom(
      loadFacetLabels(service as unknown as DirectoryService, 'fr'),
    );

    expect(service.getEntries).toHaveBeenCalledWith('nature', 'fr');
    expect(labels.nature).toEqual({ contract: 'Contrat' });
  });

  it('labels subjects and coverage from their l10n vocabularies in French, and falls back to English', async () => {
    const service = directories({
      getAllL10nEntries: vi.fn((name: string) =>
        of(
          name === 'l10nsubjects'
            ? [l10n('finance', 'Finance', 'Finances'), l10n('legal', 'Legal')]
            : [l10n('france', 'France', 'Française')],
        ),
      ),
    });
    const labels = await firstValueFrom(
      loadFacetLabels(service as unknown as DirectoryService, 'fr'),
    );

    expect(labels.subjects).toEqual({ finance: 'Finances', legal: 'Legal' });
    expect(labels.coverage).toEqual({ france: 'Française' });
  });

  it('labels in English for an English session, and shows the id when no label exists', async () => {
    const service = directories({
      getAllL10nEntries: vi.fn(() => of([l10n('finance', 'Finance', 'Finances'), l10n('bare')])),
    });
    const labels = await firstValueFrom(
      loadFacetLabels(service as unknown as DirectoryService, 'en'),
    );

    expect(labels.subjects).toEqual({ finance: 'Finance', bare: 'bare' });
  });

  it('leaves only the facet whose vocabulary fails on ids, and keeps the others labelled', async () => {
    const service = directories({
      getAllL10nEntries: vi.fn((name: string) =>
        name === 'l10ncoverage'
          ? throwError(() => new Error('down'))
          : of([l10n('finance', 'Finance')]),
      ),
    });
    const labels = await firstValueFrom(
      loadFacetLabels(service as unknown as DirectoryService, 'en'),
    );

    expect(labels.coverage).toEqual({});
    expect(labels.subjects).toEqual({ finance: 'Finance' });
    expect(labels.nature).toEqual({ contract: 'Contract' });
  });
});
