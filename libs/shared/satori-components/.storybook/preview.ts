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
import type { Observable } from 'rxjs';

import documentation from '../../../../dist/compodoc/satori-components/documentation.json';

/**
 * The application's catalogue, served at `i18n/` by `main.ts`. Composite components translate their
 * own chrome under `satori-components.*` keys the application owns; text inputs still arrive
 * already translated, so a story passes them as plain strings.
 */
class ApplicationCatalogueLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`i18n/${lang}.json`);
  }
}

setCompodocJson(documentation);

type ArgTypesEnhancer = NonNullable<Preview['argTypesEnhancers']>[number];

/** Each component's `input.required()` inputs, as Compodoc reports them. */
const requiredInputs = new Map(
  documentation.components.map((component) => [
    component.name,
    new Set(
      (component.inputsClass ?? []).filter((input) => input.required).map((input) => input.name),
    ),
  ]),
);

/**
 * The Docs and Controls tables mark an input required from `argType.type.required`, which
 * Storybook's Compodoc reader never sets, so without this no input shows as required.
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

/** Zoneless, like the library's specs and `build-storybook`'s `experimentalZoneless`. */
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
  argTypesEnhancers: [markRequiredInputs],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    // The panel observes; it does not judge. `docs/accessibility.md` gives the WCAG verdict to the
    // axe runtime layer alone, and `todo` reports a violation as a warning where `error` would
    // fail the story.
    a11y: { test: 'todo' },
  },
};

export default preview;
