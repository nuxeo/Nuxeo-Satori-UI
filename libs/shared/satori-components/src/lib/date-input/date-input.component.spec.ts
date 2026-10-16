import {
  Component,
  Injectable,
  LOCALE_ID,
  provideZonelessChangeDetection,
  signal,
  type Provider,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, NativeDateAdapter, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { TranslateService } from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';

import { NxsDateInputComponent } from './date-input.component';
import { NxsDatepickerIntl, NxsLocaleDateAdapter, nxsParseLocaleDate } from './locale-date';

const day = (date: Date | null): string | null =>
  date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : date === null
      ? null
      : 'invalid';

describe('nxsParseLocaleDate', () => {
  const today = new Date(2026, 9, 13);

  it.each([
    ['fr', '03/04/2026', '2026-04-03'],
    ['en-US', '03/04/2026', '2026-03-04'],
    ['en-GB', '03/04/2026', '2026-04-03'],
    ['de', '03.04.2026', '2026-04-03'],
    ['nl', '03-04-2026', '2026-04-03'],
    ['ja', '2026/04/03', '2026-04-03'],
    ['zh', '2026/4/3', '2026-04-03'],
    ['th', '03/04/2026', '2026-04-03'],
    ['en-CA', '2026-04-03', '2026-04-03'],
    ['en-US', '2026-04-03', '2026-04-03'],
    ['fr', '2026-04-03', '2026-04-03'],
    ['fr', '03/04/26', '2026-04-03'],
    ['fr', '03/04/75', '1975-04-03'],
    ['fr', '3 avril 2026', '2026-04-03'],
    ['fr', '3 Apr 2026', '2026-04-03'],
    ['en-US', 'April 3, 2026', '2026-04-03'],
    ['de', '3. März 2026', '2026-03-03'],
    ['fr', '03/04', '2026-04-03'],
    ['en-US', '03/04', '2026-03-04'],
    ['fr', '03042026', '2026-04-03'],
    ['en-US', '04032026', '2026-04-03'],
    ['ja', '２０２６／０４／０３', '2026-04-03'],
    ['fr', '٠٣/٠٤/٢٠٢٦', '2026-04-03'],
    ['ja', '2026年4月3日', '2026-04-03'],
    ['fr', '  03/04/2026  ', '2026-04-03'],
    ['fr', '29/02/2028', '2028-02-29'],
    // A locale written as ngx-translate setups and POSIX often write it.
    ['fr_FR', '03/04/2026', '2026-04-03'],
    ['fr_FR.UTF-8', '03/04/2026', '2026-04-03'],
    ['en_US', '03/04/2026', '2026-03-04'],
    // A word the locale writes after a date, as the field writes it.
    ['bg', '03.04.2026 г.', '2026-04-03'],
    ['mk', '3.4.2026 г.', '2026-04-03'],
    ['bg', '03.04.2026 Г.', '2026-04-03'],
  ])('reads %s %j as %s', (locale, text, expected) => {
    expect(day(nxsParseLocaleDate(text, locale, today))).toBe(expected);
  });

  it.each([
    ['fr', '31/02/2026'],
    ['fr', '29/02/2026'],
    ['fr', '13/13/2026'],
    ['en-US', '13/04/2026'],
    ['fr', '00/04/2026'],
    ['fr', 'abc'],
    ['fr', '3 xyz 2026'],
    ['fr', '1/2/3/4'],
    ['fr', '2026'],
    ['en-US', 'April'],
    ['fr', '03.04.2026 г.'],
  ])('refuses %s %j', (locale, text) => {
    expect(day(nxsParseLocaleDate(text, locale, today))).toBe('invalid');
  });

  it.each(['', '   '])('reads blank %j as no date', (text) => {
    expect(nxsParseLocaleDate(text, 'fr', today)).toBeNull();
  });

  it('shows Thai dates with the Gregorian year it reads them in', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: 'th' }],
    });
    const adapter = TestBed.runInInjectionContext(() => new NxsLocaleDateAdapter());
    const shown = adapter.format(new Date(2026, 3, 3), { year: 'numeric' });
    expect(shown).toContain('2026');
    expect(day(adapter.parse('03/04/2026'))).toBe('2026-04-03');
  });
});

