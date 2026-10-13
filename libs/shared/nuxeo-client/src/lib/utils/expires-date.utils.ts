/**
 * Validate the date parsed by the field's active adapter, without a second date parser.
 * Non-empty text needs a valid Date: Material turns a failed parse into a null model,
 * which must not be mistaken for an intentional clear or allowed through a save guard.
 */
export function isExpiresFieldValid(expiresRawText: string, expires: Date | null): boolean {
  if (expires) return !Number.isNaN(expires.getTime());
  return expiresRawText.trim().length === 0;
}

/** Whether to show the Expires validation message (non-empty invalid input). */
export function shouldShowExpiresFieldError(expiresRawText: string, expires: Date | null): boolean {
  return !isExpiresFieldValid(expiresRawText, expires);
}

/** Shows Expires validation errors immediately on input (not only after blur). */
export function createExpiresErrorStateMatcher(isInvalid: () => boolean): {
  isErrorState: () => boolean;
} {
  return {
    isErrorState: () => isInvalid(),
  };
}
