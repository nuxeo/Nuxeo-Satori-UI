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
  NxsCardComponent,
  NxsDocumentToolbarComponent,
  NxsDropzoneComponent,
  NxsEmptyStateComponent,
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
import { NxsSatoriCardComponent } from './card/satori-card.component';
import { NxsSatoriEmptyStateComponent } from './empty-state/satori-empty-state.component';
import { NxsSatoriErrorStateComponent } from './error-state/satori-error-state.component';
import { provideNxsSatoriComponents } from './provide-nxs-satori-components';
import { NxsSatoriRichTooltipComponent } from './rich-tooltip/satori-rich-tooltip.component';
import { NxsSatoriStatusTagComponent } from './status-tag/satori-status-tag.component';
import { NxsSatoriTabsComponent } from './tabs/satori-tabs.component';
import { NxsSatoriTagComponent } from './tag/satori-tag.component';
import { NxsSatoriUploadComponent } from './upload/satori-upload.component';

const PAIRS: readonly [string, Type<unknown>, Type<unknown>][] = [
  [NXS_PRIMITIVE_IDS.avatar, NxsAvatarComponent, NxsSatoriAvatarComponent],
  [NXS_PRIMITIVE_IDS.breadcrumbs, NxsBreadcrumbsComponent, NxsSatoriBreadcrumbsComponent],
  [NXS_PRIMITIVE_IDS.tag, NxsTagComponent, NxsSatoriTagComponent],
  [NXS_PRIMITIVE_IDS.statusTag, NxsStatusTagComponent, NxsSatoriStatusTagComponent],
  [NXS_PRIMITIVE_IDS.richTooltip, NxsRichTooltipComponent, NxsSatoriRichTooltipComponent],
  [NXS_PRIMITIVE_IDS.errorState, NxsErrorStateComponent, NxsSatoriErrorStateComponent],
  [NXS_PRIMITIVE_IDS.tabs, NxsTabsComponent, NxsSatoriTabsComponent],
  [NXS_PRIMITIVE_IDS.actionBar, NxsDocumentToolbarComponent, NxsSatoriActionBarComponent],
  [NXS_PRIMITIVE_IDS.card, NxsCardComponent, NxsSatoriCardComponent],
  [NXS_PRIMITIVE_IDS.emptyState, NxsEmptyStateComponent, NxsSatoriEmptyStateComponent],
  [NXS_PRIMITIVE_IDS.upload, NxsDropzoneComponent, NxsSatoriUploadComponent],
];

/**
 * Primitives no Satori component re-registers, so they keep their Material implementation with
 * or without `provideNxsSatoriComponents()`. The banner and chip set are Material-only until their
 * Satori wrappers are written; `docs/extension-reference.md` §6a says so too. The card, the empty
 * state and the upload each left this list as NXSAT-675 wrapped Satori's interactive card, empty
 * state and upload field, and are in `PAIRS` above.
 *
 * An ID added here needs its reason beside it, because the list is what tells the check below that
 * Material-only was the intention and not an omission.
 */
