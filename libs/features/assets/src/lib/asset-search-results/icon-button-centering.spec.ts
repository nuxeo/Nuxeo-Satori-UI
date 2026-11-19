/**
 * NXSAT-809 — Manage columns is a Material icon button resized from 40px to 32px. Its 8px of
 * padding, sized for the 40px button, left the icon 4px low and 4px right of the centre; the rule
 * must centre it. See `libs/features/browse/.../icon-button-centering.spec.ts` for the cause.
 */
import { iconCentringProblems, ruleDeclarations } from '@agentic-ui/shared/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Assets icon buttons centre their icon (NXSAT-809)', () => {
  it('Manage columns (.gear-btn)', () => {
    const scss = readFileSync(
      join(import.meta.dirname, 'asset-search-results.component.scss'),
      'utf8',
    );
    const rule = ruleDeclarations(scss, ['.gear-btn']);
    expect(rule, 'a `.gear-btn` rule in asset-search-results.component.scss').not.toBeNull();
    expect(iconCentringProblems(rule ?? ''), '`.gear-btn` is missing').toEqual([]);
  });
});
