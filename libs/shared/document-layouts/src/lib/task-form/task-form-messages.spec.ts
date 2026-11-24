import { describe, expect, it } from 'vitest';

import { readValidationFailure } from '../validation-failure';
import { taskFormMessages } from './task-form';

describe('taskFormMessages', () => {
  it('places a variable’s message on its var: field, whichever variable schema names it', () => {
    expect(
      taskFormMessages({
        'var_determine:allowedAmount': 'Too large',
        'var_claimDetermination:reviewer': 'Needed',
      }),
    ).toEqual({ 'var:allowedAmount': 'Too large', 'var:reviewer': 'Needed' });
  });

  it('keeps a record property’s message, and one that names no field, where they are', () => {
    expect(taskFormMessages({ 'claim:number': 'Taken', '': 'Refused' })).toEqual({
      'claim:number': 'Taken',
      '': 'Refused',
    });
  });

  it('keeps the first message when two schemas name the same variable', () => {
    expect(taskFormMessages({ 'var_a:decision': 'First', 'var_b:decision': 'Second' })).toEqual({
      'var:decision': 'First',
    });
  });

  it('reads a 422 constraint violation on a variable, as Nuxeo 2025 answers one', () => {
    const failure = {
      status: 422,
      error: {
        'entity-type': 'exception',
        message:
          "Constraint violation thrown on property var_ParallelDocumentReview:review_result: 'This property cannot contain more than 10,000 character(s).'",
      },
    };
    const messages = readValidationFailure(failure, 'Invalid');
    expect(messages).not.toBeNull();
    expect(taskFormMessages(messages ?? {})).toEqual({
      'var:review_result': 'This property cannot contain more than 10,000 character(s).',
    });
  });
});
