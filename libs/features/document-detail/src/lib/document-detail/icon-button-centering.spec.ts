/**
 * NXSAT-809 — the attachment action buttons (preview, download, more, open in Nuxeo Drive) are
 * Material icon buttons resized from 40px to 30px. Their 8px of padding, sized for the 40px
 * button, left each icon 5px low and 2px right of the centre; the rule must centre it. See
 * `libs/features/browse/.../icon-button-centering.spec.ts` for the cause.
 */
import { iconCentringProblems, ruleDeclarations } from '@agentic-ui/shared/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Document detail icon buttons centre their icon (NXSAT-809)', () => {
  it('attachment actions (.attachment-actions button)', () => {
    const scss = readFileSync(join(import.meta.dirname, 'document-detail.scss'), 'utf8');
    const rule = ruleDeclarations(scss, ['.attachment-actions', 'button']);
    expect(rule, 'a `.attachment-actions button` rule in document-detail.scss').not.toBeNull();
    expect(iconCentringProblems(rule ?? ''), '`.attachment-actions button` is missing').toEqual([]);
  });
});
