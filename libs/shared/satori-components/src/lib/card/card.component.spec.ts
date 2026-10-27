import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  reflectComponentType,
  type TemplateRef,
  viewChild,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
} from '@nuxeo/satori-platform/extensions';

import { NXS_PRIMITIVE_IDS } from '../primitives';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsCardComponent } from './card.component';

/** The three templates a host hands the card, declared as a host declares them. */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ng-template #media><span class="probe-media">thumbnail</span></ng-template>
    <ng-template #headerAction><button type="button" class="probe-menu">Menu</button></ng-template>
    <ng-template #actions><button type="button" class="probe-action">Download</button></ng-template>
  `,
})
class TemplatesComponent {
  readonly media = viewChild.required<TemplateRef<unknown>>('media');
  readonly headerAction = viewChild.required<TemplateRef<unknown>>('headerAction');
  readonly actions = viewChild.required<TemplateRef<unknown>>('actions');
}

describe('NxsCardComponent', () => {
  let fixture: ComponentFixture<NxsCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsCardComponent, TemplatesComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsCardComponent);
  });

  async function render(inputs: Record<string, unknown> = {}): Promise<HTMLElement> {
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function templates(): TemplatesComponent {
    const host = TestBed.createComponent(TemplatesComponent);
    host.detectChanges();
    return host.componentInstance;
  }

  it('shows its heading and subheading in a Material card', async () => {
    const host = await render({ heading: 'Claim 42', subheading: 'File' });
    expect(host.querySelector('mat-card.mat-mdc-card')).not.toBeNull();
    expect(host.querySelector('.nxs-card__heading')?.textContent?.trim()).toBe('Claim 42');
    expect(host.querySelector('.nxs-card__subheading')?.textContent?.trim()).toBe('File');
  });

  it('is outlined only when it opens something, as an outline says a surface can be pressed', async () => {
    const host = await render({ heading: 'Claim 42' });
    expect(host.querySelector('mat-card.mat-mdc-card-filled')).not.toBeNull();
    expect(host.querySelector('mat-card.mat-mdc-card-outlined')).toBeNull();
    expect(host.classList).not.toContain('nxs-card--interactive');

    await render({ openHandler: () => undefined });
    expect(host.querySelector('mat-card.mat-mdc-card-outlined')).not.toBeNull();
    expect(host.classList).toContain('nxs-card--interactive');
  });

  it.each(['', '   ', '\u200b'])('shows no subheading for %j', async (subheading) => {
    const host = await render({ heading: 'Claim 42', subheading });
    expect(host.querySelector('.nxs-card__subheading')).toBeNull();
  });

  it('opens through its heading, which is a button only when there is something to open', async () => {
    const opened: number[] = [];
    let host = await render({ heading: 'Claim 42' });
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('span.nxs-card__heading')?.textContent?.trim()).toBe('Claim 42');

    host = await render({ openHandler: () => opened.push(1) });
    const open = host.querySelector<HTMLButtonElement>('button.nxs-card__open');
    expect(open?.textContent?.trim()).toBe('Claim 42');
    expect(open?.type).toBe('button');
    open?.click();
    expect(opened).toEqual([1]);
  });

  it('offers a named checkbox, and reports its new state to the selection handler', async () => {
    const toggled: boolean[] = [];
    const host = await render({
      heading: 'Claim 42',
      selectionLabel: 'Select Claim 42',
      selectionHandler: (selected: boolean) => toggled.push(selected),
      openHandler: () => undefined,
    });
    const input = host.querySelector<HTMLInputElement>('.nxs-card__select input[type="checkbox"]');
    expect(input?.getAttribute('aria-label')).toBe('Select Claim 42');
    expect(input?.checked).toBe(false);

    input?.click();
    expect(toggled).toEqual([true]);
    // A control is never nested in the open button (WCAG 4.1.2): they are siblings.
    expect(host.querySelector('button.nxs-card__open .nxs-card__select')).toBeNull();
  });

  it('shows the selected state on the checkbox and on the card', async () => {
    const host = await render({ selectionLabel: 'Select Claim 42', selected: true });
    expect(host.classList).toContain('nxs-card--selected');
    expect(host.querySelector<HTMLInputElement>('.nxs-card__select input')?.checked).toBe(true);

    await render({ selected: false });
    expect(host.classList).not.toContain('nxs-card--selected');
  });

  it.each(['', '  ', '\u200b\ufeff'])(
    'renders no checkbox for a selection label of %j: the card is not selectable',
    async (selectionLabel) => {
      const host = await render({ heading: 'Claim 42', selectionLabel });
      expect(host.querySelector('mat-checkbox')).toBeNull();
    },
  );

  it('names the checkbox without the whitespace around its label', async () => {
    const host = await render({ selectionLabel: ' Select Claim 42 ' });
    expect(host.querySelector('.nxs-card__select input')?.getAttribute('aria-label')).toBe(
      'Select Claim 42',
    );
  });

  it('renders the media, header action and actions templates in their own places', async () => {
    const { media, headerAction, actions } = templates();
    const host = await render({
      heading: 'Claim 42',
      media: media(),
      headerAction: headerAction(),
      actions: actions(),
    });
    expect(host.querySelector('.nxs-card__media .probe-media')?.textContent).toBe('thumbnail');
    expect(host.querySelector('.nxs-card__header-action .probe-menu')).not.toBeNull();
    expect(host.querySelector('.nxs-card__actions .probe-action')).not.toBeNull();
  });

  it('renders no frame for a template it was not given', async () => {
    const host = await render({ heading: 'Claim 42' });
    expect(host.querySelector('.nxs-card__media')).toBeNull();
    expect(host.querySelector('.nxs-card__header-action')).toBeNull();
    expect(host.querySelector('.nxs-card__actions')).toBeNull();
  });

  // The checkbox and the menu sit in the corners over the media; with none, they would cover the
  // heading and take the clicks meant to open the card.
  it('makes room above its text for the corner controls when it has no media', async () => {
    const { media, headerAction } = templates();
    const bare = () =>
      fixture.nativeElement
        .querySelector('.nxs-card__surface')
        .classList.contains('nxs-card__surface--bare');
    await render({ heading: 'Q3 claims', selectionLabel: 'Select Q3 claims' });
    expect(bare()).toBe(true);
    await render({ media: media() });
    expect(bare()).toBe(false);
    await render({ media: null, selectionLabel: '' });
    expect(bare()).toBe(false);
    await render({ headerAction: headerAction() });
    expect(bare()).toBe(true);
  });

  it('declares no outputs: the outlet that renders it by ID would bind none', () => {
    expect(reflectComponentType(NxsCardComponent)?.outputs).toEqual([]);
  });
});

describe('nxs.primitives.card', () => {
  @Component({
    standalone: true,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [ExtensionOutletComponent],
    template: `
      <ng-template #media><span class="probe-media">thumbnail</span></ng-template>
      <lib-extension-outlet
        [componentId]="id"
        [componentInputs]="{
          heading: 'Claim 42',
          subheading: 'File',
          selected: true,
          selectionLabel: 'Select Claim 42',
          selectionHandler: select,
          openHandler: open,
          media: media,
        }"
      />
    `,
  })
  class OutletHostComponent {
    readonly id = NXS_PRIMITIVE_IDS.card;
    readonly calls: string[] = [];
    readonly open = () => this.calls.push('open');
    readonly select = (selected: boolean) => this.calls.push(`select:${selected}`);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [provideZonelessChangeDetection(), provideNxsComponents()],
    });
  });

  it('is registered by provideNxsComponents()', () => {
    expect(TestBed.inject(ExtensionComponentRegistry).peek(NXS_PRIMITIVE_IDS.card)).toBe(
      NxsCardComponent,
    );
  });

  it('renders by ID with every input the outlet passes, handlers and templates included', async () => {
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      'lib-extension-outlet nxs-card',
    );
    expect(card?.querySelector('.nxs-card__heading')?.textContent?.trim()).toBe('Claim 42');
    expect(card?.querySelector('.nxs-card__subheading')?.textContent?.trim()).toBe('File');
    expect(card?.classList).toContain('nxs-card--selected');
    expect(card?.querySelector('.nxs-card__media .probe-media')).not.toBeNull();

    card?.querySelector<HTMLElement>('button.nxs-card__open')?.click();
    card?.querySelector<HTMLInputElement>('.nxs-card__select input')?.click();
    expect(fixture.componentInstance.calls).toEqual(['open', 'select:false']);
  });
});
