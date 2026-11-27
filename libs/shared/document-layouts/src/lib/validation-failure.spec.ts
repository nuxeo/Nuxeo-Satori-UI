import { HttpErrorResponse } from '@angular/common/http';

import { readServerRefusal, readValidationFailure, SERVER_REASON_MAX } from './validation-failure';

describe('readValidationFailure', () => {
  it("reads the 422 this server answers, naming the property and dropping Nuxeo's index", () => {
    const failure = new HttpErrorResponse({
      status: 422,
      error: {
        'entity-type': 'exception',
        status: 422,
        message:
          "Constraint violation thrown on property dc:description[0]: 'This property cannot contain more than 2,000 character(s).'",
      },
    });
    expect(readValidationFailure(failure, 'Not valid')).toEqual({
      'dc:description': 'This property cannot contain more than 2,000 character(s).',
    });
  });

  it('files a violation inside a complex property under the top-level property', () => {
    const body = {
      'entity-type': 'exception',
      message:
        "Constraint violation thrown on property pol:holder/email[0]: 'Please enter a valid email.'",
    };
    expect(readValidationFailure(body, 'Not valid')).toEqual({
      'pol:holder': 'Please enter a valid email.',
    });
  });

  it('reads a validation report, first message per field, and files a pathless one under ""', () => {
    const report = {
      'entity-type': 'validation_report',
      violations: [
        { message: 'Required.', path: [{ field_name: 'dc:title', is_list_item: false }] },
        { message: 'Also wrong.', path: [{ field_name: 'dc:title' }] },
        {
          messageKey: 'label.schema.constraint.violation.PatternConstraint',
          path: [{ field_name: 'pol:number' }],
        },
        { message: 'The document is locked.' },
        'junk',
      ],
    };
    expect(readValidationFailure({ error: report }, 'Not valid')).toEqual({
      'dc:title': 'Required.',
      'pol:number': 'Not valid',
      '': 'The document is locked.',
    });
  });

  it('answers null for any other failure', () => {
    expect(
      readValidationFailure(
        new HttpErrorResponse({
          status: 500,
          error: { 'entity-type': 'exception', message: 'Boom' },
        }),
        'x',
      ),
    ).toBeNull();
    expect(
      readValidationFailure(
        new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }),
        'x',
      ),
    ).toBeNull();
    expect(readValidationFailure('nope', 'x')).toBeNull();
    expect(
      readValidationFailure(
        { 'entity-type': 'document', message: "Constraint violation thrown on property a:b: 'c'" },
        'x',
      ),
    ).toBeNull();
  });
});

describe('readServerRefusal', () => {
  const refusal = (status: number, message: unknown, entity = 'exception') =>
    new HttpErrorResponse({ status, error: { 'entity-type': entity, status, message } });
  const HELD =
    'This record is under a legal hold: it cannot be put in the trash or deleted until the hold is released.';

  it("reads the server's own reason for a refusal: a legal hold's, a permission's, a conflict's", () => {
    expect(readServerRefusal(refusal(409, HELD))).toBe(HELD);
    expect(
      readServerRefusal(
        refusal(403, 'User kpatel does not have the permission to remove the document'),
      ),
    ).toBe('User kpatel does not have the permission to remove the document');
    expect(readServerRefusal(refusal(400, 'Give a reason'))).toBe('Give a reason');
    // The body alone, as an Automation client's error carries it.
    expect(readServerRefusal({ 'entity-type': 'exception', status: 409, message: HELD })).toBe(
      HELD,
    );
  });

  it('leaves out what the Automation endpoint writes before the reason', () => {
    expect(
      readServerRefusal(refusal(409, `Failed to invoke operation Document.Trash, ${HELD}`)),
    ).toBe(HELD);
  });

  it('gives nothing for a server error, a message that is none, or another entity', () => {
    expect(readServerRefusal(refusal(500, 'java.lang.NullPointerException'))).toBeNull();
    expect(readServerRefusal(refusal(503, 'Service unavailable'))).toBeNull();
    expect(readServerRefusal(refusal(409, '   '))).toBeNull();
    expect(readServerRefusal(refusal(409, { nested: HELD }))).toBeNull();
    expect(readServerRefusal(refusal(409, HELD, 'validation_report'))).toBeNull();
    expect(
      readServerRefusal(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') })),
    ).toBeNull();
    expect(readServerRefusal(null)).toBeNull();
  });

  it('shows a long reason on one line, cut where the page stops reading it', () => {
    const long = `${'held '.repeat(100)}\n\tagain`;
    const read = readServerRefusal(refusal(409, long)) ?? '';
    expect(read).toHaveLength(SERVER_REASON_MAX);
    expect(read.endsWith('…')).toBe(true);
    expect(read).not.toMatch(/[\n\t]/);
  });
});
