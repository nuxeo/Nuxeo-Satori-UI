import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppConfigService, type AppActivePreset } from '@nuxeo/satori-platform/app-config';

import { testTranslateModule } from '../../i18n/translate-testing';
import { PresetBadgeComponent } from './preset-badge.component';

describe('PresetBadgeComponent', () => {
  const activePreset = signal<AppActivePreset | null>(null);

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [
        PresetBadgeComponent,
        testTranslateModule({ 'app.preset.badge': 'Preset: {{ label }}' }),
      ],
      providers: [{ provide: AppConfigService, useValue: { activePreset } }],
    });
    const fixture = TestBed.createComponent(PresetBadgeComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => activePreset.set(null));

  it('renders nothing when no preset is in force', () => {
    expect(render().querySelector('.preset-badge')).toBeNull();
  });

  it('names the preset in force, announced as a status', () => {
    activePreset.set({ name: 'acme', label: 'Acme Insurance' });
    const badge = render().querySelector('.preset-badge');

    expect(badge?.textContent?.trim()).toBe('Preset: Acme Insurance');
    expect(badge?.getAttribute('role')).toBe('status');
    expect(badge?.getAttribute('data-preset')).toBe('acme');
  });
});
