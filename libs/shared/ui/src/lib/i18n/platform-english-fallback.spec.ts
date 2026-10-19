import { Injectable, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MissingTranslationHandler,
  MissingTranslationHandlerParams,
  TranslateModule,
  TranslateService,
} from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_MISSING_TRANSLATION_NEXT,
  providePlatformEnglishFallback,
} from './platform-english-fallback';
import { PLATFORM_EN_TRANSLATIONS } from './platform-en';

@Injectable()
class HostHandler implements MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    return `host:${params.key}`;
  }
}

/** A host application with its own, partial catalogue — none of the app's `en.json`. */
function host(extraProviders: Provider[] = []): TranslateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [
      TranslateModule.forRoot({
        missingTranslationHandler: providePlatformEnglishFallback(),
        lang: 'fr',
        fallbackLang: 'fr',
      }),
    ],
    providers: extraProviders,
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('fr', { 'shared-ui': { 'confirm-dialog': { cancel: 'Annuler' } } });
  translate.use('fr');
  return translate;
}

describe('providePlatformEnglishFallback', () => {
  it('renders English for a platform key the host catalogue does not supply', () => {
    const translate = host();
    expect(translate.instant('shared-ui.share-dialog.copy-link')).toBe(
      PLATFORM_EN_TRANSLATIONS['shared-ui.share-dialog.copy-link'],
    );
    expect(translate.instant('rendition.pdf')).toBe('PDF');
  });

  it('interpolates parameters into the English, as a catalogue value would be', () => {
    const translate = host();
    expect(translate.instant('satori-components.pickers.remove', { name: 'Budget.xlsx' })).toBe(
      'Remove Budget.xlsx',
    );
  });

  it("leaves a key the host catalogue has to the host's translation", () => {
    const translate = host();
    expect(translate.instant('shared-ui.confirm-dialog.cancel')).toBe('Annuler');
  });

  it('returns an unknown key unchanged, as ngx-translate does without the fallback', () => {
    const translate = host();
    expect(translate.instant('host.only.key')).toBe('host.only.key');
  });

  it("hands keys it has no English for to the host's own handler", () => {
    const translate = host([{ provide: PLATFORM_MISSING_TRANSLATION_NEXT, useClass: HostHandler }]);
    expect(translate.instant('host.only.key')).toBe('host:host.only.key');
    expect(translate.instant('rendition.pdf')).toBe('PDF');
  });
});
