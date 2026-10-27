import {
  Component,
  provideZonelessChangeDetection,
  type EnvironmentProviders,
  type Provider,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import { provideTranslateService } from '@ngx-translate/core';

import { NxsAvatarComponent } from './avatar/avatar.component';
import { NxsBreadcrumbsComponent } from './breadcrumbs/breadcrumbs.component';
import { NxsDocumentToolbarComponent } from './document-toolbar/document-toolbar.component';
import { NxsErrorStateComponent } from './error-state/error-state.component';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { provideNxsComponents } from './provide-nxs-components';
import { NxsRichTooltipComponent } from './rich-tooltip/rich-tooltip.component';
import { NxsStatusTagComponent } from './status-tag/status-tag.component';
import { NxsTabsComponent } from './tabs/tabs.component';
import { NxsTagComponent } from './tag/tag.component';

@Component({
  selector: 'nxs-probe-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class ProbeTagComponent {}

describe('provideNxsComponents', () => {
  function registry(providers: (Provider | EnvironmentProviders)[]): ExtensionComponentRegistry {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...providers] });
    return TestBed.inject(ExtensionComponentRegistry);
  }

  it('registers every primitive ID to its Material implementation', () => {
    const components = registry([provideNxsComponents()]);
    expect(components.peek(NXS_PRIMITIVE_IDS.avatar)).toBe(NxsAvatarComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.breadcrumbs)).toBe(NxsBreadcrumbsComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.tag)).toBe(NxsTagComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.statusTag)).toBe(NxsStatusTagComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.richTooltip)).toBe(NxsRichTooltipComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.errorState)).toBe(NxsErrorStateComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.tabs)).toBe(NxsTabsComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.actionBar)).toBe(NxsDocumentToolbarComponent);
    expect(Object.keys(NXS_PRIMITIVE_IDS)).toHaveLength(8);
  });

  it('registers nothing under those IDs when it is not provided', () => {
    const components = registry([]);
    for (const id of Object.values(NXS_PRIMITIVE_IDS)) expect(components.has(id)).toBe(false);
  });

  it('is overridden by a contribution listed after it', () => {
    const components = registry([
      provideNxsComponents(),
      provideSatoriExtensions({ components: { [NXS_PRIMITIVE_IDS.tag]: ProbeTagComponent } }),
    ]);
    expect(components.peek(NXS_PRIMITIVE_IDS.tag)).toBe(ProbeTagComponent);
    expect(components.peek(NXS_PRIMITIVE_IDS.avatar)).toBe(NxsAvatarComponent);
  });

  it('overrides a contribution listed before it, which is why it goes first', () => {
    const components = registry([
      provideSatoriExtensions({ components: { [NXS_PRIMITIVE_IDS.tag]: ProbeTagComponent } }),
      provideNxsComponents(),
    ]);
    expect(components.peek(NXS_PRIMITIVE_IDS.tag)).toBe(NxsTagComponent);
  });

  it('renders a primitive by ID through the extension outlet, with its inputs', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [ExtensionOutletComponent],
      template: `<lib-extension-outlet
        [componentId]="id"
        [componentInputs]="{ label: 'Invoice', color: 'teal' }"
      />`,
    })
    class OutletHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.tag;
    }

    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideNxsComponents(),
      ],
    });
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const tag = (fixture.nativeElement as HTMLElement).querySelector('nxs-tag');
    expect(tag?.textContent?.trim()).toBe('Invoice');
    expect(tag?.classList).toContain('nxs-tag--teal');
  });

  it('renders the error state by ID, calling the retry handler the outlet passes', async () => {
    const retries: number[] = [];
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [ExtensionOutletComponent],
      template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
    })
    class OutletHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.errorState;
      readonly inputs = {
        status: 500,
        heading: 'Failed to load folder contents.',
        retryable: true,
        retryHandler: () => retries.push(1),
      };
    }

    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideRouter([]),
        provideNxsComponents(),
      ],
    });
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const state = (fixture.nativeElement as HTMLElement).querySelector('nxs-error-state');
    expect(state?.querySelector('h2')?.textContent?.trim()).toBe('Failed to load folder contents.');
    state?.querySelector('button')?.click();
    expect(retries).toEqual([1]);
  });

  it('renders the tabs by ID, with the body template and the select handler the outlet passes', async () => {
    const selected: [string, number][] = [];
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
    class OutletHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.tabs;
      readonly tabs = [
        { id: 'app.tabs.view', label: 'View' },
        { id: 'app.tabs.history', label: 'History' },
      ];
      readonly selectHandler = (tab: { id: string }, index: number) =>
        selected.push([tab.id, index]);
    }

    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [provideZonelessChangeDetection(), provideNxsComponents()],
    });
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('nxs-tabs')).not.toBeNull();
    expect(host.querySelector('.probe-body')?.textContent?.trim()).toBe('View body');

    host.querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
    await fixture.whenStable();
    expect(selected).toEqual([['app.tabs.history', 1]]);
  });

  it('renders the action bar by ID, calling the action handler the outlet passes', async () => {
    const ran: string[] = [];
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [ExtensionOutletComponent],
      template: `<lib-extension-outlet [componentId]="id" [componentInputs]="inputs" />`,
    })
    class OutletHostComponent {
      readonly id = NXS_PRIMITIVE_IDS.actionBar;
      readonly inputs = {
        actions: [
          { id: 'app.toolbar.edit', label: 'Edit', icon: 'edit' },
          { id: 'app.toolbar.delete', label: 'Delete', icon: 'delete', disabled: true },
        ],
        actionHandler: (action: { id: string }) => ran.push(action.id),
      };
    }

    TestBed.configureTestingModule({
      imports: [OutletHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideNxsComponents(),
      ],
    });
    const fixture = TestBed.createComponent(OutletHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('nxs-document-toolbar')).not.toBeNull();
    host.querySelector<HTMLElement>('[data-action-id="app.toolbar.edit"]')?.click();
    host.querySelector<HTMLElement>('[data-action-id="app.toolbar.delete"]')?.click();
    expect(ran).toEqual(['app.toolbar.edit']);
  });
});
