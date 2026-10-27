import {
  ApplicationRef,
  ChangeDetectionStrategy,
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
  NxsDocumentToolbarComponent,
  NxsErrorStateComponent,
  NxsRichTooltipComponent,
  NxsStatusTagComponent,
  NxsTabsComponent,
  NxsTagComponent,
  provideNxsComponents,
} from '@nuxeo/satori-platform/components';
import {
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
} from '@nuxeo/satori-platform/extensions';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriActionBarComponent } from './action-bar/satori-action-bar.component';
import { NxsSatoriAvatarComponent } from './avatar/satori-avatar.component';
import { NxsSatoriBreadcrumbsComponent } from './breadcrumbs/satori-breadcrumbs.component';
import { NxsSatoriErrorStateComponent } from './error-state/satori-error-state.component';
import { provideNxsSatoriComponents } from './provide-nxs-satori-components';
import { NxsSatoriRichTooltipComponent } from './rich-tooltip/satori-rich-tooltip.component';
import { NxsSatoriStatusTagComponent } from './status-tag/satori-status-tag.component';
import { NxsSatoriTabsComponent } from './tabs/satori-tabs.component';
import { NxsSatoriTagComponent } from './tag/satori-tag.component';

const PAIRS: readonly [string, Type<unknown>, Type<unknown>][] = [
  [NXS_PRIMITIVE_IDS.avatar, NxsAvatarComponent, NxsSatoriAvatarComponent],
  [NXS_PRIMITIVE_IDS.breadcrumbs, NxsBreadcrumbsComponent, NxsSatoriBreadcrumbsComponent],
  [NXS_PRIMITIVE_IDS.tag, NxsTagComponent, NxsSatoriTagComponent],
  [NXS_PRIMITIVE_IDS.statusTag, NxsStatusTagComponent, NxsSatoriStatusTagComponent],
  [NXS_PRIMITIVE_IDS.richTooltip, NxsRichTooltipComponent, NxsSatoriRichTooltipComponent],
  [NXS_PRIMITIVE_IDS.errorState, NxsErrorStateComponent, NxsSatoriErrorStateComponent],
  [NXS_PRIMITIVE_IDS.tabs, NxsTabsComponent, NxsSatoriTabsComponent],
  [NXS_PRIMITIVE_IDS.actionBar, NxsDocumentToolbarComponent, NxsSatoriActionBarComponent],
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

  it('re-registers the error state on Satori (Satori 1.0 ships sat-{401..500}-error-state)', () => {
    const components = registry([provideNxsComponents(), provideNxsSatoriComponents()]);
    expect(components.peek(NXS_PRIMITIVE_IDS.errorState)).toBe(NxsSatoriErrorStateComponent);
  });

  // A new ID with no Satori pair here would be registered on Material only, and every check below
  // would pass without it.
  it('pairs every primitive ID', () => {
    expect(PAIRS.map(([id]) => id).sort()).toEqual(Object.values(NXS_PRIMITIVE_IDS).sort());
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
    changeDetection: ChangeDetectionStrategy.Eager,
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

  /** Elements with `role="img"` that no `aria-hidden` subtree hides. */
  const exposedImages = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[role="img"]')).filter(
      (image) => !image.closest('[aria-hidden="true"]'),
    );

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

  // `sat-avatar` is `role="img"` itself and takes no name, so inside our named image it would be a
  // second, unnamed one.
  it('exposes exactly one image, the named wrapper', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, {
      initials: 'NK',
      label: 'Narasimha Koppula',
    });
    expect(exposedImages(host)).toEqual([host.querySelector('nxs-satori-avatar')]);
  });

  it('hides a label-less avatar from assistive technology', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials: 'NK' });
    const avatar = host.querySelector('nxs-satori-avatar');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(avatar?.hasAttribute('role')).toBe(false);
    expect(exposedImages(host)).toEqual([]);
  });

  it.each(['   ', '\u00a0', '\u3000', '\u200b', '\ufeff\u2060'])(
    'treats a label of only whitespace or zero-width characters %j as no label, as Material does',
    async (label) => {
      const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials: 'NK', label });
      const avatar = host.querySelector('nxs-satori-avatar');
      expect(avatar?.getAttribute('aria-hidden')).toBe('true');
      expect(avatar?.hasAttribute('role')).toBe(false);
      expect(avatar?.hasAttribute('aria-label')).toBe(false);
      expect(exposedImages(host)).toEqual([]);
    },
  );

  it('names the image without the whitespace around its label', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, {
      initials: 'ZÅ',
      label: ' Zoë Ångström\u00a0',
    });
    expect(host.querySelector('nxs-satori-avatar')?.getAttribute('aria-label')).toBe(
      'Zoë Ångström',
    );
  });

  // `sat-avatar` at size 24 reads `initials()[0]`; blank initials are valid in the contract.
  it.each(['', '   '])(
    'renders blank initials %j at size 24 as Material does: an empty circle',
    async (initials) => {
      const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials, size: '24' });
      expect(host.querySelector('nxs-satori-avatar sat-avatar')?.textContent?.trim()).toBe('');
    },
  );

  it('shows one initial at size 24, as Material does', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.avatar, { initials: 'nk', size: '24' });
    expect(host.querySelector('nxs-satori-avatar sat-avatar')?.textContent?.trim()).toBe('N');
  });

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

  it('names the navigation landmark from our label, as Material does', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.breadcrumbs, {
      label: 'Fil d’Ariane',
      items: [{ label: 'Domain', href: '/d' }, { label: 'Contracts' }],
    });
    const landmarks = host.querySelectorAll('nxs-satori-breadcrumbs nav');
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].getAttribute('aria-label')).toBe('Fil d’Ariane');
  });

  it('keeps our label when Satori re-renders its own name later', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.breadcrumbs, {
      label: 'Fil d’Ariane',
      items: [{ label: 'Contracts' }],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { sat: { breadcrumbs: { breadcrumbs: 'Breadcrumbs' } } });
    translate.use('en');
    await TestBed.inject(ApplicationRef).whenStable();
    expect(host.querySelector('nxs-satori-breadcrumbs nav')?.getAttribute('aria-label')).toBe(
      'Fil d’Ariane',
    );
  });

  it("gives the landmark Satori's own name back when our label is cleared", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
      ],
    });
    const fixture = TestBed.createComponent(NxsSatoriBreadcrumbsComponent);
    const nav = () => (fixture.nativeElement as HTMLElement).querySelector('nav');
    fixture.componentRef.setInput('items', [{ label: 'Contracts' }]);
    fixture.componentRef.setInput('label', 'Fil d’Ariane');
    await fixture.whenStable();
    expect(nav()?.getAttribute('aria-label')).toBe('Fil d’Ariane');
    fixture.componentRef.setInput('label', '');
    await fixture.whenStable();
    expect(nav()?.getAttribute('aria-label')).toBe('sat.breadcrumbs.breadcrumbs');
  });

  it('renders each new trail on a new sat-breadcrumbs, so Satori measures it, and keeps our label', async () => {
    // Satori runs its fitting only when it starts or its box resizes, never when its items change,
    // so a trail handed to the same instance after navigation overflowed until the window resized.
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
      ],
    });
    const fixture = TestBed.createComponent(NxsSatoriBreadcrumbsComponent);
    const el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Fil d’Ariane');
    fixture.componentRef.setInput('items', [{ label: 'Domain', href: '/d' }, { label: 'Claims' }]);
    await fixture.whenStable();
    const first = el.querySelector('sat-breadcrumbs');

    fixture.componentRef.setInput('items', [
      { label: 'Domain', href: '/d' },
      { label: 'Claims', href: '/d/claims' },
      { label: 'Claim 42' },
    ]);
    await fixture.whenStable();
    const second = el.querySelectorAll('sat-breadcrumbs');
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first);
    expect(second[0].textContent).toContain('Claim 42');
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Fil d’Ariane');

    fixture.componentRef.setInput('label', 'Breadcrumb trail');
    await fixture.whenStable();
    expect(el.querySelector('sat-breadcrumbs')).toBe(second[0]);
  });

  it("leaves Satori's own name on the landmark when our label is blank", async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.breadcrumbs, {
      label: '  ',
      items: [{ label: 'Contracts' }],
    });
    expect(host.querySelector('nxs-satori-breadcrumbs nav')?.getAttribute('aria-label')).toBe(
      'sat.breadcrumbs.breadcrumbs',
    );
  });

  it('renders the rich tooltip as a named Satori trigger', async () => {
    const host = await renderById(NXS_PRIMITIVE_IDS.richTooltip, {
      heading: 'Versioning',
      content: 'A new version each check-in.',
      triggerLabel: 'About versioning',
    });
    const trigger = host.querySelector('nxs-satori-rich-tooltip button');
    expect(trigger?.getAttribute('aria-label')).toBe('About versioning');
    expect(trigger?.querySelector('mat-icon')?.getAttribute('data-mat-icon-name')).toBe('info');
    expect(host.querySelector('nxs-satori-rich-tooltip sat-rich-tooltip')).not.toBeNull();
  });

  // The inputs a host passes through the outlet, since it can project no body and bind no output.
  it('renders the tabs on sat-navigation-tabs, with the body and select handler the outlet passes', async () => {
    const calls: [string, number][] = [];
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [ExtensionOutletComponent],
      template: ` <ng-template #body let-tab
          ><p class="probe-body">{{ tab.label }} body</p></ng-template
        >
        <lib-extension-outlet
          [componentId]="id"
          [componentInputs]="{ tabs, selectedIndex: 0, body, selectHandler }"
        />`,
    })
    class TabsHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.tabs;
      readonly tabs = [
        { id: 'app.tabs.view', label: 'View' },
        { id: 'app.tabs.history', label: 'History' },
      ];
      readonly selectHandler = (tab: { id: string }, index: number) => calls.push([tab.id, index]);
    }

    TestBed.configureTestingModule({
      imports: [TabsHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    });
    const fixture = TestBed.createComponent(TabsHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('nxs-satori-tabs sat-navigation-tabs')).not.toBeNull();
    expect(host.querySelector('nxs-tabs')).toBeNull();
    expect(
      host.querySelector('[role="tabpanel"]:not([hidden]) .probe-body')?.textContent?.trim(),
    ).toBe('View body');

    host.querySelectorAll<HTMLElement>('a[satNavigationTab]')[1].click();
    await fixture.whenStable();
    expect(calls).toEqual([['app.tabs.history', 1]]);
    expect(
      host.querySelector('[role="tabpanel"]:not([hidden]) .probe-body')?.textContent?.trim(),
    ).toBe('History body');
  });

  it("renders the action bar on Satori's action-bar buttons, calling the handler the outlet passes", async () => {
    const ran: string[] = [];
    const host = await renderById(NXS_PRIMITIVE_IDS.actionBar, {
      actions: [
        { id: 'app.toolbar.edit', label: 'Edit', icon: 'edit' },
        { id: 'app.toolbar.share', label: 'Share', icon: 'share', overflow: true },
      ],
      actionHandler: (action: { id: string }) => ran.push(action.id),
    });
    const edit = host.querySelector<HTMLElement>(
      'nxs-satori-action-bar button[data-action-id="app.toolbar.edit"]',
    );
    expect(edit?.classList).toContain('sat-action-bar-button');
    expect(host.querySelector('nxs-document-toolbar')).toBeNull();
    expect(host.querySelector('.nxs-satori-action-bar__more')?.classList).toContain(
      'sat-action-bar-button',
    );
    edit?.click();
    expect(ran).toEqual(['app.toolbar.edit']);
  });
});
