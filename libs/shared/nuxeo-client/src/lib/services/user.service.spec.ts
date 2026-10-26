import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  const createInput = {
    username: 'jdoe',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Hyland',
    email: 'jdoe@example.com',
    groups: ['members'],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });

    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('creates a user with password via REST POST /user', async () => {
    const user$ = firstValueFrom(service.createUser({ ...createInput, password: 'Secret123' }));

    const req = httpMock.expectOne('/nuxeo/api/v1/user');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      'entity-type': 'user',
      id: 'jdoe',
      properties: {
        username: 'jdoe',
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Hyland',
        email: 'jdoe@example.com',
        password: 'Secret123',
        groups: ['members'],
      },
    });
    req.flush({ 'entity-type': 'user', id: 'jdoe', properties: createInput });

    const user = await user$;
    expect(user.id).toBe('jdoe');
  });

  it('invites a user without password via User.Invite automation', async () => {
    const user$ = firstValueFrom(service.createUser(createInput));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/User.Invite');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      input: {
        'entity-type': 'user',
        id: '',
        properties: {
          username: 'jdoe',
          firstName: 'Jane',
          lastName: 'Doe',
          company: 'Hyland',
          email: 'jdoe@example.com',
          groups: ['members'],
        },
      },
      params: {},
      context: {},
    });
    req.flush('registration-request-id');

    const user = await user$;
    expect(user.id).toBe('jdoe');
    expect(user.properties.email).toBe('jdoe@example.com');
  });

  it('treats blank password as invitation flow', async () => {
    const user$ = firstValueFrom(service.createUser({ ...createInput, password: '   ' }));

    const req = httpMock.expectOne('/nuxeo/api/v1/automation/User.Invite');
    req.flush('registration-request-id');

    await user$;
  });

  it('requests group members via fetch.group enricher header (NXSAT-153)', async () => {
    const group$ = firstValueFrom(service.getGroup('administrators'));
    const req = httpMock.expectOne('/nuxeo/api/v1/group/administrators');
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('fetch.group')).toBe('memberUsers,memberGroups');
    req.flush({
      'entity-type': 'group',
      groupname: 'administrators',
      grouplabel: 'Administrators',
      memberUsers: ['Administrator', 'demoUserSatori'],
      memberGroups: [],
    });

    await expect(group$).resolves.toMatchObject({
      groupname: 'administrators',
      memberUsers: ['Administrator', 'demoUserSatori'],
      memberGroups: [],
    });
  });

  it('encodes special characters in group id', () => {
    service.getGroup('group/with space').subscribe();
    const req = httpMock.expectOne('/nuxeo/api/v1/group/group%2Fwith%20space');
    expect(req.request.headers.get('fetch.group')).toBe('memberUsers,memberGroups');
    req.flush({ 'entity-type': 'group', groupname: 'group/with space' });
  });

  it('does not request group members on lightweight group search (participant picker)', () => {
    service.searchGroups('adm').subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === '/nuxeo/api/v1/group/search' && r.params.get('q') === 'adm',
    );
    expect(req.request.headers.has('fetch.group')).toBe(false);
    req.flush({
      'entity-type': 'groups',
      entries: [
        { 'entity-type': 'group', groupname: 'administrators', grouplabel: 'Administrators' },
      ],
    });
  });

  it('requests group members on paged group search (NXSAT-171)', () => {
    service.searchGroupsPaged('*', 5, 0).subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/group/search' &&
        r.params.get('q') === '*' &&
        r.params.get('pageSize') === '5',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('fetch.group')).toBe('memberUsers,memberGroups');
    req.flush({
      'entity-type': 'groups',
      entries: [
        {
          'entity-type': 'group',
          groupname: 'powerusers',
          grouplabel: 'Power Users',
          memberUsers: ['poweruser01', 'poweruser02'],
          memberGroups: [],
        },
      ],
      totalSize: 1,
    });
  });

  it('loads recently created users and groups via page provider (NXSAT-171)', async () => {
    const list$ = firstValueFrom(service.getRecentlyCreatedUsersAndGroups(50, 0));
    const req = httpMock.expectOne(
      (r) =>
        r.url === '/nuxeo/api/v1/search/pp/LATEST_CREATED_USERS_OR_GROUPS_PROVIDER/execute' &&
        r.params.get('pageSize') === '50' &&
        r.params.get('currentPageIndex') === '0',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('properties')).toBe('*');
    req.flush({
      entries: [
        {
          uid: 'poweruser02',
          type: 'user',
          properties: {
            'user:firstName': 'Power',
            'user:lastName': 'User Two',
            'user:email': 'pu02@example.com',
          },
        },
      ],
      totalSize: 1,
    });

    const list = await list$;
    expect(list.entries?.[0]?.uid).toBe('poweruser02');
  });

  it('uses wildcard user search when query is empty (NXSAT-151)', async () => {
    const list$ = firstValueFrom(service.searchUsersPaged('', 20, 0));

    const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/user/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('*');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.get('currentPageIndex')).toBe('0');
    req.flush({ 'entity-type': 'users', entries: [], totalSize: 0 });

    await list$;
  });

  it('searches users by query via /user/search when query is non-empty', async () => {
    const list$ = firstValueFrom(service.searchUsersPaged('jdoe', 20, 0));

    const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/user/search');
    expect(req.request.params.get('q')).toBe('jdoe');
    req.flush({ 'entity-type': 'users', entries: [], totalSize: 0 });

    await list$;
  });
});
