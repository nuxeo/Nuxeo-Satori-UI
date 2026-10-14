import {
  formatAceDateRange,
  isPermissionDeniedError,
  resolveAcePrincipal,
  type NuxeoAce,
} from '@nuxeo-satori/platform/nuxeo-client';

import { instantToDay } from './permissions-panel/permissions-model';

/**
 * Nuxeo's `userVisiblePermissions` for a type with no list of its own, for a document read without
 * that enricher.
 */
export const NXS_DEFAULT_VISIBLE_PERMISSIONS: readonly string[] = [
  'Read',
  'ReadWrite',
  'Everything',
];

/**
 * The permissions a dialog offers, as Web UI's: the document type's `userVisiblePermissions`, plus
 * `current` when an entry being edited holds one outside that list, so editing never changes it
 * silently.
 */
export function offeredRights(
  visible: readonly string[] | null | undefined,
  current?: string,
): readonly string[] {
  const list = visible?.length ? [...visible] : [...NXS_DEFAULT_VISIBLE_PERMISSIONS];
  return current && !list.includes(current) ? [...list, current] : list;
}

/** Who an entry names, as a person reads it: the display name, or an external user's email. */
export function principalLabel(ace: Pick<NuxeoAce, 'username' | 'usernameLabel'>): string {
  return ace.usernameLabel || resolveAcePrincipal(ace.username).replace(/^transient\//, '');
}

/**
 * An entry's time frame as the permissions panel shows it: the calendar days its writer picked,
 * from whatever zone, rather than the UTC dates Nuxeo returns them as — "Until 15 July" for an end
 * written at midnight in Paris, which Nuxeo holds as 22:00 UTC on the 14th.
 */
export function nxsAceTimeFrame(
  ace: Pick<NuxeoAce, 'begin' | 'end'>,
  translate: (key: string, params?: Record<string, unknown>) => string,
  locale: string,
): string {
  return formatAceDateRange(instantToDay(ace.begin), instantToDay(ace.end), translate, locale);
}

/** The key for a failed write: a refusal (401/403) reads as one rather than as a fault. */
export function failureKey(error: unknown, fallback: string): string {
  return isPermissionDeniedError(error)
    ? 'satori-components.permission-dialogs.error.forbidden'
    : fallback;
}