const MATERIAL_ONLY: readonly string[] = [NXS_PRIMITIVE_IDS.banner, NXS_PRIMITIVE_IDS.chipSet];

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
  // would pass without it — unless it is listed in MATERIAL_ONLY, on purpose and with its reason.
  it('pairs every primitive ID, but those deliberately left on Material', () => {
    expect([...PAIRS.map(([id]) => id), ...MATERIAL_ONLY].sort()).toEqual(
      Object.values(NXS_PRIMITIVE_IDS).sort(),
    );
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

/**
 * The card is the one primitive whose Satori component acts on a click of its own: `SatInteractiveCard`
 * listens on itself and, for a target outside `a, input, button, select, textarea`, clicks the
 * projected selection control if there is one and the title otherwise. The wrapper's whole design is
 * about what that fall-through reaches, so these are behaviour tests rather than render checks.
 *
 * What a click does cannot be read off the Material card in jsdom — there it comes from a
 * `::after` stretched over a positioned surface, and jsdom lays nothing out — so the parity these
 * assert is against the Material card's documented behaviour, exercised in its own story's
 * `play()`: the heading opens it, the media and the background open it, and the checkbox, the corner
 * control and the footer actions do not.
 */
describe('the Satori card, rendered by nxs.primitives.card', () => {
  let opened: number;
  let selections: boolean[];

  @Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
    imports: [ExtensionOutletComponent],
    template: `<ng-template #media
        ><span class="probe-media" aria-hidden="true">▣</span></ng-template
      >
      <ng-template #headerAction>
        <button class="probe-menu" type="button" aria-label="Document actions">⋯</button>
      </ng-template>
      <ng-template #actions>
        <button class="probe-favorite" type="button" aria-label="Add to Favorites">★</button>
      </ng-template>
      <lib-extension-outlet
        [componentId]="id"
        [componentInputs]="{
          heading,
          subheading,
          selected,
          selectionLabel,
          selectionHandler,
          openHandler,
          media: withMedia ? media : null,
          headerAction: withHeaderAction ? headerAction : null,
          actions: withActions ? actions : null,
        }"
      />`,
  })
  class CardHostComponent {
    readonly id = NXS_PRIMITIVE_IDS.card;
    heading = 'Claim 42 — water damage.pdf';
    subheading = 'File';
    selected = false;
    selectionLabel = 'Select Claim 42 — water damage.pdf';
    selectionHandler: ((selected: boolean) => void) | null = (value) => selections.push(value);
    openHandler: (() => void) | null = () => (opened += 1);
    withMedia = true;
    withHeaderAction = false;
    withActions = false;
  }

  async function renderCard(
    patch: Partial<CardHostComponent> = {},
  ): Promise<{ host: HTMLElement; card: HTMLElement }> {
    TestBed.configureTestingModule({
      imports: [CardHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    });
    const fixture = TestBed.createComponent(CardHostComponent);
    Object.assign(fixture.componentInstance, patch);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('sat-interactive-card');
    expect(card).not.toBeNull();
    return { host, card: card as HTMLElement };
  }

  beforeEach(() => {
    opened = 0;
    selections = [];
  });

  it("renders Satori's interactive card, and no Material card", async () => {
    const { host } = await renderCard();
    expect(host.querySelector('nxs-satori-card sat-interactive-card')).not.toBeNull();
    expect(host.querySelector('nxs-card')).toBeNull();
    expect(host.querySelector('mat-card')).toBeNull();
  });

  it('opens the item from the heading, which is the control that names it', async () => {
    const { host } = await renderCard();
    const heading = host.querySelector<HTMLElement>('button.nxs-satori-card__heading');
    expect(heading?.textContent?.trim()).toBe('Claim 42 — water damage.pdf');
    heading?.click();
    expect(opened).toBe(1);
  });

  // In a browser the heading's stretched `::after` takes this click, as it does on the Material
  // card. In jsdom nothing is laid out, so what runs here is Satori's fall-through to the title —
  // the same `openHandler`, by the other of the two paths. Either way it opens and does not select,
  // which is the claim.
  it('opens the item from a click on the card itself, and does not select it', async () => {
    const { card } = await renderCard();
    card.click();
    expect(opened).toBe(1);
    expect(selections).toEqual([]);
  });

  it('opens nothing from a background click when there is no openHandler', async () => {
    const { host, card } = await renderCard({ openHandler: null });
    expect(host.querySelector('button.nxs-satori-card__heading')).toBeNull();
    expect(host.querySelector('span.nxs-satori-card__heading')?.textContent?.trim()).toBe(
      'Claim 42 — water damage.pdf',
    );
    card.click();
    expect(opened).toBe(0);
  });

  it('toggles selection from the checkbox and calls the handler with the new state', async () => {
    const { host } = await renderCard();
    const input = host.querySelector<HTMLInputElement>('mat-checkbox input[type="checkbox"]');
    expect(input?.getAttribute('aria-label')).toBe('Select Claim 42 — water damage.pdf');
    input?.click();
    expect(selections).toEqual([true]);
  });

  // The trap this wrapper exists to avoid. Material's checkbox puts a `<div>` touch target over its
  // input, so a real press often lands on an element Satori's early return does not cover — and the
  // fall-through would then open the document as well as tick the box.
  it('does not also open the item when the press lands beside the checkbox input', async () => {
    const { host } = await renderCard();
    // Found, not optional-chained away: a selector that stopped matching would click nothing, and
    // `opened === 0` would then be a pass reporting that no press happened at all.
    const box = host.querySelector<HTMLElement>('mat-checkbox');
    const touchTarget = host.querySelector<HTMLElement>('.mat-mdc-checkbox-touch-target');
    expect(box).not.toBeNull();
    expect(touchTarget, 'Material still renders a div touch target over the input').not.toBeNull();
    box?.click();
    touchTarget?.click();
    expect(opened).toBe(0);
  });

  it('does not open the item from the corner control or a footer button', async () => {
    const { host } = await renderCard({ withHeaderAction: true, withActions: true });
    const menu = host.querySelector<HTMLElement>('.probe-menu');
    const favorite = host.querySelector<HTMLElement>('.probe-favorite');
    expect(menu).not.toBeNull();
    expect(favorite).not.toBeNull();
    menu?.click();
    favorite?.click();
    expect(opened).toBe(0);
  });

  // The one behaviour difference from the Material card, asserted rather than left to be found: the
  // padding around those controls opens the item here, where on Material it does nothing. A wider
  // hit area, never a different action.
  it('opens the item from the padding around the corner and footer controls', async () => {
    const { host } = await renderCard({ withHeaderAction: true, withActions: true });
    host.querySelector<HTMLElement>('.nxs-satori-card__corner')?.click();
    host.querySelector<HTMLElement>('sat-interactive-card-actions')?.click();
    expect(opened).toBe(2);
    expect(selections).toEqual([]);
  });

  it('renders the media, corner and footer templates the outlet passes', async () => {
    const { host } = await renderCard({ withHeaderAction: true, withActions: true });
    expect(host.querySelector('sat-interactive-card-content .probe-media')).not.toBeNull();
    expect(host.querySelector('.nxs-satori-card__corner .probe-menu')).not.toBeNull();
    expect(host.querySelector('sat-interactive-card-actions .probe-favorite')).not.toBeNull();
    expect(host.querySelector('[satInteractiveCardSubtitle]')?.textContent?.trim()).toBe('File');
  });

  it.each(['', '   ', '\u00a0', '\u200b'])(
    'renders no checkbox for a selection label of %j, as Material does',
    async (selectionLabel) => {
      const { host } = await renderCard({ selectionLabel });
      expect(host.querySelector('mat-checkbox')).toBeNull();
    },
  );

  it('renders no header slot at all when there is neither a checkbox nor a corner control', async () => {
    const { host } = await renderCard({ selectionLabel: '' });
    expect(host.querySelector('.nxs-satori-card__corner')).toBeNull();
  });

  it('nests no control inside another (WCAG 4.1.2)', async () => {
    const { host } = await renderCard({ withHeaderAction: true, withActions: true });
    expect(host.querySelectorAll('button button, button a, a button')).toHaveLength(0);
    expect(host.querySelector('button.nxs-satori-card__heading input')).toBeNull();
  });

  it("marks a selected card with Satori's own active state", async () => {
    const { card } = await renderCard({ selected: true });
    expect(card.classList).toContain('sat-interactive-card-active');
  });

  // Satori outlines a card it can act on; Material's draws the same distinction as outlined versus
  // filled.
  it('outlines a card that opens something', async () => {
    const { card } = await renderCard();
    expect(card.classList).toContain('sat-interactive-card-border');
  });

  it('leaves a card that opens nothing without an outline', async () => {
    const { card } = await renderCard({ openHandler: null });
    expect(card.classList).not.toContain('sat-interactive-card-border');
  });

  it('hides a blank subheading, as Material does', async () => {
    const { host } = await renderCard({ subheading: '  ' });
    expect(host.querySelector('[satInteractiveCardSubtitle]')).toBeNull();
  });
});

/**
 * The empty state is announced, so the thing worth asserting is the live region rather than any
 * particular element: the Material implementation puts `role="status"` on its own host, Satori's
 * `sat-empty-state` carries it itself, and the wrapper's host deliberately does not add a second.
 * Both must end up with exactly one.
 */
describe('the Satori empty state, rendered by nxs.primitives.emptyState', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
    imports: [ExtensionOutletComponent],
    template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
  })
  class EmptyStateOutletHost {
    id = NXS_PRIMITIVE_IDS.emptyState as string;
    inputs: Record<string, unknown> = {};
  }

  async function renderEmptyState(
    inputs: Record<string, unknown>,
    satori = true,
  ): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [EmptyStateOutletHost],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
        provideNxsComponents(),
        ...(satori ? [provideNxsSatoriComponents()] : []),
      ],
    });
    const fixture = TestBed.createComponent(EmptyStateOutletHost);
    fixture.componentInstance.inputs = inputs;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Every `role="status"` no `aria-hidden` subtree hides. */
  const liveRegions = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[role="status"]')).filter(
      (region) => !region.closest('[aria-hidden="true"]'),
    );

  it("renders Satori's empty state, and no Material one", async () => {
    const host = await renderEmptyState({ heading: 'No documents here' });
    expect(host.querySelector('nxs-satori-empty-state sat-empty-state')).not.toBeNull();
    expect(host.querySelector('nxs-empty-state')).toBeNull();
  });

  it('announces the emptiness through exactly one live region', async () => {
    const host = await renderEmptyState({ heading: 'No documents here' });
    const regions = liveRegions(host);
    expect(regions).toHaveLength(1);
    expect(regions[0].tagName.toLowerCase()).toBe('sat-empty-state');
    expect(regions[0].textContent).toContain('No documents here');
  });

  it('announces through exactly one live region on Material too, which is the parity that matters', async () => {
    const host = await renderEmptyState({ heading: 'No documents here' }, false);
    const regions = liveRegions(host);
    expect(regions).toHaveLength(1);
    expect(regions[0].tagName.toLowerCase()).toBe('nxs-empty-state');
  });

  it('renders the heading at the level the host asked for', async () => {
    const host = await renderEmptyState({ heading: 'No results', headingLevel: 3 });
    expect(host.querySelector('h3[satEmptyStateHeadline]')?.textContent?.trim()).toBe('No results');
    expect(host.querySelector('h2[satEmptyStateHeadline]')).toBeNull();
  });

  it('defaults the heading to level 2, as Material does', async () => {
    const host = await renderEmptyState({ heading: 'No results' });
    expect(host.querySelector('h2[satEmptyStateHeadline]')).not.toBeNull();
  });

  it('shows the message as the description', async () => {
    const host = await renderEmptyState({
      heading: 'No documents here',
      message: 'Drag a file in to get started.',
    });
    expect(host.querySelector('[satEmptyStateDescription]')?.textContent?.trim()).toBe(
      'Drag a file in to get started.',
    );
  });

  it('omits the description when there is no message', async () => {
    const host = await renderEmptyState({ heading: 'No documents here' });
    expect(host.querySelector('[satEmptyStateDescription]')).toBeNull();
  });

  // Satori wraps its illustration slot in `aria-hidden="true"` itself, so the icon is decorative
  // without the wrapper saying so — the same as Material, which marks it `aria-hidden` directly.
  it('puts the icon in the illustration slot, hidden from assistive technology', async () => {
    const host = await renderEmptyState({ heading: 'No documents here', icon: 'folder_open' });
    const icon = host.querySelector('[satEmptyStateIllustration]');
    expect(icon).not.toBeNull();
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(
      host.querySelector('[satEmptyStateIllustration]')?.getAttribute('data-mat-icon-name'),
    ).toBe('folder_open');
  });

  it('renders the actions template the outlet passes, since the outlet projects no content', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [ExtensionOutletComponent],
      template: `<ng-template #actions
          ><button class="probe-create" type="button">Create folder</button></ng-template
        >
        <lib-extension-outlet
          [componentId]="id"
          [componentInputs]="{ heading: 'No documents here', actions }"
        />`,
    })
    class EmptyStateHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.emptyState;
    }

    TestBed.configureTestingModule({
      imports: [EmptyStateHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
        provideNxsComponents(),
        provideNxsSatoriComponents(),
      ],
    });
    const fixture = TestBed.createComponent(EmptyStateHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[satEmptyStateAction] .probe-create')).not.toBeNull();
  });
});

