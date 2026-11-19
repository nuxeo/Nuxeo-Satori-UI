/**
 * NXSAT-809 — Manage columns is a Material icon button resized from 40px to 32px. A 40px one is a
 * 24px icon with 8px of padding on each side; resized with the padding left in place and nothing
 * to centre the icon, it sat 4px low and 4px right of the button's centre. The rule must centre
 * it. (The document viewer's buttons are measured in a real browser by
 * `apps/nuxeo-ui/.../document-viewer-icon-button-centering.spec.ts`.)
 */
import { iconCentringProblems, ruleDeclarations } from '@agentic-ui/shared/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Browse icon buttons centre their icon (NXSAT-809)', () => {
  it('Manage columns (.gear-btn)', () => {
    const scss = readFileSync(join(import.meta.dirname, 'browse.scss'), 'utf8');
    const rule = ruleDeclarations(scss, ['.gear-btn']);
    expect(rule, 'a `.gear-btn` rule in browse.scss').not.toBeNull();
    expect(iconCentringProblems(rule ?? ''), '`.gear-btn` is missing').toEqual([]);
  });
});
