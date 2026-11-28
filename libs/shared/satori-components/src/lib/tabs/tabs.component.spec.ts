import {
  Component,
  provideZonelessChangeDetection,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsTabBodyDirective, type NxsTab } from './tab-body.directive';
import { NxsTabsComponent } from './tabs.component';

const TABS: readonly NxsTab[] = [
  { id: 'app.tabs.view', label: 'View', icon: 'visibility' },
  { id: 'app.tabs.permissions', label: 'Permissions' },
  { id: 'acme.tabs.claims', label: 'Claims' },
];

@Component({
  standalone: true,
  imports: [NxsTabsComponent, NxsTabBodyDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-tabs
      [tabs]="tabs()"
      [label]="label()"
      [(selectedIndex)]="index"
      (selectedTabChange)="selected.push($event.id)"
    >
      <ng-template nxsTabBody let-tab>
        @switch (tab.id) {
          @case ('app.tabs.view') {
            <p class="body body--view">Viewer</p>
          }
          @default {
            <p class="body body--other" [attr.data-for]="tab.id">{{ tab.label }} body</p>
          }
        }
      </ng-template>
    </nxs-tabs>
  `,
})
class HostComponent {
  readonly tabs = signal<readonly NxsTab[]>(TABS);
  readonly label = signal('Document views');
  readonly index = signal(0);
  readonly selected: string[] = [];
  readonly bodyTemplate = viewChild(NxsTabBodyDirective);
}

describe('NxsTabsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => [...el().querySelectorAll<HTMLElement>('[role="tab"]')];
  const activeBody = (): HTMLElement | null => el().querySelector('.mat-mdc-tab-body-active .body');

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('renders one tab per entry, in order, each addressable by its ID', () => {
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['View', 'Permissions', 'Claims']);
    expect(
      [...el().querySelectorAll('[data-tab-id]')].map((n) => n.getAttribute('data-tab-id')),
    ).toEqual(['app.tabs.view', 'app.tabs.permissions', 'acme.tabs.claims']);
  });

  it('hides tab icons from assistive technology, so a tab is named by its label', () => {
    expect(el().querySelector('.nxs-tabs__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the tab list', () => {
    expect(el().querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Document views',
    );
  });

  it('leaves the tab list unnamed rather than naming it with whitespace', async () => {
    host.label.set('   ');
    await render();
    expect(el().querySelector('[role="tablist"]')?.hasAttribute('aria-label')).toBe(false);
  });

  it('gives the tab list an inline key handler IBM Equal Access can detect', () => {
    const tabList = el().querySelector('[role="tablist"]');
    expect(tabList?.getAttribute('onkeydown')).toBe('void(0)');
    expect(tabList?.getAttribute('data-satori-tablist-keydown')).toBe('true');
  });

  it('keeps an inline key handler that is already on the tab list', async () => {
    const tabList = el().querySelector('[role="tablist"]') as HTMLElement;
    tabList.removeAttribute('data-satori-tablist-keydown');
    tabList.setAttribute('onkeydown', 'return true');
    host.tabs.set(TABS.slice(0, 2));
    await render();
    expect(tabList.getAttribute('onkeydown')).toBe('return true');
    expect(tabList.getAttribute('data-satori-tablist-keydown')).toBe('true');
  });

  it('renders every body from the one template, handing it the tab', () => {
    expect(activeBody()?.classList).toContain('body--view');
  });

  it('selects on click, reports the tab by ID and updates the two-way index', async () => {
    tabs()[2].click();
    await render();
    expect(host.selected).toEqual(['acme.tabs.claims']);
    expect(host.index()).toBe(2);
    expect(activeBody()?.getAttribute('data-for')).toBe('acme.tabs.claims');
  });

  it('follows an index the host sets', async () => {
    host.index.set(1);
    await render();
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(activeBody()?.textContent).toContain('Permissions body');
  });

  // The tab group reports only `selectedTabChange` here, not `selectedIndexChange`.
  it('reports a different tab at the same position when the list changes under the selection', async () => {
    host.index.set(1);
    await render();
    host.tabs.set([TABS[0], TABS[2]]);
    await render();
    expect(host.selected).toEqual(['app.tabs.permissions', 'acme.tabs.claims']);
    expect(activeBody()?.getAttribute('data-for')).toBe('acme.tabs.claims');
  });

  it('keeps a body alive while another tab is selected', async () => {
    const view = activeBody();
    tabs()[1].click();
    await render();
    tabs()[0].click();
    await render();
    expect(activeBody()).toBe(view);
  });

  it('selects the last tab for an index past it', async () => {
    host.index.set(7);
    await render();
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(activeBody()?.getAttribute('data-for')).toBe('acme.tabs.claims');
  });

  it('types the body template context as the tab', () => {
    const directive = host.bodyTemplate();
    expect(directive).toBeInstanceOf(NxsTabBodyDirective);
    expect(
      NxsTabBodyDirective.ngTemplateContextGuard(directive as NxsTabBodyDirective, {
        $implicit: TABS[0],
      }),
    ).toBe(true);
  });

  it('renders no body when the host marks no template', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [NxsTabsComponent],
      template: `<nxs-tabs [tabs]="tabs" />`,
    })
    class BareHost {
      readonly tabs = TABS;
    }
    const bare = TestBed.createComponent(BareHost);
    bare.detectChanges();
    await bare.whenStable();
    expect((bare.nativeElement as HTMLElement).querySelectorAll('[role="tab"]').length).toBe(3);
    expect((bare.nativeElement as HTMLElement).querySelector('.body')).toBeNull();
  });

  // What a host rendering `nxs.primitives.tabs` through an outlet passes, as inputs: it can project
  // nothing and bind no output.
  it('renders the body input over a projected template, and calls the select handler', async () => {
    const calls: [string, number][] = [];
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [NxsTabsComponent, NxsTabBodyDirective],
      template: `
        <ng-template #given let-tab
          ><p class="body body--given">{{ tab.label }} given</p></ng-template
        >
        <nxs-tabs [tabs]="tabs" [body]="given" [selectHandler]="handler">
          <ng-template nxsTabBody><p class="body body--projected">projected</p></ng-template>
        </nxs-tabs>
      `,
    })
    class InputHost {
      readonly tabs = TABS;
      readonly handler = (tab: NxsTab, index: number) => calls.push([tab.id, index]);
    }
    const given = TestBed.createComponent(InputHost);
    given.detectChanges();
    await given.whenStable();
    const root = given.nativeElement as HTMLElement;
    expect(root.querySelector('.mat-mdc-tab-body-active .body')?.textContent?.trim()).toBe(
      'View given',
    );
    expect(root.querySelector('.body--projected')).toBeNull();

    root.querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    given.detectChanges();
    await given.whenStable();
    expect(calls).toEqual([['app.tabs.permissions', 1]]);
    expect(root.querySelector('.mat-mdc-tab-body-active .body')?.textContent?.trim()).toBe(
      'Permissions given',
    );
  });

  describe('lazy', () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [NxsTabsComponent, NxsTabBodyDirective],
      template: `
        <nxs-tabs lazy [tabs]="tabs" label="Record sections">
          <ng-template nxsTabBody let-tab>
            <p class="body" [attr.data-for]="tab.id">{{ drawn(tab.id) }}</p>
          </ng-template>
        </nxs-tabs>
      `,
    })
    class LazyHost {
      readonly tabs = TABS;
      readonly draws: string[] = [];
      drawn(id: string): string {
        if (!this.draws.includes(id)) this.draws.push(id);
        return id;
      }
    }

    async function lazy(): Promise<ComponentFixture<LazyHost>> {
      const made = TestBed.createComponent(LazyHost);
      made.detectChanges();
      await made.whenStable();
      made.detectChanges();
      return made;
    }

    async function choose(made: ComponentFixture<LazyHost>, index: number): Promise<void> {
      (made.nativeElement as HTMLElement)
        .querySelectorAll<HTMLElement>('[role="tab"]')
        [index].click();
      made.detectChanges();
      await made.whenStable();
      made.detectChanges();
    }

    it('draws only the selected tab’s body, and another only once it is chosen', async () => {
      const made = await lazy();
      const root = made.nativeElement as HTMLElement;
      expect(made.componentInstance.draws).toEqual(['app.tabs.view']);
      expect(
        [...root.querySelectorAll('.body')].map((body) => body.getAttribute('data-for')),
      ).toEqual(['app.tabs.view']);

      await choose(made, 2);
      expect(made.componentInstance.draws).toEqual(['app.tabs.view', 'acme.tabs.claims']);
      expect(root.querySelector('.mat-mdc-tab-body-active .body')?.getAttribute('data-for')).toBe(
        'acme.tabs.claims',
      );
    });

    it('drops a body that is left, and draws it afresh on return', async () => {
      const made = await lazy();
      const root = made.nativeElement as HTMLElement;
      const first = root.querySelector('.mat-mdc-tab-body-active .body');
      await choose(made, 1);
      expect(root.querySelector('[data-for="app.tabs.view"]')).toBeNull();
      await choose(made, 0);
      const again = root.querySelector('.mat-mdc-tab-body-active .body');
      expect(again?.getAttribute('data-for')).toBe('app.tabs.view');
      expect(again).not.toBe(first);
    });

    it('keeps the tabs, their names and the tab list’s name as an eager strip has them', async () => {
      const root = (await lazy()).nativeElement as HTMLElement;
      expect(
        [...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
      ).toEqual(['View', 'Permissions', 'Claims']);
      expect(root.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
        'Record sections',
      );
      expect(root.querySelector('.nxs-tabs__icon')?.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