/**
 * The upload is the one primitive whose Material implementation has an output, so the ID's contract
 * needed a `filesHandler` input as well — the outlet binds no outputs. These assert that both
 * routes fire, and that the rules about what counts as a file reaching the host are the same on
 * both sides: nothing empty, nothing while disabled, and one file unless `multiple`.
 */
describe('the Satori upload, rendered by nxs.primitives.upload', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
    imports: [ExtensionOutletComponent],
    template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
  })
  class UploadOutletHost {
    readonly id = NXS_PRIMITIVE_IDS.upload as string;
    inputs: Record<string, unknown> = {};
  }

  let handled: (readonly File[])[];

  const file = (name: string) => new File(['x'], name, { type: 'text/plain' });

  async function renderUpload(
    inputs: Record<string, unknown> = {},
    satori = true,
  ): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [UploadOutletHost],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideSatori(),
        provideNxsComponents(),
        ...(satori ? [provideNxsSatoriComponents()] : []),
      ],
    });
    const fixture = TestBed.createComponent(UploadOutletHost);
    fixture.componentInstance.inputs = {
      label: 'Drag and drop files here',
      filesHandler: (files: readonly File[]) => handled.push(files),
      ...inputs,
    };
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * A drop, with `dataTransfer` faked the way `dropzone.component.spec.ts` fakes it: jsdom's
   * `DataTransfer` cannot be populated. Deliberately no `items`, because Satori reads those first
   * and would then need `getAsFile()` stubs — with only `files`, both implementations take the same
   * path through the same list.
   */
  function dropEvent(files: File[]): DragEvent {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files, dropEffect: 'none' },
    });
    return event;
  }

  /** A drop on Satori's field: `satUpload` sits on the button inside it. */
  function drop(host: HTMLElement, ...files: File[]): void {
    const target = host.querySelector('.sat-upload-field-interactive') ?? host;
    target.dispatchEvent(dropEvent(files));
  }

  beforeEach(() => {
    handled = [];
  });

  it("renders Satori's upload field, and no Material dropzone", async () => {
    const host = await renderUpload();
    expect(host.querySelector('nxs-satori-upload sat-upload-field')).not.toBeNull();
    expect(host.querySelector('nxs-dropzone')).toBeNull();
  });

  it('shows our label and our chooser text, not Satori’s own fallback', async () => {
    const host = await renderUpload({ buttonLabel: 'Pick a document' });
    expect(host.querySelector('mat-label')?.textContent?.trim()).toBe('Drag and drop files here');
    expect(host.querySelector('.sat-upload-field-interactive')?.textContent).toContain(
      'Pick a document',
    );
    expect(host.querySelector('sat-upload-field')?.textContent).not.toContain('browse-or-drop');
  });

  // The reason the upload field was wrapped rather than `sat-upload-area`, whose overlay text is a
  // literal with no catalogue key: every string on screen here is one the caller translated.
  it('falls back to the same key the Material implementation uses when buttonLabel is blank', async () => {
    const host = await renderUpload({ multiple: true });
    expect(host.querySelector('.sat-upload-field-interactive')?.textContent).toContain(
      'satori-components.dropzone.choose-files',
    );
  });

  it('asks for one file when multiple is off', async () => {
    const host = await renderUpload();
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.multiple).toBe(false);
  });

  it('asks for several files when multiple is on', async () => {
    const host = await renderUpload({ multiple: true });
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.multiple).toBe(true);
  });

  it('passes accept through to the chooser, and omits it when blank', async () => {
    const host = await renderUpload({ accept: '.csv' });
    expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.csv');
  });

  it('omits accept entirely when blank, as Material does', async () => {
    const host = await renderUpload();
    expect(host.querySelector('input[type="file"]')?.hasAttribute('accept')).toBe(false);
  });

  it('calls the handler the outlet passed with a dropped file', async () => {
    const host = await renderUpload();
    drop(host, file('claim.pdf'));
    expect(handled).toHaveLength(1);
    expect(handled[0].map((f) => f.name)).toEqual(['claim.pdf']);
  });

  it('takes only the first of several dropped files when multiple is off, as Material does', async () => {
    const host = await renderUpload();
    drop(host, file('a.pdf'), file('b.pdf'));
    expect(handled[0].map((f) => f.name)).toEqual(['a.pdf']);
  });

  it('takes every dropped file when multiple is on', async () => {
    const host = await renderUpload({ multiple: true });
    drop(host, file('a.pdf'), file('b.pdf'));
    expect(handled[0].map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('takes nothing while disabled, as Material does', async () => {
    const host = await renderUpload({ disabled: true });
    drop(host, file('claim.pdf'));
    expect(handled).toEqual([]);
  });

  it('disables the chooser and says so, while disabled', async () => {
    const host = await renderUpload({ disabled: true });
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('button.sat-upload-field-interactive')?.disabled,
    ).toBe(true);
  });

  it('takes nothing from an empty drop', async () => {
    const host = await renderUpload();
    drop(host);
    expect(handled).toEqual([]);
  });

  it('names the chooser from our label, through Satori’s own label pairing', async () => {
    const host = await renderUpload();
    const label = host.querySelector('label.sat-upload-field-label');
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(label?.getAttribute('for')).toBe(input?.id);
    expect(input?.id).toBeTruthy();
  });

  it('calls the same handler on Material, so a host passes the same inputs either way', async () => {
    const host = await renderUpload({}, false);
    expect(host.querySelector('nxs-dropzone')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    // Material's dropzone takes a drop on its own host rather than on a projected button.
    host.querySelector('nxs-dropzone')?.dispatchEvent(dropEvent([file('claim.pdf')]));
    expect(handled[0]?.map((f) => f.name)).toEqual(['claim.pdf']);
  });
});
