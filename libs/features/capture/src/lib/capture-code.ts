import type { RecordCapture } from '@agentic-ui/shared/document-layouts';

/** A record's id anywhere in a text: in a link to its page, or alone. */
const DOCUMENT_ID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The longest number the page looks up. A barcode on a delivery note holds far fewer. */
export const CAPTURE_CODE_MAX_LENGTH = 64;

/**
 * What was typed, pasted or scanned to choose the record: its id, found in a link to its page or
 * alone; else a number to look up; `empty` for nothing; `too-long` past
 * {@link CAPTURE_CODE_MAX_LENGTH}.
 */
export type CaptureCode =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'number'; readonly number: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long' };

/**
 * Reads a code as a person or a scanner gives it. A barcode scanner types like a keyboard, and
 * some send a tab, a carriage return or a group separator round what they read: control and
 * zero-width characters are taken out, and the spaces at either end.
 */
export function readCaptureCode(text: string): CaptureCode {
  // eslint-disable-next-line no-control-regex
  const code = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g, '').trim();
  if (code === '') return { kind: 'empty' };
  const id = DOCUMENT_ID_IN.exec(code)?.[0];
  if (id) return { kind: 'id', id: id.toLowerCase() };
  if (code.length > CAPTURE_CODE_MAX_LENGTH) return { kind: 'too-long' };
  return { kind: 'number', number: code };
}

/** A property name that may be written into a query's text: `<prefix>:<name>`, and nothing else. */
const PROPERTY = /^[A-Za-z_][A-Za-z0-9_-]*:[A-Za-z_][A-Za-z0-9_-]*$/;
/** A document type's name, as Nuxeo allows one. */
const TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** The types photos are filed on, each with the properties a number is looked up in. */
export interface CaptureTarget {
  readonly type: string;
  readonly capture: RecordCapture;
}

/** A search's text and its values, each `?` of the text one of `params`, in order. */
export interface CaptureLookup {
  readonly query: string;
  readonly params: readonly string[];
}

/**
 * The search for the records of `targets` that a number names, in any of the properties each
 * type's capture looks a number up in: live records, neither versions, proxies nor in the trash.
 * The number is a value, `?`, never in the text, both as it was given and in capitals, since a
 * phone's keyboard capitalises the first letter of what is typed, and a number is mostly written
 * in capitals. A type's name and its properties are written into the text, so each is held to a
 * name's form first, and one that is not is left out. `null` when no type has a property to look
 * in.
 */
export function captureLookup(
  targets: readonly CaptureTarget[],
  number: string,
): CaptureLookup | null {
  const values = [...new Set([number, number.toUpperCase()])];
  const marks = values.map(() => '?').join(', ');
  const clauses: string[] = [];
  const params: string[] = [];
  for (const { type, capture } of targets) {
    const properties = capture.findBy.filter((name) => PROPERTY.test(name));
    if (!TYPE.test(type) || properties.length === 0) continue;
    clauses.push(
      `(ecm:primaryType = ? AND (${properties.map((name) => `${name} IN (${marks})`).join(' OR ')}))`,
    );
    params.push(type, ...properties.flatMap(() => values));
  }
  if (clauses.length === 0) return null;
  return {
    query:
      `SELECT * FROM Document WHERE (${clauses.join(' OR ')}) AND ecm:isVersion = 0` +
      ' AND ecm:isProxy = 0 AND ecm:isTrashed = 0 ORDER BY dc:modified DESC',
    params,
  };
}
