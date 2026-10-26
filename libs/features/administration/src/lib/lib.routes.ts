import { Route } from '@angular/router';
import { fullAdministratorGuard } from '@nuxeo/satori-platform/nuxeo-client';
import { AdministrationShellComponent } from './administration-shell/administration-shell.component';
import { AdminAnalyticsPageComponent } from './admin-analytics-page/admin-analytics-page.component';
import { AdminUsersGroupsPageComponent } from './admin-users-groups-page/admin-users-groups-page.component';
import { AdminUserDetailsPageComponent } from './admin-user-details-page/admin-user-details-page.component';
import { AdminGroupDetailsPageComponent } from './admin-group-details-page/admin-group-details-page.component';
import { AdminVocabulariesPageComponent } from './admin-vocabularies-page/admin-vocabularies-page.component';
import { AdminAuditPageComponent } from './admin-audit-page/admin-audit-page.component';
import { AdminCloudServicesPageComponent } from './admin-cloud-services-page/admin-cloud-services-page.component';
import { AdminNxqlSearchPageComponent } from './admin-nxql-search-page/admin-nxql-search-page.component';

export const administrationRoutes: Route[] = [
  {
    path: '',
    component: AdministrationShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'analytics' },
      {
        path: 'analytics',
        component: AdminAnalyticsPageComponent,
        canActivate: [fullAdministratorGuard],
      },
      { path: 'users-groups', component: AdminUsersGroupsPageComponent },
      { path: 'users-groups/user/:userId', component: AdminUserDetailsPageComponent },
      { path: 'users-groups/group/:groupId', component: AdminGroupDetailsPageComponent },
      { path: 'vocabularies', component: AdminVocabulariesPageComponent },
      { path: 'audit', component: AdminAuditPageComponent },
      {
        path: 'cloud-services',
        component: AdminCloudServicesPageComponent,
        canActivate: [fullAdministratorGuard],
      },
      {
        path: 'nxql-search',
        component: AdminNxqlSearchPageComponent,
        canActivate: [fullAdministratorGuard],
      },
    ],
  },
];
