import {
  canAddChildren,
  canFollowAnyTransition,
  canManageDocumentPermissions,
  canPublishDocument,
  canRemoveDocument,
  canWriteDocument,
  mediaTypeEssence,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { TODAY, daysBetween, daysFromToday } from './date-rules';
import type { ExtensionRuleContext, ExtensionRuleEvaluator } from './extension-rules';

/**
 * The furthest `app.rules.dateWithin` looks ahead, and the most days `app.rules.dateAfter` counts:
 * a hundred years, as the validator allows.
 */
const MAX_DAYS_AHEAD = 36500;

/** A whole number of days from 0 to {@link MAX_DAYS_AHEAD}, as the date rules take one. */
const isDays = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DAYS_AHEAD;

/** No document in focus is not "not trashed" — both trash rules deny on `null`. */
function isTrashedDocument(document: NuxeoDocument | null): boolean {
  return document?.isTrashed === true;
}

/** Manifest parameters are untyped JSON; only the strings can name a type or a facet. */
function stringParameters(parameters: readonly unknown[]): string[] {
  return parameters.filter((parameter): parameter is string => typeof parameter === 'string');
}

/** A property named as a layout names one, `{ "field": "<prefix>:<name>" }`. */
function fieldOf(parameter: unknown): string | null {
  if (typeof parameter !== 'object' || parameter === null || Array.isArray(parameter)) return null;
  const field = (parameter as Record<string, unknown>)['field'];
  return typeof field === 'string' ? field : null;
}

/**
 * What `app.rules.fieldIn` compares: the property's value when the first parameter names one, and
 * the parameter itself otherwise. Only a text, a number or a boolean can then match, so a
 * computation, which this library does not evaluate, matches nothing.
 */
function subjectOf(document: NuxeoDocument | null, parameter: unknown): unknown {
  const field = fieldOf(parameter);
  return field !== null ? document?.properties?.[field] : parameter;
}

/**
 * What `app.rules.dateAfter` reads for one of its dates: the literal `"today"` as the reader's own
 * day, and anything else as the other date rules read it. Only the literal is today: a property
 * whose value is the text `"today"` names no date.
 */
function dateOrToday(document: NuxeoDocument | null, parameter: unknown): unknown {
  return parameter === 'today' ? TODAY : subjectOf(document, parameter);
}

/**
 * How many days `value` is after today, for the date rules: today and the zone are the context's,
 * as the record page gives them from its clock, else the browser's clock and the reader's zone.
 */
function daysFromContextToday(context: ExtensionRuleContext, value: unknown): number | null {
  return daysFromToday(value, context.today ?? new Date(), context.timeZone);
}

/**
 * Whether a stored value and one a rule names are the same: texts exactly, booleans as booleans
 * or as `"true"` and `"false"`, and numbers as numbers, so that a stored `5000` is `5000`, `"5000"`
 * and `"5000.0"`. A value that is none of these, such as a computation or an object, matches
 * nothing.
 */
function sameValue(stored: unknown, wanted: unknown): boolean {
  if (typeof stored === 'number') {
    const number =
      typeof wanted === 'number'
        ? wanted
        : typeof wanted === 'string' && wanted.trim() !== ''
          ? Number(wanted)
          : NaN;
    return number === stored;
  }
  if (typeof stored === 'boolean') return wanted === stored || wanted === String(stored);
  if (typeof stored === 'string')
    return (
      wanted === stored ||
      (typeof wanted !== 'object' && wanted !== undefined && String(wanted) === stored)
    );
  return false;
}

/**
 * The document's type is one of `types`, matched exactly. `app.rules.isType` and
 * `app.rules.isNote` both answer through this, so they cannot disagree about a Note.
 */
export function documentTypeIsOneOf(
  document: NuxeoDocument | null,
  types: readonly string[],
): boolean {
  const type = document?.type;
  return type !== undefined && types.includes(type);
}

/**
 * The packaged document rules, as manifest-referenceable ids.
 *
 * These wrap the pure predicates already in
 * `libs/shared/nuxeo-client/src/lib/utils/document-permissions.ts`. They are
 * already `(doc) => boolean`, so this is **registration, not a rewrite** — the
 * permission logic is unchanged and still has its own tests next to it.
 *
 * `app.rules.hasSelection` and `app.rules.isAdministrator` are here because
 * every bulk action needs the first and several administration entries need the
 * second, and without them a manifest could not express "show this only when
 * something is selected" at all.
 *
 * **These are not a security control.** Nuxeo evaluates the real permission
 * server-side on every operation. A rule that returns `true` does not grant
 * anything, and hiding an action does not prevent an API call. See
 * `docs/extension-reference.md`.
 */
export const DOCUMENT_RULE_EVALUATORS: Readonly<Record<string, ExtensionRuleEvaluator>> = {
  'app.rules.canWrite': (context) => canWriteDocument(context.document),
  'app.rules.canRemove': (context) => canRemoveDocument(context.document),
  'app.rules.canAddChildren': (context) => canAddChildren(context.document),
  'app.rules.canManagePermissions': (context) => canManageDocumentPermissions(context.document),
  /**
   * Web UI's `isPublishable`: not a proxy, a record or trashed, `Publishable`, and `WriteVersion`.
   * True on a version — Web UI publishes one as it is.
   */
  'app.rules.canPublish': (context) => canPublishDocument(context.document),
  /**
   * The user may follow at least one lifecycle transition on the focused document now, as
   * nuxeo-agentic-core's `allowedTransitions` enricher lists them: what the lifecycle allows from
   * the current state, kept only when the server would follow it for this user. False on a
   * document fetched without the enricher, or from a server without the bundle.
   */
  'app.rules.canFollowTransition': (context) => canFollowAnyTransition(context.document),
  'app.rules.hasDocument': (context) => context.document !== null,
  /**
   * The focused document's type is one of `parameters` — `["Case", "Claim"]`. Exact match, as
   * Nuxeo type names are case-sensitive. No parameters means no type matches, so a rule
   * misconfigured that way hides its entry rather than showing it everywhere.
   */
  'app.rules.isType': (context, parameters) =>
    documentTypeIsOneOf(context.document, stringParameters(parameters)),
  /** The focused document carries at least one facet in `parameters` — `["Folderish"]`. */
  'app.rules.hasFacet': (context, parameters) => {
    const facets = context.document?.facets ?? [];
    return stringParameters(parameters).some((facet) => facets.includes(facet));
  },
  /**
   * The focused record's property is one of the values (layout-v2.md, section 5): the first
   * parameter names the property, `{ "field": "<prefix>:<name>" }`, and the rest are the values,
   * compared as `sameValue` compares them. For a list, any of its items may match. A literal first
   * parameter is compared as it is. A computation there is not evaluated by this library, which
   * the validator refuses, so with one the rule does not pass.
   */
  'app.rules.fieldIn': (context, parameters) => {
    const [subject, ...values] = parameters;
    const value = subjectOf(context.document, subject);
    const items: readonly unknown[] = Array.isArray(value) ? value : [value];
    return items.some((item) => values.some((wanted) => sameValue(item, wanted)));
  },
  /**
   * The date has passed (layout-v2.md, section 5): its day is before the reader's today. The
   * parameter is the date, a property of the focused record, `{ "field": "dc:expired" }`, or a
   * literal, read as `date-rules.ts` reads one: a stored day as written, an instant on the reader's
   * own day. No date, or a value that is not one, does not pass, so a banner it shows stays hidden.
   * Today and the reader's zone are the context's, `today` and `timeZone`, which the record page
   * gives from its own clock; without them, the browser's.
   */
  'app.rules.datePassed': (context, parameters) => {
    const days = daysFromContextToday(context, subjectOf(context.document, parameters[0]));
    return days !== null && days < 0;
  },
  /**
   * The date is today or within the next `days` days: `[{ "field": "dc:expired" }, 30]` passes from
   * thirty days before it to the day itself, and not once it has passed, which `datePassed` says.
   * `days` is a whole number from 0 to 36500; any other, or none, and the rule does not pass.
   */
  'app.rules.dateWithin': (context, parameters) => {
    const [subject, ahead] = parameters;
    if (!isDays(ahead)) return false;
    const days = daysFromContextToday(context, subjectOf(context.document, subject));
    return days !== null && days >= 0 && days <= ahead;
  },
  /**
   * The first date is more than `days` days after the second (layout-v2.md, section 5):
   * `[{ "field": "dmg:filedOn" }, { "field": "dmg:deliveredOn" }, 30]` passes for a claim filed on
   * the 31st day after its delivery or later, and not on the 30th. Either date may be `"today"`, the
   * reader's day, so `["today", { "field": "dmg:deliveredOn" }, 30]` passes once the delivery is
   * more than thirty days past, and `[{ "field": "dc:expired" }, "today", 30]` while the date is
   * more than thirty days ahead. Each date is read as the other date rules read one; no date, a
   * value that is not one, or a number of days that is not a whole number from 0 to 36500, and the
   * rule does not pass. With `0` it passes when the first date is after the second at all.
   */
  'app.rules.dateAfter': (context, parameters) => {
    const [later, earlier, days] = parameters;
    if (!isDays(days)) return false;
    const between = daysBetween(
      dateOrToday(context.document, later),
      dateOrToday(context.document, earlier),
      context.today ?? new Date(),
      context.timeZone,
    );
    return between !== null && between > days;
  },
  /** The focused record's lifecycle state is one of `parameters`, matched exactly. */
  'app.rules.inState': (context, parameters) => {
    const state = context.document?.state;
    return typeof state === 'string' && stringParameters(parameters).includes(state);
  },
  /** Match the main blob's MIME essence exactly or by a family such as `image/*`. */
  'app.rules.hasMimeType': (context, parameters) => {
    const content = context.document?.properties?.['file:content'];
    if (typeof content !== 'object' || content === null || Array.isArray(content)) return false;
    const value = (content as Record<string, unknown>)['mime-type'];
    if (typeof value !== 'string') return false;
    const mime = mediaTypeEssence(value);
    if (!mime.includes('/')) return false;
    return stringParameters(parameters).some((parameter) => {
      const pattern = mediaTypeEssence(parameter);
      return pattern.endsWith('/*')
        ? mime.startsWith(pattern.slice(0, -1))
        : !pattern.includes('*') && mime === pattern;
    });
  },
  /**
   * The focused document holds a main file, `file:content` — what Download downloads. Nuxeo's
   * `Downloadable` facet is not a test for it: Picture holds a file and has no such facet.
   */
  'app.rules.hasFile': (context) => {
    const content = context.document?.properties?.['file:content'];
    return typeof content === 'object' && content !== null && !Array.isArray(content);
  },
  /** The focused document is in the trash — gates the whole write half of the toolbar. */
  'app.rules.isTrashed': (context) => isTrashedDocument(context.document),
  'app.rules.isNotTrashed': (context) =>
    context.document !== null && !isTrashedDocument(context.document),
  // The cardinality rules read `selectionCount`, which the shell can populate
  // from ids alone. The permission rules below read `selection`, which needs the
  // documents and is still empty — see `ExtensionRuleContext`.
  'app.rules.hasSelection': (context) => context.selectionCount > 0,
  'app.rules.hasSingleSelection': (context) => context.selectionCount === 1,
  'app.rules.hasMultipleSelection': (context) => context.selectionCount > 1,
  'app.rules.isAdministrator': (context) => context.user.isAdministrator,
  /**
   * The user is in one of the groups in `parameters`, as `/me` reports them (layout-v2.md,
   * section 5). No parameters, or no groups known, is no match. Never a security control: a field
   * it hides is still returned by the REST API to anyone who may read the record.
   */
  'app.rules.inGroup': (context, parameters) => {
    const groups = context.user.groups ?? [];
    return stringParameters(parameters).some((group) => groups.includes(group));
  },
  /**
   * An external share recipient: the `transient/` principal Nuxeo gives them. Hides navigation they
   * cannot use. Presentation only; the server refuses those paths to them regardless.
   */
  'app.rules.isExternalUser': (context) => (context.user.username ?? '').startsWith('transient/'),
  /** Every selected document is writable — the bulk counterpart of `canWrite`. */
  'app.rules.canWriteSelection': (context) =>
    context.selection.length > 0 && context.selection.every(canWriteDocument),
  /** Every selected document is removable — gates bulk delete. */
  'app.rules.canRemoveSelection': (context) =>
    context.selection.length > 0 && context.selection.every(canRemoveDocument),
};
