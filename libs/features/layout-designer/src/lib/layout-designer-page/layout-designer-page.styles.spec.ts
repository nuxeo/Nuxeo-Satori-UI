import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ruleDeclarations } from '@agentic-ui/shared/testing';

/**
 * A rule is an ID or JSON, so the designer writes its fields in the code font. The field is
 * `nxs-text-field`'s textarea, in that component's own view, which the page's encapsulated styles
 * do not reach: the page sets the field's `--nxs-text-field-font-family` instead, which the field
 * reads for its control and inherits into its view.
 */
describe('LayoutDesignerPageComponent styles', () => {
  const scss = readFileSync(join(import.meta.dirname, 'layout-designer-page.scss'), 'utf8');

  it("writes a field's rules in the code font, through the text field's font property", () => {
    const rule = ruleDeclarations(scss, ['.layout-designer__rules-body nxs-text-field']);
    expect(rule, 'a `.layout-designer__rules-body nxs-text-field` rule').not.toBeNull();
    expect(rule).toMatch(/--nxs-text-field-font-family:\s*monospace\s*;/);
  });
});
