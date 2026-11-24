import { TestBed } from '@angular/core/testing';

import {
  NUXEO_SAML_LOGIN_ENDPOINTS,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
  type NuxeoSamlLoginEndpoint,
} from './saml-login.config';

/**
 * The login page reads these three tokens to draw its single-sign-on buttons and build the URL
 * each one opens. The defaults are what a deployment gets when it configures nothing, so they
 * are the behaviour: no SSO buttons, back to the dashboard, Nuxeo's `requestedUrl`.
 */
describe('SSO login tokens', () => {
  describe('with nothing configured', () => {
    it('offers no SSO button, so a plain deployment shows the password form only', () => {
      expect(TestBed.inject(NUXEO_SAML_LOGIN_ENDPOINTS)).toEqual([]);
    });

    it('returns to the dashboard after signing in', () => {
      expect(TestBed.inject(NUXEO_SSO_POST_LOGIN_PATH)).toBe('/dashboard');
    });

    it('names the return URL with requestedUrl, the parameter Nuxeo’s form login reads', () => {
      expect(TestBed.inject(NUXEO_SSO_RETURN_QUERY_PARAM)).toBe('requestedUrl');
    });

    it('hands each injector its own endpoint list, so one caller’s change does not reach another', () => {
      const first = TestBed.inject(NUXEO_SAML_LOGIN_ENDPOINTS);
      TestBed.resetTestingModule();
      const second = TestBed.inject(NUXEO_SAML_LOGIN_ENDPOINTS);

      expect(second).not.toBe(first);
    });
  });

  describe('when a deployment configures them', () => {
    const azure: NuxeoSamlLoginEndpoint = {
      id: 'azure',
      label: 'Sign in with Azure',
      path: '/nuxeo/oauth2/authorization/azure',
    };

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          { provide: NUXEO_SAML_LOGIN_ENDPOINTS, useValue: [azure] },
          { provide: NUXEO_SSO_POST_LOGIN_PATH, useValue: '/browse' },
          { provide: NUXEO_SSO_RETURN_QUERY_PARAM, useValue: null },
        ],
      });
    });

    it('uses the configured endpoints, post-login path and return parameter', () => {
      expect(TestBed.inject(NUXEO_SAML_LOGIN_ENDPOINTS)).toEqual([azure]);
      expect(TestBed.inject(NUXEO_SSO_POST_LOGIN_PATH)).toBe('/browse');
    });

    it('accepts null for the return parameter, to send no return URL at all', () => {
      expect(TestBed.inject(NUXEO_SSO_RETURN_QUERY_PARAM)).toBeNull();
    });
  });
});
