/**
 * NXSAT-727 — a picked date is saved as local midnight, so the layout row shows the day before.
 *
 * The browser's time zone comes from the `TZ` of the process that launches the runner — Chromium
 * inherits it, verified: `TZ=Asia/Calcutta` gives `new Date(2024,2,6).toISOString()` of
 * `2024-03-05T18:30:00.000Z`, the exact value the ticket reports. So one scenes file captures
 * either hemisphere, and the capture is run twice:
 *
 *   TZ=Asia/Calcutta    … evidence:collect -- NXSAT-727       (ahead of UTC — the reported defect)
 *   TZ=America/New_York … evidence:collect -- NXSAT-727-west  (behind UTC — must not regress)
 *
 * Precondition: `dc:expired` on NUXEO_DOC_UID is reset to BASELINE before each run, so both halves
 * start from the same stored value and the comparison is of the fix, not of leftover state.
 */

/** The day the user picks, typed into the field, and what it must be stored as. */
const PICK_TEXT = '03/06/2024';
const PICK_LONG = 'March 6, 2024';
const EXPECTED_WIRE = '2024-03-06T00:00:00.000Z';
/** A deliberately different day, so "it already said March 6" can never be the reason a check passes. */
const BASELINE_WIRE = '2023-11-02T00:00:00.000Z';

const LAYOUT_VALUE = '[data-field="dc:expired"] .document-layout__value';
const DIALOG = 'mat-dialog-container';
const DATE_FIELD = `${DIALOG} nxs-date-input input`;

/** The native Properties row for `dc:expired`: the `dd` after the `dt` labelled "Expires". */
async function nativeExpires(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('nxs-properties-panel');
    if (!panel) return '';
    for (const dt of panel.querySelectorAll('dt')) {
      if (dt.closest('lib-document-layout')) continue;
      if (dt.innerText.trim().toLowerCase().startsWith('expires')) {
        return (dt.nextElementSibling?.innerText ?? '').trim();
      }
    }
    return '';
  });
}

export const summary =
  'A date picked in the Edit dialog is saved as local midnight, so the layout row in the ' +
  'Properties panel shows the previous day for users in a zone ahead of UTC';

