import { Injectable, Provider } from '@angular/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { TranslatedDatepickerIntl as ComponentDatepickerIntl } from '@nuxeo/satori-platform/components';

/** Compatibility name for screens that provide the calendar labels through the UI entry point. */
@Injectable()
export class TranslatedDatepickerIntl extends ComponentDatepickerIntl {}

/** Replaces Material's English `MatDatepickerIntl` for this component and its date pickers. */
export function provideTranslatedDatepickerIntl(): Provider {
  return { provide: MatDatepickerIntl, useClass: TranslatedDatepickerIntl };
}
