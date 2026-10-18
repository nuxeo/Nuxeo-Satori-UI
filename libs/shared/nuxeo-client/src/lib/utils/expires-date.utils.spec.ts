import {
  isExpiresFieldValid,
  shouldShowExpiresFieldError,
  createExpiresErrorStateMatcher,
} from './expires-date.utils';

describe('expires-date.utils', () => {
  it('allows empty expiry and valid datepicker values', () => {
    expect(isExpiresFieldValid('', null)).toBe(true);
    expect(isExpiresFieldValid('', new Date('2026-07-21'))).toBe(true);
  });

  it('rejects invalid expiry input while typing', () => {
    expect(isExpiresFieldValid('99/99/9999', null)).toBe(false);
    expect(isExpiresFieldValid('skdfjlksd', null)).toBe(false);
  });

  it('blocks incomplete input rather than treating it as an intentional clear', () => {
    expect(isExpiresFieldValid('01/15/', null)).toBe(false);
  });

  it('requires a valid adapter result for non-empty input', () => {
    expect(isExpiresFieldValid('02/29/2024', new Date(2024, 1, 29))).toBe(true);
    expect(isExpiresFieldValid('02/29/2023', null)).toBe(false);
  });

  it('shouldShowExpiresFieldError is true only for non-empty invalid input', () => {
    expect(shouldShowExpiresFieldError('', null)).toBe(false);
    expect(shouldShowExpiresFieldError('skdfjlksd', null)).toBe(true);
    expect(shouldShowExpiresFieldError('02/29/2024', new Date(2024, 1, 29))).toBe(false);
  });

  it('rejects invalid model values even without raw text', () => {
    expect(isExpiresFieldValid('', new Date(Number.NaN))).toBe(false);
    expect(shouldShowExpiresFieldError('', new Date(Number.NaN))).toBe(true);
  });

  it('createExpiresErrorStateMatcher reflects live invalid state', () => {
    let invalid = false;
    const matcher = createExpiresErrorStateMatcher(() => invalid);
    expect(matcher.isErrorState()).toBe(false);
    invalid = true;
    expect(matcher.isErrorState()).toBe(true);
  });
});
