import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject, of, throwError } from 'rxjs';

import {
  AdministrationService,
  type NuxeoOAuth2Provider,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { AdminCloudServicesPageComponent } from './admin-cloud-services-page.component';

describe('AdminCloudServicesPageComponent', () => {
  let component: AdminCloudServicesPageComponent;
  let fixture: ComponentFixture<AdminCloudServicesPageComponent>;
  let adminService: { listOAuth2Providers: ReturnType<typeof vi.fn> };

  const mockProviders: NuxeoOAuth2Provider[] = [
    {
      serviceName: 'GoogleDrive',
      description: 'Google Drive OAuth2 provider',
      enabled: true,
    },
    {
      serviceName: 'Dropbox',
      description: 'Dropbox OAuth2 provider',
      enabled: false,
    },
  ];

  beforeEach(async () => {
    adminService = {
      listOAuth2Providers: vi.fn().mockReturnValue(of(mockProviders)),
    };

    await TestBed.configureTestingModule({
      imports: [AdminCloudServicesPageComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdministrationService, useValue: adminService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCloudServicesPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start out loading, before any response has arrived', () => {
    expect(component.loading()).toBe(true);
    expect(component.providers()).toEqual([]);
  });

  it('should load the providers on init', () => {
    component.ngOnInit();

    expect(adminService.listOAuth2Providers).toHaveBeenCalled();
    expect(component.providers()).toEqual(mockProviders);
    expect(component.loading()).toBe(false);
  });

  it('should show loading while the request is in flight and clear it on arrival', () => {
    const pending = new Subject<NuxeoOAuth2Provider[]>();
    adminService.listOAuth2Providers.mockReturnValue(pending.asObservable());
    component.loading.set(false);

    component.refreshProviders();
    expect(component.loading()).toBe(true);

    pending.next(mockProviders);
    expect(component.loading()).toBe(false);
    expect(component.providers()).toEqual(mockProviders);
  });

  it('should clear the table and stop loading when the request fails', () => {
    component.providers.set(mockProviders);
    adminService.listOAuth2Providers.mockReturnValue(throwError(() => new Error('500')));

    component.refreshProviders();

    expect(component.providers()).toEqual([]);
    expect(component.loading()).toBe(false);
  });

  describe('providerName', () => {
    it('should read the service name', () => {
      expect(component.providerName({ serviceName: 'GoogleDrive' } as NuxeoOAuth2Provider)).toBe(
        'GoogleDrive',
      );
    });

    it('should fall back to `name` for a provider that reports it that way', () => {
      expect(component.providerName({ name: 'OneDrive' } as unknown as NuxeoOAuth2Provider)).toBe(
        'OneDrive',
      );
    });

    it('should render an em dash for a provider with neither', () => {
      expect(component.providerName({} as NuxeoOAuth2Provider)).toBe('—');
    });
  });

  describe('providerDescription', () => {
    it('should read the description', () => {
      expect(
        component.providerDescription({ description: 'Drive files' } as NuxeoOAuth2Provider),
      ).toBe('Drive files');
    });

    it('should render an em dash when there is no description', () => {
      expect(component.providerDescription({} as NuxeoOAuth2Provider)).toBe('—');
    });
  });

  describe('providerEnabled', () => {
    it('should report a provider with enabled: true as enabled', () => {
      expect(component.providerEnabled({ enabled: true } as NuxeoOAuth2Provider)).toBe(true);
    });

    it('should accept the alternate isEnabled spelling', () => {
      expect(component.providerEnabled({ isEnabled: true } as unknown as NuxeoOAuth2Provider)).toBe(
        true,
      );
    });

    it('should report a disabled provider as disabled', () => {
      expect(component.providerEnabled({ enabled: false } as NuxeoOAuth2Provider)).toBe(false);
    });

    it('should not treat a truthy non-boolean as enabled', () => {
      // Strict `=== true`, so a string the server happened to send does not silently read as on.
      expect(component.providerEnabled({ enabled: 'true' } as unknown as NuxeoOAuth2Provider)).toBe(
        false,
      );
    });

    it('should report a provider that says nothing about it as disabled', () => {
      expect(component.providerEnabled({} as NuxeoOAuth2Provider)).toBe(false);
    });
  });
});
