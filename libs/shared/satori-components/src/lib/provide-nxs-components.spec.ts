import {
  Component,
  provideZonelessChangeDetection,
  type EnvironmentProviders,
  type Provider,
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
import { NxsErrorStateComponent } from './error-state/error-state.component';
import { NXS_PRIMITIVE_IDS } from './primitives';
import { provideNxsComponents } from './provide-nxs-components';
import { NxsRichTooltipComponent } from './rich-tooltip/rich-tooltip.component';
import { NxsStatusTagComponent } from './status-tag/status-tag.component';
import { NxsTagComponent } from './tag/tag.component';

@Component({ selector: 'nxs-probe-tag', standalone: true, template: '' })
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
    expect(Object.keys(NXS_PRIMITIVE_IDS)).toHaveLength(6);
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
});
