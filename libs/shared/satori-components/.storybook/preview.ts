import { HttpClient, provideHttpClient } from '@angular/common/http';
import { inject, provideZonelessChangeDetection } from '@angular/core';
import {
  TranslateLoader,
  provideTranslateLoader,
  provideTranslateService,
  type TranslationObject,
} from '@ngx-translate/core';
import { setCompodocJson } from '@storybook/addon-docs/angular';
import { applicationConfig, type Preview } from '@storybook/angular';
import { of, type Observable } from 'rxjs';

import documentation from '../documentation.json';
import { ApiPage } from './api-page';
import { compodoc } from './compodoc';

/** The English catalogue, fetched once by `loadCatalogue` before the first story renders. */
let english: TranslationObject | null = null;

/**
 * A Storybook loader: runs before every story renders, and fetches the catalogue the first time.
 * With it in memory, `ApplicationCatalogueLoader` answers synchronously, so a story's first render
 * is already translated — a play function asserting a translated label, and the interaction runner
 * checking for untranslated keys, never race the request.
 */
async function loadCatalogue(): Promise<void> {
  if (english) return;
  const response = await fetch('i18n/en.json');
  if (response.ok) english = (await response.json()) as TranslationObject;
}

/**
 * The application's catalogue, served at `i18n/` by `main.ts`. Composite components translate their
 * own chrome under `satori-components.*` keys the application owns; text inputs still arrive
 * already translated, so a story passes them as plain strings.
 */
class ApplicationCatalogueLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<TranslationObject> {
    return lang === 'en' && english
      ? of(english)
      : this.http.get<TranslationObject>(`i18n/${lang}.json`);
  }
}

setCompodocJson(documentation);

type ArgTypesEnhancer = NonNullable<Preview['argTypesEnhancers']>[number];

/** Each component's `input.required()` inputs, as Compodoc reports them. */
const requiredInputs = new Map(
  compodoc.components.map((component) => [
    component.name,
    new Set(
      (component.inputsClass ?? []).filter((input) => input.required).map((input) => input.name),
    ),
  ]),
);

/**
 * The Controls table marks an input required from `argType.type.required`, which Storybook's
 * Compodoc reader never sets, so without this no input shows as required.
 */
const markRequiredInputs: ArgTypesEnhancer = ({ argTypes, component }) => {
  const required = requiredInputs.get(component?.name ?? '');
  if (!required?.size) return argTypes;
  return Object.fromEntries(
    Object.entries(argTypes).map(([name, argType]) => [
      name,
      required.has(name) && argType.type
        ? { ...argType, type: { ...argType.type, required: true } }
        : argType,
    ]),
  );
};

/** Zoneless, like the library's specs and both Storybook targets' `experimentalZoneless`. */
const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideTranslateService({
          loader: provideTranslateLoader(ApplicationCatalogueLoader),
          lang: 'en',
          fallbackLang: 'en',
        }),
      ],
    }),
  ],
  loaders: [loadCatalogue],
  argTypesEnhancers: [markRequiredInputs],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    docs: {
      // The `autodocs` page, which `main.ts` names "API". Overview pages are MDX and keep their own.
      page: ApiPage,
      toc: { title: 'Table of contents', headingSelector: 'h2, h3' },
      // Every live preview on a docs page shows its code, with Hide code and Copy beneath it, and
      // the zoom tools above it.
      canvas: { sourceState: 'shown', withToolbar: true },
    },
    options: {
      // Read from this file's syntax tree, not run, so written out in full: each group's
      // components list their Overview, then their API page, then their stories in file order.
      storySort: {
        includeNames: true,
        order: [
          'Getting started',
          'Navigation',
          ['*', ['Overview', 'API', '*']],
          'Search',
          ['*', ['Overview', 'API', '*']],
          'Tables',
          ['*', ['Overview', 'API', '*']],
          'Documents',
          ['*', ['Overview', 'API', '*']],
          'Panels',
          ['*', ['Overview', 'API', '*']],
          'Actions',
          ['*', ['Overview', 'API', '*']],
          'Dialogs',
          ['*', ['Overview', 'API', '*']],
          'Upload',
          ['*', ['Overview', 'API', '*']],
          'Pickers',
          ['*', ['Overview', 'API', '*']],
          'States',
          ['*', ['Overview', 'API', '*']],
          'Primitives',
          ['*', ['Overview', 'API', '*']],
          '*',
          ['*', ['Overview', 'API', '*']],
        ],
      },
    },
    // The panel observes; it does not judge. `docs/accessibility.md` gives the WCAG verdict to the
    // axe runtime layer alone, and `todo` reports a violation as a warning where `error` would
    // fail the story.
    a11y: { test: 'todo' },
  },
};

export default preview;