@Component({
  standalone: true,
  imports: [NxsDateInputComponent, ReactiveFormsModule],
  template: `<nxs-date-input
    label="Expires"
    [min]="min()"
    [max]="max()"
    [formControl]="expires"
  />`,
})
class HostComponent {
  readonly min = signal<Date | null>(null);
  readonly max = signal<Date | null>(null);
  readonly expires = new FormControl<Date | null>(null);
}

/** A date library's adapter, as a host might provide one. */
@Injectable()
class HostLibraryAdapter extends NativeDateAdapter {
  override parse(): Date | null {
    return new Date(2030, 0, 1);
  }
}

describe('NxsDateInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement => root().querySelector('input') as HTMLInputElement;
  const error = (): string | undefined => root().querySelector('mat-error')?.textContent?.trim();

  async function setup(locale: string, providers: Provider[] = []): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LOCALE_ID, useValue: locale },
        ...providers,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  }

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(text: string): Promise<void> {
    input().focus();
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await render();
  }

  async function leave(): Promise<void> {
    input().dispatchEvent(new Event('blur'));
    await render();
  }

  it('reads a typed date in the locale’s order: 3 April in French', async () => {
    await setup('fr');
    await type('03/04/2026');
    expect(day(host.expires.value)).toBe('2026-04-03');
    expect(host.expires.valid).toBe(true);
  });

  it('reports a date once, not again when the field commits it', async () => {
    await setup('fr');
    const values: (Date | null)[] = [];
    host.expires.valueChanges.subscribe((value) => values.push(value));
    await type('03/04/2026');
    input().dispatchEvent(new Event('change'));
    await render();
    expect(values.map(day)).toEqual(['2026-04-03']);
  });

  it('reads the same text as 4 March in American English', async () => {
    await setup('en-US');
    await type('03/04/2026');
    expect(day(host.expires.value)).toBe('2026-03-04');
  });

  it('replaces a host’s native adapter, which reads every date as American', async () => {
    await setup('fr', [provideNativeDateAdapter()]);
    await type('03/04/2026');
    expect(day(host.expires.value)).toBe('2026-04-03');
  });

  it('keeps a date adapter the host chose', async () => {
    await setup('fr', [{ provide: DateAdapter, useClass: HostLibraryAdapter }]);
    await type('anything');
    expect(day(host.expires.value)).toBe('2030-01-01');
  });

  it('refuses text that is not a date, with an example in the locale’s format', async () => {
    await setup('fr');
    await type('31/02/2026');
    expect(host.expires.value).toBeNull();
    expect(host.expires.hasError('nxsDateParse')).toBe(true);
    expect(input().value).toBe('31/02/2026');
    await leave();
    expect(error()).toBe('Enter a date like 31/12/2026');
  });

  it('clears the error once the text is a date', async () => {
    await setup('fr');
    await type('31/02/2026');
    await type('28/02/2026');
    expect(host.expires.valid).toBe(true);
    await leave();
    expect(error()).toBeUndefined();
  });

  it('refuses a date before min and after max', async () => {
    await setup('fr');
    host.min.set(new Date(2026, 0, 1));
    host.max.set(new Date(2026, 11, 31));
    await render();
    await type('31/12/2025');
    expect(host.expires.hasError('nxsDateMin')).toBe(true);
    await leave();
    expect(error()).toBe('Enter 01/01/2026 or later');
    await type('01/01/2027');
    expect(host.expires.hasError('nxsDateMax')).toBe(true);
    expect(error()).toBe('Enter 31/12/2026 or earlier');
  });

  it('shows a date the form holds in the locale’s format', async () => {
    await setup('fr');
    host.expires.setValue(new Date(2026, 3, 3));
    await render();
    expect(input().value).toBe('03/04/2026');
  });

  it('translates the calendar’s labels, following the catalogue', async () => {
    await setup('en-US');
    const intl = fixture.debugElement.children[0].injector.get(MatDatepickerIntl);
    expect(intl).toBeInstanceOf(NxsDatepickerIntl);
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { 'shared-ui': { datepicker: { 'open-calendar': 'Choose a day' } } },
      true,
    );
    await render();
    expect(root().querySelector('mat-datepicker-toggle button')?.getAttribute('aria-label')).toBe(
      'Choose a day',
    );
  });

  it('is disabled when the form disables it', async () => {
    await setup('fr');
    host.expires.disable();
    await render();
    expect(input().disabled).toBe(true);
  });
});
