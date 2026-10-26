import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDatepickerIntl, MatDatepickerModule } from '@angular/material/datepicker';
import { TranslateService } from '@ngx-translate/core';
import { describe, expect, it, vi } from 'vitest';

import { provideSatoriDateAdapter } from '../date-adapter/satori-date-adapter';
import {
  TranslatedDatepickerIntl,
  provideTranslatedDatepickerIntl,
} from './translated-datepicker-intl';

@Component({
  standalone: true,
  imports: [MatDatepickerModule],
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl()],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './translated-datepicker-intl.host.html',
})
class PickerHostComponent {}

describe('TranslatedDatepickerIntl', () => {
  function setup(): { intl: MatDatepickerIntl; translate: TranslateService } {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslatedDatepickerIntl()],
    });
    return { intl: TestBed.inject(MatDatepickerIntl), translate: TestBed.inject(TranslateService) };
  }

  it('takes its labels from the English catalogue', () => {
    const { intl } = setup();
    expect(intl).toBeInstanceOf(TranslatedDatepickerIntl);
    expect(intl.openCalendarLabel).toBe('Open calendar');
    expect(intl.prevMultiYearLabel).toBe('Previous 24 years');
    expect(intl.formatYearRange('2016', '2039')).toBe('2016 \u2013 2039');
    expect(intl.formatYearRangeLabel('2016', '2039')).toBe('2016 to 2039');
  });

  it('switches language and tells the picker to re-render', () => {
    const { intl, translate } = setup();
    const changed = vi.fn();
    intl.changes.subscribe(changed);

    translate.setTranslation('fr', {
      'shared-ui': {
        datepicker: {
          'open-calendar': 'Ouvrir le calendrier',
          'year-range-label': 'de {{ start }} à {{ end }}',
        },
      },
    });
    translate.use('fr');

    expect(intl.openCalendarLabel).toBe('Ouvrir le calendrier');
    expect(intl.formatYearRangeLabel('2016', '2039')).toBe('de 2016 à 2039');
    expect(changed).toHaveBeenCalled();
  });

  it("keeps Material's English rather than a key the catalogue cannot supply", () => {
    const { intl, translate } = setup();
    translate.resetLang('en');
    translate.setTranslation('xx', {});
    translate.setFallbackLang('xx');
    translate.use('xx');

    expect(intl.closeCalendarLabel).toBe('Close calendar');
  });

  // `MatDatepickerModule` lists `MatDatepickerIntl` in its own providers, so a component that
  // imports it gets Material's English instance unless it provides ours itself — which is how a
  // root-only override left "Open calendar" English on every screen.
  it('reaches the toggle of a picker inside a component that imports MatDatepickerModule', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', { 'shared-ui': { datepicker: { 'open-calendar': 'Ouvrir' } } });
    translate.use('fr');

    const fixture = TestBed.createComponent(PickerHostComponent);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('mat-datepicker-toggle button');
    expect(toggle.getAttribute('aria-label')).toBe('Ouvrir');
  });
});
