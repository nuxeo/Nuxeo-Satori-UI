import { describe, expect, it } from 'vitest';

import { permissionRightLabel } from './permission-label.utils';

const echoKey = (key: string) => key;

describe('permissionRightLabel', () => {
  it('labels the standard grantable set, not only the original three', () => {
    // NXSAT-300: the twelve the external review named, plus the retention pair.
    for (const permission of [
      'Read',
      'ReadWrite',
      'Everything',
      'Write',
      'ReadVersion',
      'WriteVersion',
      'AddChildren',
      'RemoveChildren',
      'Remove',
      'Version',
      'WriteSecurity',
      'Unlock',
      'SetRetention',
      'UnsetRetention',
    ]) {
      expect(permissionRightLabel(permission, echoKey)).toBe(`permissions.right.${permission}`);
    }
    expect(permissionRightLabel('CanAskForPublishing', echoKey)).toBe(
      'permissions.right.CanAskForPublishing',
    );
  });

  it('labels the atomic permissions Web UI labels, rather than showing their Nuxeo names', () => {
    // NXSAT-300 carry-over: the nine Web UI's label.security.permission.* has and we lacked.
    for (const permission of [
      'Browse',
      'ReadChildren',
      'ReadLifeCycle',
      'ReadProperties',
      'ReadSecurity',
      'WriteLifeCycle',
      'WriteProperties',
      'ManageLegalHold',
      'ManageRecord',
    ]) {
      expect(permissionRightLabel(permission, echoKey)).toBe(`permissions.right.${permission}`);
    }
  });

  it('asks the catalogue for each permission it ships a label for', () => {
    expect(permissionRightLabel('Everything', echoKey)).toBe('permissions.right.Everything');
    expect(permissionRightLabel('ReadWrite', echoKey)).toBe('permissions.right.ReadWrite');
    expect(permissionRightLabel('ReadCanCollect', echoKey)).toBe(
      'permissions.right.ReadCanCollect',
    );
  });

  it('returns an unknown permission verbatim rather than leaking a key', () => {
    // A marketplace package can define its own permissions and Nuxeo sends the identifier
    // regardless. Translating blindly would render `permissions.right.CustomFromMarketplace` in
    // the table; the raw Nuxeo name is at least meaningful to an administrator.
    expect(permissionRightLabel('CustomFromMarketplace', echoKey)).toBe('CustomFromMarketplace');
    expect(permissionRightLabel('', echoKey)).toBe('');
  });

  it('consults the resolver rather than returning English of its own', () => {
    // The failure this guards is the one the three hardcoded `Record<string, string>` copies had:
    // a function that answers in English no matter what the caller's locale is.
    expect(permissionRightLabel('Read', (key) => `resolved:${key}`)).toBe(
      'resolved:permissions.right.Read',
    );
  });
});
