import { HttpErrorResponse } from '@angular/common/http';

import { readValidationFailure } from './validation-failure';

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
