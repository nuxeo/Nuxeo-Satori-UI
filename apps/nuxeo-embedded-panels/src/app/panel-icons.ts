import { DOCUMENT } from '@angular/common';
import {
  APP_INITIALIZER,
  EnvironmentInjector,
  type EnvironmentProviders,
  createEnvironmentInjector,
  inject,
  provideAppInitializer,
  runInInjectionContext,
} from '@angular/core';
import { provideSatoriIcons } from '@hylandsoftware/satori-ui/icons';

/**
 * What Satori's icon provider is given for a document: a root element that keeps nothing. The
 * provider marks the document's root element with a class and a custom property for its form
 * fields' error icon; in another system's page that root element is the page's, and the panel
 * shows no form field, so the marks would only reach the page.
 */
export const QUIET_DOCUMENT = {
  documentElement: {
    classList: { add: () => undefined },
    style: { setProperty: () => undefined },
  },
};

/**
 * Satori's icon set, from beside the panel's script, registered for the panel's components as
 * `provideSatoriIcons` registers it, but run in an injector of its own whose document is
 * {@link QUIET_DOCUMENT}: the icons are the registry's, which the panel's application holds, and the
 * page's root element is left as it was. The steps file checks the page's root element after the
 * panel has drawn.
 */
export function providePanelIcons(svgPath: string): EnvironmentProviders {
  return provideAppInitializer(() => {
    const quiet = createEnvironmentInjector(
      [provideSatoriIcons({ svgPath }), { provide: DOCUMENT, useValue: QUIET_DOCUMENT }],
      inject(EnvironmentInjector),
    );
    const initializers = quiet.get(APP_INITIALIZER, [], {
      self: true,
    }) as readonly (() => unknown)[];
    return Promise.all(initializers.map((run) => runInInjectionContext(quiet, run))).finally(() =>
      quiet.destroy(),
    );
  });
}
