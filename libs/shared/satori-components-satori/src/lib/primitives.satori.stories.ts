import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { provideAndConfigureSatoriUITranslations } from '@hylandsoftware/satori-ui/translations';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { NXS_PRIMITIVE_IDS, provideNxsComponents } from '@nuxeo-satori/platform/components';
import { ExtensionOutletComponent } from '@nuxeo-satori/platform/extensions';

import { provideNxsSatoriComponents } from './provide-nxs-satori-components';

/**
 * The same template and inputs as `satori-components`' "Primitives/By registered ID" story, with
 * `provideNxsSatoriComponents()` listed after `provideNxsComponents()`: each ID now resolves to
 * its Satori implementation, and nothing in the template changed.
 *
 * Also what a host owes Satori: `provideSatori()` for the theme and icons, and Satori's `sat.*`
 * catalogue — here through upstream's `provideAndConfigureSatoriUITranslations`.
 */
const meta: Meta = {
  title: 'Primitives/By registered ID',
  decorators: [
    applicationConfig({
      providers: [
        provideAndConfigureSatoriUITranslations({ fallbackLang: 'en' }),
        provideRouter([], withDisabledInitialNavigation()),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    }),
    moduleMetadata({ imports: [ExtensionOutletComponent] }),
  ],
};

export default meta;

export const SatoriRegistration: StoryObj = {
  render: () => ({
    props: {
      ids: NXS_PRIMITIVE_IDS,
      avatar: { initials: 'NK', color: 'teal', label: 'Narasimha Koppula' },
      breadcrumbs: {
        label: 'Breadcrumbs',
        items: [{ label: 'Domain', routerLink: ['/browse'] }, { label: 'Contracts' }],
      },
      tag: { label: 'Invoice', color: 'purple' },
      tooltip: {
        heading: 'Versioning',
        content: 'A new version is created each time you check in.',
        triggerLabel: 'About versioning',
      },
    },
    template: `
      <div style="display: grid; gap: 16px; justify-items: start">
        <lib-extension-outlet [componentId]="ids.avatar" [componentInputs]="avatar" />
        <lib-extension-outlet [componentId]="ids.breadcrumbs" [componentInputs]="breadcrumbs" />
        <lib-extension-outlet [componentId]="ids.tag" [componentInputs]="tag" />
        <lib-extension-outlet [componentId]="ids.richTooltip" [componentInputs]="tooltip" />
      </div>
    `,
  }),
};
