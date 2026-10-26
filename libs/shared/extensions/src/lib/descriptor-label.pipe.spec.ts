import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { DescriptorLabelPipe } from './descriptor-label.pipe';

/**
 * The fallback the thirty-eight hand-written ternaries did not provide.
 *
 * The case that matters is the middle one: a descriptor WITH a `labelKey` that the catalogue
 * cannot resolve. The ternary rendered the key — `nav.browse` at the user — because
 * ngx-translate passes an unresolved key straight through. Everything else here exists so that
 * fixing it cannot quietly break the two cases that already worked.
 */
describe('DescriptorLabelPipe', () => {
  let pipe: DescriptorLabelPipe;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService(), DescriptorLabelPipe],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { nav: { browse: 'Browse' } }, true);
    translate.use('en');
    pipe = TestBed.inject(DescriptorLabelPipe);
  });

  it('prefers the resolved translation over the literal', () => {
    expect(pipe.transform({ label: 'Browse EN', labelKey: 'nav.browse' })).toBe('Browse');
  });

  it('falls back to the literal when the key does not resolve', () => {
    // The defect: this used to render `nav.missing`.
    expect(pipe.transform({ label: 'Browse EN', labelKey: 'nav.missing' })).toBe('Browse EN');
  });

  it('uses the literal when there is no key at all', () => {
    expect(pipe.transform({ label: 'Browse EN' })).toBe('Browse EN');
  });

  it('follows a language change, because it is impure', () => {
    translate.setTranslation('fr', { nav: { browse: 'Parcourir' } }, true);
    translate.use('fr');
    expect(pipe.transform({ label: 'Browse EN', labelKey: 'nav.browse' })).toBe('Parcourir');
  });

  it('renders nothing for a missing descriptor rather than throwing', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
