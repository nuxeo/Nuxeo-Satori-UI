import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';
import { administrationRoutes } from './lib.routes';
import { AdministrationShellComponent } from './administration-shell/administration-shell.component';
import { AdminAnalyticsPageComponent } from './admin-analytics-page/admin-analytics-page.component';
import { AdminUsersGroupsPageComponent } from './admin-users-groups-page/admin-users-groups-page.component';
import { AdminUserDetailsPageComponent } from './admin-user-details-page/admin-user-details-page.component';
import { AdminGroupDetailsPageComponent } from './admin-group-details-page/admin-group-details-page.component';
import { AdminVocabulariesPageComponent } from './admin-vocabularies-page/admin-vocabularies-page.component';
import { AdminAuditPageComponent } from './admin-audit-page/admin-audit-page.component';
import { AdminCloudServicesPageComponent } from './admin-cloud-services-page/admin-cloud-services-page.component';
import { AdminNxqlSearchPageComponent } from './admin-nxql-search-page/admin-nxql-search-page.component';

describe('administrationRoutes', () => {
  it('should define administration routes array', () => {
    expect(administrationRoutes).toBeDefined();
    expect(Array.isArray(administrationRoutes)).toBe(true);
    expect(administrationRoutes.length).toBe(1);
  });

  it('should use AdministrationShellComponent as parent route', () => {
    const parentRoute = administrationRoutes[0];
    expect(parentRoute.path).toBe('');
    expect(parentRoute.component).toBe(AdministrationShellComponent);
    expect(parentRoute.children).toBeDefined();
  });

  it('should have 9 child routes', () => {
    const parentRoute = administrationRoutes[0];
    expect(parentRoute.children).toBeDefined();
    expect(parentRoute.children?.length).toBe(9);
  });

  it('should redirect from empty path to analytics', () => {
    const parentRoute = administrationRoutes[0];
    const redirectRoute = parentRoute.children?.[0];
    expect(redirectRoute?.path).toBe('');
    expect(redirectRoute?.pathMatch).toBe('full');
    expect(redirectRoute?.redirectTo).toBe('analytics');
  });

  // The three administrator-only routes below compare `canActivate` to `[fullAdministratorGuard]`
  // by identity, not to "some guard of length 1". A length check stays green when the guard is
  // swapped for any other function, which on a security-sensitive route is the one regression these
  // tests exist to catch.
  it('should configure analytics route with fullAdministratorGuard', () => {
    const parentRoute = administrationRoutes[0];
    const analyticsRoute = parentRoute.children?.find((r) => r.path === 'analytics');
    expect(analyticsRoute).toBeDefined();
    expect(analyticsRoute?.component).toBe(AdminAnalyticsPageComponent);
    expect(analyticsRoute?.canActivate).toEqual([fullAdministratorGuard]);
  });

  it('should configure users-groups route', () => {
    const parentRoute = administrationRoutes[0];
    const usersGroupsRoute = parentRoute.children?.find((r) => r.path === 'users-groups');
    expect(usersGroupsRoute).toBeDefined();
    expect(usersGroupsRoute?.component).toBe(AdminUsersGroupsPageComponent);
    expect(usersGroupsRoute?.canActivate).toBeUndefined();
  });

  it('should configure user details route with userId parameter', () => {
    const parentRoute = administrationRoutes[0];
    const userDetailsRoute = parentRoute.children?.find(
      (r) => r.path === 'users-groups/user/:userId',
    );
    expect(userDetailsRoute).toBeDefined();
    expect(userDetailsRoute?.component).toBe(AdminUserDetailsPageComponent);
    expect(userDetailsRoute?.path).toContain(':userId');
  });

  it('should configure group details route with groupId parameter', () => {
    const parentRoute = administrationRoutes[0];
    const groupDetailsRoute = parentRoute.children?.find(
      (r) => r.path === 'users-groups/group/:groupId',
    );
    expect(groupDetailsRoute).toBeDefined();
    expect(groupDetailsRoute?.component).toBe(AdminGroupDetailsPageComponent);
    expect(groupDetailsRoute?.path).toContain(':groupId');
  });

  it('should configure vocabularies route', () => {
    const parentRoute = administrationRoutes[0];
    const vocabulariesRoute = parentRoute.children?.find((r) => r.path === 'vocabularies');
    expect(vocabulariesRoute).toBeDefined();
    expect(vocabulariesRoute?.component).toBe(AdminVocabulariesPageComponent);
    expect(vocabulariesRoute?.canActivate).toBeUndefined();
  });

  it('should configure audit route', () => {
    const parentRoute = administrationRoutes[0];
    const auditRoute = parentRoute.children?.find((r) => r.path === 'audit');
    expect(auditRoute).toBeDefined();
    expect(auditRoute?.component).toBe(AdminAuditPageComponent);
    expect(auditRoute?.canActivate).toBeUndefined();
  });

  it('should configure cloud-services route with fullAdministratorGuard', () => {
    const parentRoute = administrationRoutes[0];
    const cloudServicesRoute = parentRoute.children?.find((r) => r.path === 'cloud-services');
    expect(cloudServicesRoute).toBeDefined();
    expect(cloudServicesRoute?.component).toBe(AdminCloudServicesPageComponent);
    expect(cloudServicesRoute?.canActivate).toEqual([fullAdministratorGuard]);
  });

  it('should configure nxql-search route with fullAdministratorGuard', () => {
    const parentRoute = administrationRoutes[0];
    const nxqlSearchRoute = parentRoute.children?.find((r) => r.path === 'nxql-search');
    expect(nxqlSearchRoute).toBeDefined();
    expect(nxqlSearchRoute?.component).toBe(AdminNxqlSearchPageComponent);
    expect(nxqlSearchRoute?.canActivate).toEqual([fullAdministratorGuard]);
  });
});

describe('administrationRoutes navigation', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {
            path: 'admin',
            children: administrationRoutes,
          },
        ]),
      ],
    });

    router = TestBed.inject(Router);
  });

  it('should navigate to users-groups route', async () => {
    await router.navigate(['/admin/users-groups']);
    expect(router.url).toBe('/admin/users-groups');
  });

  it('should navigate to user details with userId parameter', async () => {
    await router.navigate(['/admin/users-groups/user/test-user-123']);
    expect(router.url).toBe('/admin/users-groups/user/test-user-123');
  });

  it('should navigate to group details with groupId parameter', async () => {
    await router.navigate(['/admin/users-groups/group/test-group-456']);
    expect(router.url).toBe('/admin/users-groups/group/test-group-456');
  });

  it('should navigate to vocabularies route', async () => {
    await router.navigate(['/admin/vocabularies']);
    expect(router.url).toBe('/admin/vocabularies');
  });

  it('should navigate to audit route', async () => {
    await router.navigate(['/admin/audit']);
    expect(router.url).toBe('/admin/audit');
  });
});
