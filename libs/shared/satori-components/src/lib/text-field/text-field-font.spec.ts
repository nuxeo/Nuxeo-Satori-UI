/**
 * The control's font follows `--nxs-text-field-font-family`, whatever order the page added its
 * stylesheets in.
 *
 * Source-level: jsdom applies no component stylesheet. Material sets `font: inherit` on the control
 * with `.mat-mdc-form-field-input-control.mat-mdc-form-field-input-control`, two classes. A rule of
 * one class, plus the encapsulation attribute, tied it, so the stylesheet added last won: in the
 * built Storybook the `Multiline` story's textarea computed `Roboto, Arial, sans-serif` with its host
 * asking for `monospace`. Doubled, the rule outranks Material's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NxsTextFieldComponent — the control font', () => {
  const scss = readFileSync(join(import.meta.dirname, 'text-field.component.scss'), 'utf8').replace(
    /\/\/[^\n]*/g,
    '',
  );

  it('reads --nxs-text-field-font-family with a rule that outranks Material’s own', () => {
    const rules = [...scss.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) =>
        /font-family:\s*var\(--nxs-text-field-font-family, inherit\)/.test(body),
      )
      .map(([, selector]) => selector.trim());
    expect(rules).toEqual(['.nxs-text-field__control.nxs-text-field__control']);
  });
});
