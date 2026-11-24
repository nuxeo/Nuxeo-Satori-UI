import type { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';

import { DocumentCompareDialogComponent } from './document-compare-dialog.component';
import { openDocumentCompareDialog } from './open-document-compare-dialog';

/** Bulk "Compare" calls this with the selection. */
describe('openDocumentCompareDialog', () => {
  const dialogWith = () => {
    const open = vi.fn();
    return { dialog: { open } as unknown as MatDialog, open };
  };

  it('opens the compare dialog over the selected documents', () => {
    const { dialog, open } = dialogWith();
    const items = [
      { id: 'd1', name: 'Contract v1' },
      { id: 'd2', name: 'Contract v2' },
      { id: 'd3', name: 'Contract v3' },
    ];

    openDocumentCompareDialog(dialog, items);

    expect(open).toHaveBeenCalledTimes(1);
    const [component, config] = open.mock.calls[0];
    expect(component).toBe(DocumentCompareDialogComponent);
    expect(config.data).toEqual({ items });
  });

  it('opens it wide, but inside the window, so two columns of metadata fit', () => {
    const { dialog, open } = dialogWith();

    openDocumentCompareDialog(dialog, [
      { id: 'd1', name: 'a' },
      { id: 'd2', name: 'b' },
    ]);

    expect(open.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        width: '1400px',
        maxWidth: '96vw',
        maxHeight: '92vh',
        panelClass: 'document-compare-dialog-panel',
      }),
    );
  });

  it.each([[[]], [[{ id: 'd1', name: 'a' }]]])(
    'opens nothing with fewer than two documents (%j), as there is nothing to compare',
    (items) => {
      const { dialog, open } = dialogWith();

      openDocumentCompareDialog(dialog, items);

      expect(open).not.toHaveBeenCalled();
    },
  );
});
