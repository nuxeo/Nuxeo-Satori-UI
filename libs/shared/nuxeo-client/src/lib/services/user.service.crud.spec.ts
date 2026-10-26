import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import type { NuxeoGroup, NuxeoUser } from '../models/user.model';
import { UserService } from './user.service';

const existingUser: NuxeoUser = {
  'entity-type': 'user',
  id: 'jdoe',
  properties: {
    username: 'jdoe',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Hyland',
    email: 'jdoe@example.com',
    groups: ['members'],
  },
};

const existingGroup: NuxeoGroup = {
  'entity-type': 'group',
  groupname: 'reviewers',
  grouplabel: 'Reviewers',
  memberUsers: ['jdoe'],
  memberGroups: ['members'],
} as NuxeoGroup;

describe('UserService write operations', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

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

  describe('updateUser', () => {
    it('reads the user first and merges the change into the existing properties', async () => {
      // A blind PUT of only the changed field would wipe every property the caller did not
      // mention — Nuxeo replaces the whole `properties` object.
      const pending = firstValueFrom(service.updateUser('jdoe', { firstName: 'Janet' }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);

      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties).toEqual({
        username: 'jdoe',
        firstName: 'Janet',
        lastName: 'Doe',
        company: 'Hyland',
        email: 'jdoe@example.com',
        groups: ['members'],
      });
      put.flush(existingUser);
      await pending;
    });

    it('allows a field to be cleared with an empty string', async () => {
      const pending = firstValueFrom(service.updateUser('jdoe', { company: '' }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties.company).toBe('');
      put.flush(existingUser);
      await pending;
    });

    it('allows group membership to be emptied', async () => {
      const pending = firstValueFrom(service.updateUser('jdoe', { groups: [] }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties.groups).toEqual([]);
      put.flush(existingUser);
      await pending;
    });

    it('never sends a password key when no password was given', async () => {
      const pending = firstValueFrom(service.updateUser('jdoe', { lastName: 'Smith' }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties).not.toHaveProperty('password');
      put.flush(existingUser);
      await pending;
    });

    it('ignores an empty password rather than blanking the credential', async () => {
      const pending = firstValueFrom(service.updateUser('jdoe', { password: '' }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties).not.toHaveProperty('password');
      put.flush(existingUser);
      await pending;
    });

    it('sends a non-empty password through', async () => {
      const pending = firstValueFrom(service.updateUser('jdoe', { password: 'NewSecret1' }));
      httpMock.expectOne('/nuxeo/api/v1/user/jdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.properties.password).toBe('NewSecret1');
      put.flush(existingUser);
      await pending;
    });

    it('sends the id the server reported rather than the one the caller passed', async () => {
      const pending = firstValueFrom(service.updateUser('JDoe', { lastName: 'Smith' }));
      httpMock.expectOne('/nuxeo/api/v1/user/JDoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.id).toBe('jdoe');
      put.flush(existingUser);
      await pending;
    });

    it('never issues the PUT when the read failed', async () => {
      const pending = firstValueFrom(service.updateUser('ghost', { lastName: 'Smith' }));
      httpMock
        .expectOne('/nuxeo/api/v1/user/ghost')
        .flush('No such user', { status: 404, statusText: 'Not Found' });
      httpMock.expectNone((r) => r.method === 'PUT');
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });

    it('encodes a user id containing a slash into the URL path', async () => {
      const pending = firstValueFrom(service.updateUser('domain/jdoe', { lastName: 'Smith' }));
      httpMock.expectOne('/nuxeo/api/v1/user/domain%2Fjdoe').flush(existingUser);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.url).toBe('/nuxeo/api/v1/user/domain%2Fjdoe');
      put.flush(existingUser);
      await pending;
    });
  });

  describe('deleteUser', () => {
    it('deletes by encoded id and completes with no value', async () => {
      const pending = firstValueFrom(service.deleteUser('domain/jdoe'));
      const req = httpMock.expectOne('/nuxeo/api/v1/user/domain%2Fjdoe');
      expect(req.request.method).toBe('DELETE');
      req.flush({ some: 'body' });
      expect(await pending).toBeUndefined();
    });

    it('propagates a delete failure', async () => {
      const pending = firstValueFrom(service.deleteUser('jdoe'));
      httpMock
        .expectOne('/nuxeo/api/v1/user/jdoe')
        .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('createGroup', () => {
    it('sends both member lists, defaulting each to empty', async () => {
      // Nuxeo rejects the create when either list is absent, so the defaults are required
      // rather than cosmetic.
      const pending = firstValueFrom(
        service.createGroup({ groupname: 'reviewers', grouplabel: 'Reviewers' }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/group');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        'entity-type': 'group',
        groupname: 'reviewers',
        grouplabel: 'Reviewers',
        memberUsers: [],
        memberGroups: [],
      });
      req.flush(existingGroup);
      await pending;
    });

    it('passes through the members it was given', async () => {
      const pending = firstValueFrom(
        service.createGroup({
          groupname: 'reviewers',
          grouplabel: 'Reviewers',
          memberUsers: ['jdoe'],
          memberGroups: ['members'],
        }),
      );
      const req = httpMock.expectOne('/nuxeo/api/v1/group');
      expect(req.request.body.memberUsers).toEqual(['jdoe']);
      expect(req.request.body.memberGroups).toEqual(['members']);
      req.flush(existingGroup);
      await pending;
    });

    it('propagates a conflict when the group already exists', async () => {
      const pending = firstValueFrom(
        service.createGroup({ groupname: 'reviewers', grouplabel: 'Reviewers' }),
      );
      httpMock
        .expectOne('/nuxeo/api/v1/group')
        .flush('Already exists', { status: 409, statusText: 'Conflict' });
      await expect(pending).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('updateGroup', () => {
    it('keeps the existing label and members for fields the caller omitted', async () => {
      // Nuxeo replaces the whole group entity, so omitting members here would empty the group.
      const pending = firstValueFrom(service.updateGroup('reviewers', {}));
      httpMock.expectOne('/nuxeo/api/v1/group/reviewers').flush(existingGroup);

      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body).toEqual({
        'entity-type': 'group',
        groupname: 'reviewers',
        grouplabel: 'Reviewers',
        memberUsers: ['jdoe'],
        memberGroups: ['members'],
      });
      put.flush(existingGroup);
      await pending;
    });

    it('applies the label and member lists the caller did provide', async () => {
      const pending = firstValueFrom(
        service.updateGroup('reviewers', {
          grouplabel: 'Senior Reviewers',
          memberUsers: ['jsmith'],
          memberGroups: [],
        }),
      );
      httpMock.expectOne('/nuxeo/api/v1/group/reviewers').flush(existingGroup);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.grouplabel).toBe('Senior Reviewers');
      expect(put.request.body.memberUsers).toEqual(['jsmith']);
      expect(put.request.body.memberGroups).toEqual([]);
      put.flush(existingGroup);
      await pending;
    });

    it('defaults to empty lists when the server sent a group with no members key', async () => {
      const bare = {
        'entity-type': 'group',
        groupname: 'reviewers',
        grouplabel: 'Reviewers',
      } as NuxeoGroup;
      const pending = firstValueFrom(service.updateGroup('reviewers', { grouplabel: 'R2' }));
      httpMock.expectOne('/nuxeo/api/v1/group/reviewers').flush(bare);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.memberUsers).toEqual([]);
      expect(put.request.body.memberGroups).toEqual([]);
      put.flush(bare);
      await pending;
    });

    it('sends the groupname the server reported, not the caller-supplied one', async () => {
      const pending = firstValueFrom(service.updateGroup('Reviewers', { grouplabel: 'R2' }));
      httpMock.expectOne('/nuxeo/api/v1/group/Reviewers').flush(existingGroup);
      const put = httpMock.expectOne((r) => r.method === 'PUT');
      expect(put.request.body.groupname).toBe('reviewers');
      put.flush(existingGroup);
      await pending;
    });

    it('never issues the PUT when the read failed', async () => {
      const pending = firstValueFrom(service.updateGroup('ghosts', { grouplabel: 'x' }));
      httpMock
        .expectOne('/nuxeo/api/v1/group/ghosts')
        .flush('No such group', { status: 404, statusText: 'Not Found' });
      httpMock.expectNone((r) => r.method === 'PUT');
      await expect(pending).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteGroup', () => {
    it('deletes by encoded groupname and completes with no value', async () => {
      const pending = firstValueFrom(service.deleteGroup('a b'));
      const req = httpMock.expectOne('/nuxeo/api/v1/group/a%20b');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
      expect(await pending).toBeUndefined();
    });

    it('propagates a delete failure', async () => {
      const pending = firstValueFrom(service.deleteGroup('reviewers'));
      httpMock
        .expectOne('/nuxeo/api/v1/group/reviewers')
        .flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      await expect(pending).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('reads', () => {
    it('returns just the entries from a user search, not the envelope', async () => {
      const pending = firstValueFrom(service.searchUsers('ja'));
      const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/user/search');
      expect(req.request.params.get('q')).toBe('ja');
      req.flush({ entries: [existingUser], resultsCount: 1 });
      expect(await pending).toEqual([existingUser]);
    });

    it('returns just the entries from a group search', async () => {
      const pending = firstValueFrom(service.searchGroups('rev'));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/group/search')
        .flush({ entries: [existingGroup], resultsCount: 1 });
      expect(await pending).toEqual([existingGroup]);
    });

    it('falls back to the wildcard for a whitespace-only paged group query', async () => {
      const pending = firstValueFrom(service.searchGroupsPaged('   ', 10, 2));
      const req = httpMock.expectOne((r) => r.url === '/nuxeo/api/v1/group/search');
      expect(req.request.params.get('q')).toBe('*');
      expect(req.request.params.get('pageSize')).toBe('10');
      expect(req.request.params.get('currentPageIndex')).toBe('2');
      req.flush({ entries: [], resultsCount: 0 });
      await pending;
    });

    it('propagates a search failure rather than returning an empty result set', async () => {
      const pending = firstValueFrom(service.searchUsers('ja'));
      httpMock
        .expectOne((r) => r.url === '/nuxeo/api/v1/user/search')
        .flush({}, { status: 500, statusText: 'Server Error' });
      await expect(pending).rejects.toBeDefined();
    });

    it('encodes a user id when reading a single user', async () => {
      const pending = firstValueFrom(service.getUser('a b'));
      httpMock.expectOne('/nuxeo/api/v1/user/a%20b').flush(existingUser);
      expect((await pending).id).toBe('jdoe');
    });
  });
});
