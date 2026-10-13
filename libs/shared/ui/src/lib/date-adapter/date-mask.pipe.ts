import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

import { dateMaskFor } from './date-mask';

/**
 * `{{ 'common.date-mask' | translate | dateMask }}` — the translated date hint, reordered into
 * the active region's field order.
 *
 * It takes the translated value rather than the key so that `TranslatePipe` upstream keeps
 * owning the language: that pipe is already impure and re-emits on a language change, so this
 * one can stay pure and reshape whatever it is handed. `LOCALE_ID` cannot change without a
 * reload, so there is nothing else here to react to.
 */
@Pipe({
  name: 'dateMask',
  standalone: true,
})
export class DateMaskPipe implements PipeTransform {
  private readonly localeId = inject(LOCALE_ID);

  transform(translatedMask: string | null | undefined): string {
    return dateMaskFor(this.localeId, translatedMask ?? '');
  }
}
