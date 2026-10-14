import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';

import { layoutLabelText, toEditorSections } from './layout-label';
import { documentToCreate } from './layout-slot';
import { ResolvedLayout } from './layout.model';

const LAYOUT: ResolvedLayout = {
  type: 'Claim',
  mode: 'edit',
  source: 'contributed',
  display: 'sections',
  sections: [
    {
      id: 'claim_details',
      label: { keys: [], fallback: null },
      fields: [
        {
          xpath: 'claim:number',
          definition: { type: 'string', required: true },
          label: { keys: [], fallback: null },
        },
        {
          xpath: 'claim:status',
          definition: { type: 'string', directory: 'claim_status' },
          label: { literal: 'Status', keys: [], fallback: null },
        },
      ],
    },
  ],
};

describe('layoutLabelText', () => {
  it('takes the literal, else the first key that translates, else the fallback', () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { 'acme.status': 'Claim status' }, true);
    expect(
      layoutLabelText(translate, { literal: 'Lit', keys: ['acme.status'], fallback: 'F' }),
    ).toBe('Lit');
    expect(
      layoutLabelText(translate, { keys: ['acme.missing', 'acme.status'], fallback: 'F' }),
    ).toBe('Claim status');
    expect(layoutLabelText(translate, { keys: ['acme.missing'], fallback: 'F' })).toBe('F');
  });
});

describe('toEditorSections', () => {
  const text = (label: { literal?: string; fallback: string | null }) =>
    label.literal ?? label.fallback;

  it('keeps each field with its definition, labelled by its xpath when nothing else names it', () => {
    expect(toEditorSections(LAYOUT, text)).toEqual([
      {
        id: 'claim_details',
        heading: null,
        fields: [
          {
            xpath: 'claim:number',
            label: 'claim:number',
            definition: { type: 'string', required: true },
          },
          {
            xpath: 'claim:status',
            label: 'Status',
            definition: { type: 'string', directory: 'claim_status' },
          },
        ],
      },
    ]);
  });

  it('names an unlabelled section from its id when it becomes a tab', () => {
    expect(toEditorSections({ ...LAYOUT, display: 'tabs' }, text)[0]?.heading).toBe(
      'Claim details',
    );
  });
});

describe('documentToCreate', () => {
  it('stands for a new document of the type, in the folder, for the rules to read', () => {
    expect(documentToCreate('Claim', '/ws/claims/')).toMatchObject({
      type: 'Claim',
      path: '/ws/claims/',
      uid: '',
    });
    expect(documentToCreate('Claim', '/ws/claims').path).toBe('/ws/claims/');
    expect(documentToCreate('Claim', null).path).toBe('/');
  });

  it('drops every trailing slash and keeps the inner ones', () => {
    expect(documentToCreate('Claim', '/ws//claims///').path).toBe('/ws//claims/');
    expect(documentToCreate('Claim', '///').path).toBe('/');
  });

  it('reads a folder path of 100,000 slashes without stalling', () => {
    const started = performance.now();
    expect(documentToCreate('Claim', `${'/'.repeat(100_000)}x`).path).toHaveLength(100_002);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