export const scenes = [
  {
    act: 1,
    title: 'Open the File and find the two rows that show the same date field',
    intent:
      'A user about to set an expiry date. The Properties panel shows dc:expired twice — the ' +
      'native Expires row and a contributed layout row — which is how the disagreement is visible',
    criterion: 'AC-3',
    async run(page, h) {
      await h.login();
      await h.goToDoc(process.env['NUXEO_DOC_UID']);
      // withHashLocation() makes the goto above same-document, so APP_INITIALIZER — which loads
      // the layout contribution — would not have run without this.
      await page.reload({ waitUntil: 'domcontentloaded' });

      await h.expectVisible('the Properties panel renders', 'nxs-properties-panel');
      await h.expectVisible('the contributed layout row renders', LAYOUT_VALUE);

      const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      h.note(`browser time zone for this capture: ${zone}`);

      const layout = (await page.locator(LAYOUT_VALUE).first().innerText()).trim();
      const native = await nativeExpires(page);
      h.requirePrecondition(
        'the stored date starts at the baseline, not at the day about to be picked',
        !layout.includes(PICK_LONG) && !native.includes(PICK_LONG),
        `layout row "${layout}", native row "${native}" — baseline is ${BASELINE_WIRE}`,
      );

      await h.shot('01-both-rows-before-edit', {
        highlight: LAYOUT_VALUE,
        label: 'Layout row for dc:expired',
      });
    },
  },

  {
    act: 2,
    title: `Pick ${PICK_TEXT} in Expires, save, and read the value that went on the wire`,
    intent:
      'The instant the form sends for the picked day. A calendar day must be the same instant ' +
      'in every zone, which is what makes every row able to agree about it',
    criterion: 'AC-1',
    hold: 2500,
    async run(page, h) {
      await page.locator('button[aria-label*="Edit" i]').first().click();
      await h.expectVisible('the Edit dialog opens', DIALOG);
      await h.expectVisible('the Expires date field is in the dialog', DATE_FIELD);

      const field = page.locator(DATE_FIELD).first();
      await field.click();
      await field.fill('');
      await field.fill(PICK_TEXT);
      await field.blur();

      // Registered before the click: the PUT is the only record of what the form decided.
      //
      // Swallowed deliberately. The only way this rejects is the timeout, and "no PUT arrived" is
      // not an error to report here — it is a result, carried as `null` and turned into a named
      // failing check below. Letting it throw would abort the scene with a Playwright stack trace
      // in place of the assertion the reviewer needs to read.
      const saved = page
        .waitForRequest((r) => r.method() === 'PUT' && /\/api\/v1\/id\//.test(r.url()), {
          timeout: 15000,
        })
        // Only rejects on the timeout, i.e. "no PUT arrived" — a result, not an error.
        .catch(() => null);
      await page.locator(`${DIALOG} button:has-text("Save")`).first().click();
      const request = await saved;

      let wire = '(no PUT seen)';
      if (request) {
        try {
          wire = JSON.parse(request.postData() ?? '{}')?.properties?.['dc:expired'] ?? '(absent)';
        } catch {
          wire = '(unparseable body)';
        }
      }
      h.check(
        `the picked day is sent as that day at UTC midnight (${EXPECTED_WIRE})`,
        wire === EXPECTED_WIRE,
        `dc:expired sent as ${wire}`,
      );

      await page.waitForTimeout(2500);
      await h.shot('02-saved', { highlight: 'nxs-properties-panel', label: 'Properties panel' });
    },
  },

  {
    act: 3,
    title: 'Read both rows, and re-open the dialog',
    intent:
      'The day the user picked must be the day every row shows, and the day the form shows when ' +
      'it is opened again',
    criterion: 'AC-2',
    hold: 3500,
    spotlight: { selector: LAYOUT_VALUE, label: 'Layout row for dc:expired' },
    async run(page, h) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.expectVisible('the layout row renders after the save', LAYOUT_VALUE);

      const layout = (await page.locator(LAYOUT_VALUE).first().innerText()).trim();
      const native = await nativeExpires(page);

      h.check(
        `the layout row shows the picked day (${PICK_LONG})`,
        layout.includes(PICK_LONG),
        `layout row reads "${layout}"`,
      );
      h.check(
        `the native Properties row shows the picked day (${PICK_LONG})`,
        native.includes(PICK_LONG),
        `native row reads "${native}"`,
      );
      h.check(
        'the two rows in the same panel agree',
        layout.trim() === native.trim(),
        `layout "${layout}" vs native "${native}"`,
      );

      await h.shot('03-both-rows-after-save', { highlight: LAYOUT_VALUE, label: 'Layout row' });

      // AC-4: the value round-trips back into the form it was picked in.
      await page.locator('button[aria-label*="Edit" i]').first().click();
      await h.expectVisible('the Edit dialog opens again', DATE_FIELD);
      const shown = await page.locator(DATE_FIELD).first().inputValue();
      h.check(
        `re-opening the dialog shows the day that was saved (${PICK_TEXT})`,
        shown.trim() === PICK_TEXT,
        `the field reads "${shown}"`,
      );
      await h.shot('04-reopened-dialog', { highlight: DATE_FIELD, label: 'Expires field' });
      await page.locator(`${DIALOG} button:has-text("Cancel")`).first().click();

      h.note(
        'A layout-added field from a custom schema (qa:d in the ticket) is not seeded here; it ' +
          'is covered by unit tests, and shares the single serialisation boundary this fix changes.',
      );
      // /nuxeo/logout 404s on the dev server regardless of this fix — pre-existing, unrelated.
      await h.expectNoConsoleErrors('no console errors beyond the dev-server logout probe', [
        '/nuxeo/logout',
      ]);
    },
  },
];
