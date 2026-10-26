import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { AdminAnalyticsPageComponent } from './admin-analytics-page.component';
import { AdministrationService } from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  type AnomaliesResponse,
  type AuditAnomaly,
} from '@agentic-ui/shared/ai-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

describe('AdminAnalyticsPageComponent', () => {
  let component: AdminAnalyticsPageComponent;
  let fixture: ComponentFixture<AdminAnalyticsPageComponent>;
  let mockAdminService: {
    getDefaultDomainPath: ReturnType<typeof vi.fn>;
    getNxqlTotalSize: ReturnType<typeof vi.fn>;
    nxqlSearch: ReturnType<typeof vi.fn>;
  };
  /**
   * Bound to the gateway method, not a bare `vi.fn`.
   *
   * An untyped double accepts any response shape, which is how the anomaly fixtures below omitted the
   * required `events` field on `AuditAnomaly` without `spec-types` noticing — the same fixture-drift
   * hole this branch exists to close.
   */
  let mockAiGatewayService: {
    detectAnomalies: MockInstance<AiGatewayService['detectAnomalies']>;
  };

  /** A complete `AuditAnomaly`. */
  function anomaly(over: Partial<AuditAnomaly> = {}): AuditAnomaly {
    return {
      description: 'Test anomaly',
      severity: 'high',
      events: ['documentRemoved'],
      timestamp: '2026-09-22T10:00:00Z',
      ...over,
    };
  }
  /**
   * `AiFeatureFlagService` exposes `aiEnabled` as a signal, and this template gates its whole AI
   * anomalies tab on `featureFlags.aiEnabled()`.
   *
   * The mock here was `{}` — no `aiEnabled` at all. Nothing caught it because no test in this file
   * rendered the template, so the incomplete provider was never resolved, and `spec-types` cannot
   * see into a `useValue` slot. The render assertions below are what make the gate real.
   */
  let aiEnabled: WritableSignal<boolean>;

  beforeEach(() => {
    mockAdminService = {
      getDefaultDomainPath: vi.fn(),
      getNxqlTotalSize: vi.fn(),
      nxqlSearch: vi.fn(),
    };

    mockAiGatewayService = {
      detectAnomalies: vi.fn<AiGatewayService['detectAnomalies']>(),
    };

    aiEnabled = signal(true);

    TestBed.configureTestingModule({
      // `NoopAnimationsModule` and the real catalogue, because the AI-gate assertions below render
      // a `mat-tab-group` template full of `| translate`.
      imports: [AdminAnalyticsPageComponent, NoopAnimationsModule, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdministrationService, useValue: mockAdminService },
        { provide: AiGatewayService, useValue: mockAiGatewayService },
        { provide: AiFeatureFlagService, useValue: { aiEnabled } },
      ],
    });

    fixture = TestBed.createComponent(AdminAnalyticsPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('the AI feature gate', () => {
    beforeEach(() => {
      // Rendering runs `ngOnInit`, which fans out from `getDefaultDomainPath`. The suite's other
      // tests arrange these per case; the render assertions need them arranged up front or the
      // component subscribes to `undefined`.
      mockAdminService.getDefaultDomainPath.mockReturnValue(of('/default-domain'));
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(0));
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
      mockAiGatewayService.detectAnomalies.mockReturnValue(of({ anomalies: [], summary: '' }));
    });

    /** The AI anomalies tab label, which the template wraps in `@if (featureFlags.aiEnabled())`. */
    function aiTabLabel(): Element | null {
      return (fixture.nativeElement as HTMLElement).querySelector('.ai-tab-icon');
    }

    it('renders the AI anomalies tab when AI is enabled', () => {
      aiEnabled.set(true);

      fixture.detectChanges();

      expect(aiTabLabel()).not.toBeNull();
    });

    it('renders no AI anomalies tab when AI is disabled', () => {
      aiEnabled.set(false);

      fixture.detectChanges();

      // The discriminating half: without it, a template that dropped the `@if` entirely would
      // still satisfy the enabled case above.
      expect(aiTabLabel()).toBeNull();
    });
  });

  describe('Component initialization', () => {
    it('should initialize with all signal default values', () => {
      expect(component.distPath()).toBe('/default-domain/');
      expect(component.repoPath()).toBe('/default-domain/');
      expect(component.distLoading()).toBe(false);
      expect(component.repoLoading()).toBe(false);
      expect(component.wfLoading()).toBe(false);
      expect(component.distributionWarning()).toBe(false);
      expect(component.totalUnderPath()).toBeNull();
      expect(component.typeRows()).toEqual([]);
      expect(component.repoDocs()).toEqual([]);
      expect(component.repoTotal()).toBe(0);
      expect(component.searchMetricTotal()).toBeNull();
      expect(component.wfTotal()).toBeNull();
      expect(component.aiAnomalies()).toEqual([]);
      expect(component.aiAnomalySummary()).toBe('');
      expect(component.aiAnomalyLoading()).toBe(false);
      expect(component.aiAnomalyTimeRange()).toBe('24h');
    });

    it('should have featureFlags service properly injected and accessible', () => {
      // Asserts the shape the template depends on, not just object identity with the double: the
      // template calls `featureFlags.aiEnabled()`, so that is what has to be there.
      expect(component.featureFlags.aiEnabled).toBeDefined();
      expect(component.featureFlags.aiEnabled()).toBe(true);
    });
  });

  describe('ngOnInit', () => {
    it('should successfully fetch default domain path and trigger all refresh methods', () => {
      const mockPath = '/default-domain';
      mockAdminService.getDefaultDomainPath.mockReturnValue(of(mockPath));
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(0));
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));

      component.ngOnInit();

      expect(mockAdminService.getDefaultDomainPath).toHaveBeenCalled();
      expect(component.distPath()).toBe('/default-domain/');
      expect(component.repoPath()).toBe('/default-domain/');
      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalled();
      expect(mockAdminService.nxqlSearch).toHaveBeenCalled();
    });

    it('should normalize default domain path with trailing slash', () => {
      const mockPath = '/custom-domain';
      mockAdminService.getDefaultDomainPath.mockReturnValue(of(mockPath));
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(0));
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));

      component.ngOnInit();

      expect(component.distPath()).toBe('/custom-domain/');
      expect(component.repoPath()).toBe('/custom-domain/');
    });

    it('should handle error when fetching default domain path and still trigger refresh methods', () => {
      mockAdminService.getDefaultDomainPath.mockReturnValue(
        throwError(() => new Error('API Error')),
      );
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(0));
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));

      component.ngOnInit();

      expect(mockAdminService.getDefaultDomainPath).toHaveBeenCalled();
      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalled();
      expect(mockAdminService.nxqlSearch).toHaveBeenCalled();
    });
  });

  describe('refreshDistribution', () => {
    it('should fetch total count and type distribution with valid non-default path', () => {
      component.distPath.set('/workspaces/test');
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(100));

      component.refreshDistribution();

      expect(component.distPath()).toBe('/workspaces/test/');
      expect(component.distributionWarning()).toBe(false);
      expect(component.distLoading()).toBe(false);
      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalledTimes(7);
      expect(component.totalUnderPath()).toBe(100);
      expect(component.typeRows().length).toBe(6);
    });

    it('should set warning flag and clear data with default domain path without API calls', () => {
      component.distPath.set('/default-domain/');

      component.refreshDistribution();

      expect(component.distributionWarning()).toBe(true);
      expect(component.totalUnderPath()).toBeNull();
      expect(component.typeRows()).toEqual([]);
      expect(mockAdminService.getNxqlTotalSize).not.toHaveBeenCalled();
    });

    it('should normalize path by adding trailing slash', () => {
      component.distPath.set('/workspaces/test');
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(50));

      component.refreshDistribution();

      expect(component.distPath()).toBe('/workspaces/test/');
    });

    it('should handle API errors by clearing data and stopping loading spinner', () => {
      component.distPath.set('/workspaces/test');
      mockAdminService.getNxqlTotalSize.mockReturnValue(throwError(() => new Error('API Error')));

      component.refreshDistribution();

      expect(component.distLoading()).toBe(false);
      expect(component.totalUnderPath()).toBeNull();
      expect(component.typeRows()).toEqual([]);
    });

    it('should escape single quotes in NXQL path literals', () => {
      component.distPath.set("/workspaces/test's-path");
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(10));

      component.refreshDistribution();

      const calls = mockAdminService.getNxqlTotalSize.mock.calls;
      expect(calls[0][0]).toContain("test''s-path");
    });

    it('should query all primary types: Folder, File, Note, Picture, Workspace, Collection', () => {
      component.distPath.set('/workspaces/test');
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(10));

      component.refreshDistribution();

      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalledTimes(7);
      const calls = mockAdminService.getNxqlTotalSize.mock.calls;
      expect(calls[1][0]).toContain("ecm:primaryType = 'Folder'");
      expect(calls[2][0]).toContain("ecm:primaryType = 'File'");
      expect(calls[3][0]).toContain("ecm:primaryType = 'Note'");
      expect(calls[4][0]).toContain("ecm:primaryType = 'Picture'");
      expect(calls[5][0]).toContain("ecm:primaryType = 'Workspace'");
      expect(calls[6][0]).toContain("ecm:primaryType = 'Collection'");
    });
  });

  describe('refreshRepositorySample', () => {
    it('should fetch up to 25 documents sorted by modified date descending', () => {
      const mockDocs = [
        { uid: '1', path: '/doc1', type: 'File', properties: { 'dc:modified': '2026-09-20' } },
        { uid: '2', path: '/doc2', type: 'Folder', properties: { 'dc:modified': '2026-09-19' } },
      ];
      component.repoPath.set('/workspaces/test');
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: mockDocs, totalSize: 2 }));

      component.refreshRepositorySample();

      expect(component.repoPath()).toBe('/workspaces/test/');
      expect(mockAdminService.nxqlSearch).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY dc:modified DESC'),
        25,
        0,
      );
      expect(component.repoDocs()).toEqual(mockDocs);
      expect(component.repoTotal()).toBe(2);
      expect(component.repoLoading()).toBe(false);
    });

    it('should normalize path with trailing slash', () => {
      component.repoPath.set('/workspaces/test');
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));

      component.refreshRepositorySample();

      expect(component.repoPath()).toBe('/workspaces/test/');
    });

    it('should handle API errors by clearing docs and stopping spinner', () => {
      component.repoPath.set('/workspaces/test');
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => new Error('API Error')));

      component.refreshRepositorySample();

      expect(component.repoDocs()).toEqual([]);
      expect(component.repoTotal()).toBe(0);
      expect(component.repoLoading()).toBe(false);
    });
  });

  describe('refreshSearchMetric', () => {
    it('should fetch total searchable document count', () => {
      const mockCount = 500;
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(mockCount));

      component.refreshSearchMetric();

      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalledWith(
        expect.stringContaining("ecm:mixinType != 'HiddenInNavigation'"),
      );
      expect(component.searchMetricTotal()).toBe(mockCount);
    });

    it('should handle API errors by setting null value', () => {
      mockAdminService.getNxqlTotalSize.mockReturnValue(throwError(() => new Error('API Error')));

      component.refreshSearchMetric();

      expect(component.searchMetricTotal()).toBeNull();
    });
  });

  describe('runAnomalyDetection', () => {
    it('should call AI gateway with current time range signal value', () => {
      const mockResponse = {
        anomalies: [anomaly()],
        summary: 'Test summary',
      };
      component.aiAnomalyTimeRange.set('7d');
      mockAiGatewayService.detectAnomalies.mockReturnValue(of(mockResponse));

      component.runAnomalyDetection();

      expect(mockAiGatewayService.detectAnomalies).toHaveBeenCalledWith('7d');
    });

    it('should update anomalies and summary on success', () => {
      const mockResponse = {
        anomalies: [
          anomaly({ description: 'Test anomaly 1' }),
          anomaly({
            description: 'Test anomaly 2',
            severity: 'medium',
            timestamp: '2026-09-22T11:00:00Z',
          }),
        ],
        summary: 'Found 2 anomalies in the last 24 hours',
      };
      mockAiGatewayService.detectAnomalies.mockReturnValue(of(mockResponse));

      component.runAnomalyDetection();

      expect(component.aiAnomalies()).toEqual(mockResponse.anomalies);
      expect(component.aiAnomalySummary()).toBe(mockResponse.summary);
      expect(component.aiAnomalyLoading()).toBe(false);
    });

    it('should handle errors with translated error message and clear anomalies', () => {
      mockAiGatewayService.detectAnomalies.mockReturnValue(
        throwError(() => new Error('API Error')),
      );

      component.runAnomalyDetection();

      expect(component.aiAnomalies()).toEqual([]);
      // The English the real catalogue serves for `admin.message.failed-to-detect-anomalies`, so
      // this asserts what a user reads rather than the key a developer typed.
      expect(component.aiAnomalySummary()).toBe('Failed to detect anomalies');
      expect(component.aiAnomalyLoading()).toBe(false);
    });

    it('should set loading state correctly during async operation', () => {
      // A pending `Subject`, not `of(...)`. With a synchronous observable the response lands during
      // `subscribe()` and the flag is already back to false, so the test only ever saw false at both
      // ends — deleting `aiAnomalyLoading.set(true)` from `runAnomalyDetection` would have left it
      // green. The `true` assertion in the middle is the one that makes this test earn its name.
      const pending = new Subject<AnomaliesResponse>();
      mockAiGatewayService.detectAnomalies.mockReturnValue(pending.asObservable());

      expect(component.aiAnomalyLoading()).toBe(false);

      component.runAnomalyDetection();
      expect(component.aiAnomalyLoading()).toBe(true);

      pending.next({ anomalies: [], summary: 'No anomalies detected' });
      expect(component.aiAnomalyLoading()).toBe(false);
    });
  });

  describe('severityColor', () => {
    it('should return #d32f2f for high severity', () => {
      expect(component.severityColor('high')).toBe('#d32f2f');
    });

    it('should return #ed6c02 for medium severity', () => {
      expect(component.severityColor('medium')).toBe('#ed6c02');
    });

    it('should return #2e7d32 for low severity', () => {
      expect(component.severityColor('low')).toBe('#2e7d32');
    });

    it('should return #2e7d32 for any other severity', () => {
      expect(component.severityColor('unknown')).toBe('#2e7d32');
      expect(component.severityColor('')).toBe('#2e7d32');
      expect(component.severityColor('info')).toBe('#2e7d32');
    });
  });

  describe('refreshWorkflow', () => {
    it('should fetch workflow document count with correct NXQL query', () => {
      const mockCount = 42;
      mockAdminService.getNxqlTotalSize.mockReturnValue(of(mockCount));

      component.refreshWorkflow();

      expect(mockAdminService.getNxqlTotalSize).toHaveBeenCalledWith(
        "SELECT * FROM Document WHERE ecm:primaryType IN ('DocumentRoute', 'Route', 'RoutingTask')",
      );
      expect(component.wfTotal()).toBe(mockCount);
      expect(component.wfLoading()).toBe(false);
    });

    it('should handle API errors by setting null value and stopping spinner', () => {
      mockAdminService.getNxqlTotalSize.mockReturnValue(throwError(() => new Error('API Error')));

      component.refreshWorkflow();

      expect(component.wfTotal()).toBeNull();
      expect(component.wfLoading()).toBe(false);
    });
  });
});
