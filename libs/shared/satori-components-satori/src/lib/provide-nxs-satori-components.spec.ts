import {
  Component,
  provideZonelessChangeDetection,
  reflectComponentType,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import {
  NXS_PRIMITIVE_IDS,
  NxsAvatarComponent,
  NxsBreadcrumbsComponent,
  NxsRichTooltipComponent,
  NxsTagComponent,
  provideNxsComponents,
} from '@nuxeo-satori/platform/components';
import {
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
} from '@nuxeo-satori/platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriAvatarComponent } from './avatar/satori-avatar.component';
import { NxsSatoriBreadcrumbsComponent } from './breadcrumbs/satori-breadcrumbs.component';
import { provideNxsSatoriComponents } from './provide-nxs-satori-components';
import { NxsSatoriRichTooltipComponent } from './rich-tooltip/satori-rich-tooltip.component';
import { NxsSatoriTagComponent } from './tag/satori-tag.component';

const PAIRS: readonly [string, Type<unknown>, Type<unknown>][] = [
  [NXS_PRIMITIVE_IDS.avatar, NxsAvatarComponent, NxsSatoriAvatarComponent],
  [NXS_PRIMITIVE_IDS.breadcrumbs, NxsBreadcrumbsComponent, NxsSatoriBreadcrumbsComponent],
  [NXS_PRIMITIVE_IDS.tag, NxsTagComponent, NxsSatoriTagComponent],
  [NXS_PRIMITIVE_IDS.richTooltip, NxsRichTooltipComponent, NxsSatoriRichTooltipComponent],
];

function registry(providers: (Provider | EnvironmentProviders)[]): ExtensionComponentRegistry {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...providers] });
  return TestBed.inject(ExtensionComponentRegistry);
}

describe('provideNxsSatoriComponents', () => {
  it('re-registers every primitive ID on Satori when listed after the Material registration', () => {
    const components = registry([provideNxsComponents(), provideNxsSatoriComponents()]);
    for (const [id, , satori] of PAIRS) expect(components.peek(id)).toBe(satori);
  });

  it('leaves Material in place for a host that provides only the base registration', () => {
    const components = registry([provideNxsComponents()]);
    for (const [id, material] of PAIRS) expect(components.peek(id)).toBe(material);
  });

  it('loses to the Material registration when listed before it — the order is the contract', () => {
    const components = registry([provideNxsSatoriComponents(), provideNxsComponents()]);
    for (const [id, material] of PAIRS) expect(components.peek(id)).toBe(material);
  });

  // Whoever renders an ID passes the same `componentInputs` whichever implementation is
  // registered, and the outlet sets only inputs the component declares — so a name missing on one
  // side is silently dropped there. `implements Nxs…Inputs` catches a missing input at compile
  // time; this catches an extra one, which the interface cannot.
  it.each(PAIRS)(
    '%s declares the same inputs on Satori as on Material',
    (_id, material, satori) => {
      const names = (type: Type<unknown>) =>
        reflectComponentType(type)
          ?.inputs.map((declared) => declared.templateName)
          .sort();
      expect(names(satori)).toEqual(names(material));
      expect(names(material)?.length).toBeGreaterThan(0);
    },
  );
});

describe('the Satori primitives, rendered by ID', () => {
  @Component({
    standalone: true,
    imports: [ExtensionOutletComponent],
    template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
  })
  class OutletHostComponent {
    id = '';
    inputs: Record<string, unknown> = {};
  }

  async function renderById(id: string, inputs: Record<string, unknown>): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    });
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.componentInstance.id = id;
    fixture.componentInstance.inputs = inputs;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the avatar on sat-avatar, named by its label', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, {
      initials: 'NK',
      color: 'teal',
      label: 'Narasimha Koppula',
    });
    const avatar = host.querySelector('nxs-satori-avatar');
    expect(avatar?.getAttribute('role')).toBe('img');
    expect(avatar?.getAttribute('aria-label')).toBe('Narasimha Koppula');
    expect(avatar?.querySelector('sat-avatar')?.textContent).toContain('NK');
    expect(host.querySelector('nxs-avatar')).toBeNull();
  });

  it('hides a label-less avatar from assistive technology', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials: 'NK' });
    const avatar = host.querySelector('nxs-satori-avatar');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(avatar?.hasAttribute('role')).toBe(false);
  });

  // `sat-avatar` at size 24 reads `initials()[0]`; blank initials are valid in the contract.
  it.each(['', '   '])(
    'renders blank initials %j at size 24 as Material does: an empty circle',
    async (initials) => {
      const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials, size: '24' });
      expect(host.querySelector('nxs-satori-avatar sat-avatar')?.textContent?.trim()).toBe('');
    },
  );

  it('shows the initials Material shows: trimmed, upper-cased, at most two', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials: ' nkx ' });
    expect(host.querySelector('nxs-satori-avatar sat-avatar')?.textContent?.trim()).toBe('NK');
  });

  it('renders the tag on sat-category-tag with its label', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.tag, { label: 'Invoice', color: 'teal' });
    expect(host.querySelector('nxs-satori-tag sat-category-tag')?.textContent?.trim()).toBe(
      'Invoice',
    );
  });

  it('renders the breadcrumbs on sat-breadcrumbs, mapping each kind of item', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.breadcrumbs, {
      items: [
        { label: 'Domain', routerLink: ['/browse'], queryParams: { path: '/d' } },
        { label: 'Folder', routerLink: '/browse' },
        { label: 'Help', href: 'https://doc.nuxeo.com/' },
        { label: 'Contracts' },
      ],
    });
    const crumbs = host.querySelector('nxs-satori-breadcrumbs sat-breadcrumbs');
    expect(crumbs).not.toBeNull();
    expect(crumbs?.querySelector('nav')).not.toBeNull();
    expect(crumbs?.textContent).toContain('Contracts');
  });

  it('renders the rich tooltip as a named Satori trigger', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.richTooltip, {
      heading: 'Versioning',
      content: 'A new version each check-in.',
      triggerLabel: 'About versioning',
    });
    const trigger = host.querySelector('nxs-satori-rich-tooltip button');
    expect(trigger?.getAttribute('aria-label')).toBe('About versioning');
    expect(trigger?.querySelector('mat-icon')?.textContent?.trim()).toBe('info');
    expect(host.querySelector('nxs-satori-rich-tooltip sat-rich-tooltip')).not.toBeNull();
  });
});
