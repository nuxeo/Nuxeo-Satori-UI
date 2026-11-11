import { describe, expect, it } from 'vitest';
import {
  principalPermissionTimeFrameLabel,
  principalPermissionToLocalRow,
} from './principal-permission-display';

/**
 * Returns the key instead of resolving it.
 *
 * These specs asserted the literal `'Permanent'`, which came from the resolver's old default —
 * `() => 'Permanent'`, which ignored the key it was given. Asserting that value proved the default
 * existed, not that the function asked the catalogue for the right thing, so it passed just as
 * happily while three production tables rendered English in every locale.
 */
const echoKey = (key: string) => key;

const row = {
  documentUid: '1',
  documentTitle: 'Doc',
  documentPath: '/a',
  permission: 'Read',
  begin: null,
  end: null,
  grantedBy: null,
  acePrincipal: 'group:members',
  aceId: 'group:members:Read',
};

describe('principal-permission-display', () => {
  it('principalPermissionTimeFrameLabel asks for the permanent key when there is no begin or end', () => {
    expect(principalPermissionTimeFrameLabel(row, echoKey, 'en-US')).toBe(
      'permissions.time-frame.permanent',
    );
  });

  it('principalPermissionTimeFrameLabel formats dates rather than looking up a key', () => {
    // The dated branch has nothing to translate: both ends are `toLocaleString()`, which localises
    // through `Intl` rather than through the catalogue.
    const dated = principalPermissionTimeFrameLabel(
      { ...row, begin: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' },
      echoKey,
      'en-US',
    );
    expect(dated).not.toContain('permissions.time-frame');
    expect(dated).toContain('–');
  });

  it('principalPermissionTimeFrameLabel passes the locale through rather than dropping it', () => {
    // Same failure mode as the resolver below: the wrapper can accept `locale` and not forward it,
    // and every assertion above still passes because `Intl` falls back to the host locale.
    const dated = { ...row, begin: '2026-01-02T00:00:00Z', end: null };
    expect(principalPermissionTimeFrameLabel(dated, echoKey, 'de-DE')).not.toBe(
      principalPermissionTimeFrameLabel(dated, echoKey, 'en-US'),
    );
  });

  it('principalPermissionToLocalRow maps document title, path, and permission', () => {
    expect(
      principalPermissionToLocalRow(
        {
          ...row,
          documentTitle: 'Sections',
          documentPath: '/default-domain/sections',
          permission: 'CanAskForPublishing',
        },
        echoKey,
        'en-US',
      ),
    ).toEqual({
      documentTitle: 'Sections',
      documentPath: '/default-domain/sections',
      right: 'CanAskForPublishing',
      timeFrame: 'permissions.time-frame.permanent',
      grantedBy: '—',
    });
  });

  it('principalPermissionToLocalRow passes the resolver through rather than dropping it', () => {
    // The wrapper's only job beyond mapping fields is handing the resolver on. It forgot to for a
    // while, which is how the profile page stayed English while its callers had been updated.
    expect(principalPermissionToLocalRow(row, (key) => `resolved:${key}`, 'en-US').timeFrame).toBe(
      'resolved:permissions.time-frame.permanent',
    );
  });
});
