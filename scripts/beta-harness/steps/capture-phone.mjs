/**
 * The phone capture page, `/#/capture`, on a phone's screen: business apps phase 8's demo step 5,
 * "a driver photographs damaged goods on a phone, and the photo is filed on the claim of the move"
 * (docs/business-apps/development-plan.md, phase 8), on the moves kit's damage claim, whose layout
 * turns capture on (`business-apps/packages/moves-demo`, version 0.3.0 or later).
 *
 * **Against a stand-in server, not the local Nuxeo** (`capture-phone/stand-in.mjs`). Every request
 * the browser sends to `/nuxeo/` or to the development server's `/agentic-ui-config/` is answered
 * inside the browser by `page.route`, so nothing reaches a server and nothing is written to one.
 * The kit is not installed on the local server, and filing a photo is a write, which the local
 * server is not to take. The stand-in serves the kit's own layout file and model, and keeps each
 * upload on its claim as `Blob.AttachOnDocument` would. So this proves what the page does and
 * sends, not what a server does with it: the server's permission check and the stored file are a
 * server run's, which this is not.
 *
 * The steps, at 320 by 720 CSS pixels, the narrowest phone:
 *
 *   1. **The record by its move's number,** typed as a phone's keyboard capitalises it, and
 *      submitted with Enter, as a scanner that types does: the claim of the move is chosen.
 *   2. **Photos:** one from the camera, through the button that opens the file input with
 *      `capture="environment"`, a large one stored on its side (EXIF orientation 6) with a GPS
 *      block, an XMP packet naming the place, and a second picture after its end; one from the
 *      gallery, small, with the same metadata; a file that is not a picture, left out; and a photo
 *      added and removed, its preview's object URL revoked.
 *   3. **The filing,** with a note: the first photo's answer is lost after the server kept it, and
 *      the page finds it on the claim and does not send it again; the second photo's connection
 *      drops before the server has it, and the page sends it again. Read back from what the page
 *      sent: each photo once, the large one drawn down to 3072 pixels and upright, its top right
 *      corner the stored top left's colour, neither with a location, the small one's picture byte
 *      for byte; and the note, beside them.
 *   4. **Refusals:** a claim the driver may only read offers no photo control and says why; a claim
 *      whose server refuses the upload, 403, says so and stops, sending nothing more.
 *   5. **Accessibility:** axe, WCAG 2.2 AA, on the page in each of its states; no sideways scroll
 *      at 320 pixels; every control named.
 *
 * Load-bearing checks: the claim chosen by the move's number, with the number a query value; the
 * camera button opening a file input with `capture="environment"` that takes images; the upload
 * request, `Blob.AttachOnDocument` with `files:files` and the claim's id; the large photo's size,
 * orientation and corner; no GPS block, XMP, place name, latitude or trailing data in either photo;
 * the small photo's scan unchanged; the lost answer found and not sent twice; the dropped one sent
 * again, once kept; the note's text; the object URL revoked; the refusals. Negative ones: the file
 * that is not a picture left out; the read-only claim's missing controls; the 403 tried once; no
 * request the stand-in does not know.
 *
 * Not covered, and said in notes: a real phone's camera (the browser's file input is given the
 * photos, as the camera would give them); a real server's permission check and what it stores; the
 * record page's link to this page, which `record-page.spec.ts` holds.
 *
 *   APP_URL=http://localhost:4200 npm run beta:evidence -- capture-phone
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LATITUDE,
  PLACE,
  exifSegment,
  readPhoto,
  withMetadata,
  xmpSegment,
} from './capture-phone/photos.mjs';
import { CLAIMS, DRIVER, installStandIn } from './capture-phone/stand-in.mjs';

/** The stand-in answers every request, so the run needs no credentials and sends none. */
export const skipHttpCredentials = true;

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/**
 * The kit whose layout and model the stand-in serves. Named through a constant: a release
 * candidate's server run lists a kit's demos to run against a server, and this one runs on none.
 */
const KIT_NAME = 'moves-demo';
const KIT = join(REPO, 'business-apps', 'packages', KIT_NAME);
const SESSION_KEY = 'agentic_ui_nuxeo_session';
const PHONE = { width: 320, height: 720 };
/** The longest side the page uploads a photo at (`CAPTURE_MAX_EDGE`). */
const MAX_EDGE = 3072;
const NOTE = 'Deep scratch across the top, left corner chipped. Customer present.';

/** The red the stored top left of the large photo is drawn in, and the green of the rest. */
const RED = [198, 40, 40];
const GREEN = [46, 125, 50];

/**
 * A JPEG the browser draws: green, with its top left quarter red.
 *
 * @param {import('@playwright/test').Page} page
 */
async function drawnJpeg(page, width, height) {
  const base64 = await page.evaluate(
    async ({ width, height, red, green }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = `rgb(${green.join(',')})`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = `rgb(${red.join(',')})`;
      context.fillRect(0, 0, width / 2, height / 2);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { width, height, red: RED, green: GREEN },
  );
  return Buffer.from(base64, 'base64');
}

/** The colours at the middle of a JPEG's top left and top right quarters, as the browser decodes it. */
async function corners(page, bytes) {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return {
      width: bitmap.width,
      height: bitmap.height,
      topLeft: at(Math.floor(bitmap.width / 4), Math.floor(bitmap.height / 4)),
      topRight: at(Math.floor((bitmap.width * 3) / 4), Math.floor(bitmap.height / 4)),
    };
  }, bytes.toString('base64'));
}

const near = (colour, wanted) =>
  colour.every((value, index) => Math.abs(value - wanted[index]) <= 24);

/** The scan of a JPEG, from its start of scan marker to its end: its picture, as coded. */
function scanOf(jpeg) {
  const start = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  const end = jpeg.indexOf(Buffer.from([0xff, 0xd9]), start);
  return start < 0 || end < 0 ? Buffer.alloc(0) : jpeg.subarray(start, end + 2);
}

/** The harness's axe, which `npm install --no-save @playwright/test @axe-core/playwright` installs. */
const AxeBuilder = await import('@axe-core/playwright').then(
  (axe) => axe.default,
  () => null,
);

/**
 * WCAG 2.2 AA on the capture page alone, the shell's own surfaces left to their own runs: every
 * violation, of any impact, fails.
 */
async function axe(page, h, name) {
  const results = await new AxeBuilder({ page })
    .include('lib-capture-page')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return h.check(
    name,
    results.violations.length === 0 && results.passes.length > 0,
    results.violations.length === 0
      ? `${results.passes.length} rules passed`
      : results.violations
          .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`)
          .join('; '),
  );
}

async function noSidewaysScroll(page) {
  return page.evaluate(() => {
    const capture = document.querySelector('lib-capture-page');
    return (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      !!capture &&
      capture.scrollWidth <= capture.clientWidth + 1
    );
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Set up: a phone, signed in, and the stand-in server');
  h.requirePrecondition(
    '@axe-core/playwright is installed, for the WCAG 2.2 AA checks',
    AxeBuilder !== null,
    'npm install --no-save @playwright/test @axe-core/playwright',
  );
  await page.setViewportSize(PHONE);
  /** How many times each file name was sent, to decide each try's fate. */
  const tries = new Map();
  let firstPhoto = null;
  let secondPhoto = null;
  const standIn = await installStandIn(page, {
    kit: KIT,
    upload: (_claim, upload) => {
      const name = upload.filename;
      const count = (tries.get(name) ?? 0) + 1;
      tries.set(name, count);
      if (name.endsWith('.txt')) return 'store';
      firstPhoto ??= name;
      if (name === firstPhoto) return count === 1 ? 'store-then-drop' : 'store';
      secondPhoto ??= name;
      if (name === secondPhoto) return count === 1 ? 'drop' : 'store';
      return 'store';
    },
  });
  await page.addInitScript(
    ({ key, user }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          kind: 'basic',
          username: user,
          basic: btoa(`${user}:stand-in`),
          isAdministrator: false,
          groups: [],
        }),
      );
    },
    { key: SESSION_KEY, user: DRIVER },
  );
  await h.goTo('/#/capture');
  await page
    .waitForSelector('lib-capture-page form[role="search"]', { timeout: 30_000 })
    .catch(() => undefined);
  h.check(
    'the capture page opens at 320 pixels, signed in, with its find form',
    page.url().includes('#/capture') &&
      (await page.locator('lib-capture-page form[role="search"]').count()) === 1,
    page.url(),
  );
  h.check('the page does not scroll sideways at 320 pixels', await noSidewaysScroll(page));
  await axe(page, h, 'axe, WCAG 2.2 AA: the find form');
  await h.screenshot('find-form-320');

  await h.step('1. The claim of the move, by the move number typed and submitted with Enter');
  const field = page.getByRole('textbox', { name: 'Number, barcode or link' });
  await field.click();
  await page.keyboard.type('mv-2003');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-capture-record]', { timeout: 30_000 }).catch(() => undefined);
  const lookup = standIn.log.find((entry) => entry.lookup)?.lookup;
  h.check(
    'the number is looked up as query values, as typed and in capitals, never in the query text',
    !!lookup &&
      lookup.values.includes('mv-2003') &&
      lookup.values.includes('MV-2003') &&
      !/mv-2003/i.test(lookup.query) &&
      /dmg:moveNumber IN \(\?, \?\)/.test(lookup.query) &&
      /dmg:number IN \(\?, \?\)/.test(lookup.query),
    JSON.stringify(lookup),
  );
  h.check(
    "the move's claim is chosen, and the address names it",
    page.url().includes(`record=${CLAIMS.writable.uid}`) &&
      ((await page.locator('[data-capture-record]').textContent()) ?? '').includes(
        CLAIMS.writable.number,
      ),
    page.url(),
  );
  h.check(
    'the focus moves to the record, so that a screen reader goes on from there',
    await page.evaluate(
      () => document.activeElement?.hasAttribute('data-capture-record-heading') ?? false,
    ),
  );
  await h.expectText(
    'the page says the place each photo was taken is removed',
    '[data-capture-location]',
    'removed from it before it is sent',
  );
  await h.screenshot('claim-of-the-move');

  await h.step('2. Photos: the camera, the gallery, a file that is no picture, one removed');
  const large = withMetadata(
    await drawnJpeg(page, 4000, 3000),
    [exifSegment({ orientation: 6, width: 4000, height: 3000 }), xmpSegment()],
    Buffer.from('second picture after the end, with its own metadata'),
  );
  const small = withMetadata(
    await drawnJpeg(page, 1200, 900),
    [exifSegment({ orientation: 1, width: 1200, height: 900 }), xmpSegment()],
    Buffer.from('a depth map'),
  );
  const before = readPhoto(large);
  h.check(
    'the photos given carry a location: a GPS block, XMP naming the place, data after the end',
    before.gps &&
      before.xmp &&
      before.placeNamed &&
      before.latitudeBytes &&
      before.trailing &&
      before.orientation === 6,
    JSON.stringify(before),
  );
  const [camera] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Take a photo' }).click(),
  ]);
  const cameraInput = await camera.element().evaluate((input) => ({
    capture: input.getAttribute('capture'),
    accept: input.getAttribute('accept'),
    multiple: input.multiple,
  }));
  h.check(
    'Take a photo opens the file input that asks for the camera: capture="environment", images',
    cameraInput.capture === 'environment' &&
      cameraInput.accept === 'image/*' &&
      !cameraInput.multiple,
    JSON.stringify(cameraInput),
  );
  await camera.setFiles({ name: 'image.jpg', mimeType: 'image/jpeg', buffer: large });
  const [gallery] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Choose photos' }).click(),
  ]);
  await gallery.setFiles([
    { name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: small },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') },
  ]);
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-capture-photo][data-state="ready"]').length === 2,
      null,
      {
        timeout: 60_000,
      },
    )
    .catch(() => undefined);
  h.check(
    'the two photos are ready, and the file that is no picture is left out, and said to be',
    (await page.locator('[data-capture-photo][data-state="ready"]').count()) === 2 &&
      (await page.locator('[data-capture-photo]').count()) === 2 &&
      (
        (await page.locator('lib-capture-page [role="status"]').first().textContent()) ?? ''
      ).includes('Only pictures'),
  );
  h.check(
    'each photo is drawn from its own object URL, and named for a screen reader',
    (await page.getByRole('img', { name: 'Photo 1' }).getAttribute('src'))?.startsWith('blob:') ===
      true &&
      (await page.getByRole('img', { name: 'Photo 2' }).getAttribute('src'))?.startsWith(
        'blob:',
      ) === true,
  );
  // A third photo, then removed: its preview's object URL must be revoked.
  const [extra] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Choose photos' }).click(),
  ]);
  await extra.setFiles({ name: 'IMG_0043.jpg', mimeType: 'image/jpeg', buffer: small });
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-capture-photo][data-state="ready"]').length === 3,
      null,
      {
        timeout: 60_000,
      },
    )
    .catch(() => undefined);
  const third = await page.getByRole('img', { name: 'Photo 3' }).getAttribute('src');
  const aliveBefore = await page.evaluate(
    (url) =>
      fetch(url).then(
        () => true,
        () => false,
      ),
    third,
  );
  await page.getByRole('button', { name: 'Remove photo 3' }).click();
  await page.waitForTimeout(300);
  const aliveAfter = await page.evaluate(
    (url) =>
      fetch(url).then(
        () => true,
        () => false,
      ),
    third,
  );
  h.check(
    "Remove photo 3 takes it out, and revokes its preview's object URL",
    aliveBefore && !aliveAfter && (await page.locator('[data-capture-photo]').count()) === 2,
    `before ${aliveBefore}, after ${aliveAfter}`,
  );
  h.check(
    'the page still does not scroll sideways with photos listed',
    await noSidewaysScroll(page),
  );
  await axe(page, h, 'axe, WCAG 2.2 AA: photos listed');
  await h.screenshot('photos-ready');

  await h.step('3. The filing, with a note, through a lost answer and a dropped connection');
  await page.getByRole('textbox', { name: 'Note (optional)' }).fill(NOTE);
  await page.getByRole('button', { name: 'File the photos' }).click();
  await page.waitForSelector('[data-capture-done]', { timeout: 90_000 }).catch(() => undefined);
  const uploads = standIn.log.filter((entry) => entry.upload);
  const sent = (name) => uploads.filter((entry) => entry.upload.filename === name);
  h.check(
    "each upload is the Attachments panel's: Blob.AttachOnDocument, into files:files, on the claim, saved",
    uploads.length > 0 &&
      uploads.every(
        (entry) =>
          entry.upload.params.document === CLAIMS.writable.uid &&
          entry.upload.params.xpath === 'files:files' &&
          String(entry.upload.params.save) === 'true',
      ),
    JSON.stringify(uploads.map((entry) => entry.upload.params)),
  );
  const kept = standIn.files.get(CLAIMS.writable.uid);
  h.check(
    'the photo whose answer was lost is found on the claim, and not sent again',
    !!firstPhoto &&
      sent(firstPhoto).length === 1 &&
      kept.filter((file) => file.name === firstPhoto).length === 1,
    `${firstPhoto}: sent ${firstPhoto ? sent(firstPhoto).length : 0}`,
  );
  h.check(
    'the photo whose connection dropped is sent again, and kept once',
    !!secondPhoto &&
      sent(secondPhoto).length === 2 &&
      kept.filter((file) => file.name === secondPhoto).length === 1,
    `${secondPhoto}: sent ${secondPhoto ? sent(secondPhoto).length : 0}`,
  );
  h.check(
    'the photos are named for the claim, uniquely, and not "image.jpg"',
    !!firstPhoto &&
      !!secondPhoto &&
      firstPhoto !== secondPhoto &&
      /^DC-3003-photo-\d{8}-\d{6}-\d+\.jpg$/.test(firstPhoto) &&
      /^DC-3003-photo-\d{8}-\d{6}-\d+\.jpg$/.test(secondPhoto),
    `${firstPhoto}, ${secondPhoto}`,
  );
  const largeSent = sent(firstPhoto ?? '')[0]?.upload.bytes ?? Buffer.alloc(0);
  const smallSent = sent(secondPhoto ?? '').at(-1)?.upload.bytes ?? Buffer.alloc(0);
  const largeFacts = readPhoto(largeSent);
  const smallFacts = readPhoto(smallSent);
  h.check(
    'the large photo is drawn down to 3072 pixels upright, 2304 by 3072, its EXIF orientation 1',
    largeFacts.jpeg &&
      largeFacts.width === 2304 &&
      largeFacts.height === MAX_EDGE &&
      largeFacts.orientation === 1,
    JSON.stringify(largeFacts),
  );
  const seen = largeSent.length > 0 ? await corners(page, largeSent) : null;
  h.check(
    "upright as its EXIF said: the stored top left's red is now the top right, the top left green",
    !!seen && near(seen.topRight, RED) && near(seen.topLeft, GREEN),
    JSON.stringify(seen),
  );
  h.check(
    'neither photo carries a location: no GPS block, XMP, place name, latitude or data after the end',
    [largeFacts, smallFacts].every(
      (facts) =>
        facts.jpeg &&
        !facts.gps &&
        !facts.xmp &&
        !facts.iptc &&
        !facts.placeNamed &&
        !facts.latitudeBytes &&
        !facts.trailing,
    ),
    JSON.stringify({ large: largeFacts, small: smallFacts, latitude: LATITUDE, place: PLACE }),
  );
  h.check(
    'the small photo keeps its size and its picture byte for byte, and its EXIF with it',
    smallFacts.width === 1200 &&
      smallFacts.height === 900 &&
      smallFacts.orientation === 1 &&
      smallFacts.exifSegments === 1 &&
      scanOf(smallSent).equals(scanOf(small)),
    JSON.stringify(smallFacts),
  );
  const note = uploads.find((entry) => entry.upload.filename?.endsWith('.txt'))?.upload;
  h.check(
    'the note is filed beside them, as a text file holding it and the photos it goes with',
    !!note &&
      /^DC-3003-note-\d{8}-\d{6}\.txt$/.test(note.filename) &&
      note.bytes.toString('utf8').startsWith(NOTE) &&
      note.bytes.toString('utf8').includes(firstPhoto ?? '\u0000') &&
      kept.length === 3,
    note ? `${note.filename}: ${note.bytes.toString('utf8')}` : 'no note sent',
  );
  await h.expectText(
    'the page says the photos and the note are filed',
    '[data-capture-done]',
    'Photos filed on the record: 2, with the note.',
  );
  h.check(
    'the focus moves to the result, so that a screen reader hears it',
    await page.evaluate(() => document.activeElement?.hasAttribute('data-capture-result') ?? false),
  );
  await axe(page, h, 'axe, WCAG 2.2 AA: filed');
  await h.screenshot('photos-filed');

  await h.step('4. Refusals: a claim the driver may only read, and an upload the server refuses');
  await page.getByRole('button', { name: 'Take more photos' }).click();
  await page.getByRole('button', { name: 'Choose another record' }).click();
  await page.getByRole('textbox', { name: 'Number, barcode or link' }).fill(CLAIMS.readOnly.number);
  await page.getByRole('button', { name: 'Find' }).click();
  await page
    .waitForSelector('[data-capture-refusal="read-only"]', { timeout: 30_000 })
    .catch(() => undefined);
  h.check(
    'a claim the driver may only read says so, and offers no photo control',
    (await page.locator('[data-capture-refusal="read-only"]').count()) === 1 &&
      (await page.getByRole('button', { name: 'Take a photo' }).count()) === 0 &&
      (await page.getByRole('button', { name: 'File the photos' }).count()) === 0,
  );
  await axe(page, h, 'axe, WCAG 2.2 AA: a claim the driver may only read');
  await h.screenshot('read-only-claim');

  await page.getByRole('button', { name: 'Choose another record' }).click();
  await page.getByRole('textbox', { name: 'Number, barcode or link' }).fill(CLAIMS.refused.number);
  await page.getByRole('button', { name: 'Find' }).click();
  await page.waitForSelector('[data-capture-record]', { timeout: 30_000 }).catch(() => undefined);
  const [again] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Choose photos' }).click(),
  ]);
  await again.setFiles({ name: 'IMG_0044.jpg', mimeType: 'image/jpeg', buffer: small });
  await page
    .waitForSelector('[data-capture-photo][data-state="ready"]', { timeout: 60_000 })
    .catch(() => undefined);
  await page.getByRole('button', { name: 'File the photos' }).click();
  await page
    .waitForSelector('[data-capture-stopped="forbidden"]', { timeout: 30_000 })
    .catch(() => undefined);
  const refusedTries = standIn.log.filter(
    (entry) => entry.upload?.params.document === CLAIMS.refused.uid,
  );
  h.check(
    'a 403 on the upload says the driver may not add files, is tried once, and keeps nothing',
    (await page.locator('[data-capture-stopped="forbidden"]').count()) === 1 &&
      refusedTries.length === 1 &&
      standIn.files.get(CLAIMS.refused.uid).length === 0 &&
      (await page.locator('[data-capture-photo][data-state="failed"]').count()) === 1,
    `${refusedTries.length} upload(s)`,
  );
  await axe(page, h, 'axe, WCAG 2.2 AA: an upload refused');
  await h.screenshot('upload-refused');

  await h.step('Health');
  const unknown = standIn.log.filter((entry) => !entry.known);
  h.check(
    'the page asked the stand-in for nothing it does not know',
    unknown.length === 0,
    unknown.map((entry) => `${entry.method} ${entry.path}`).join(', '),
  );
  // The one error the run asks for: step 4's 403, which the browser reports as a failed request.
  h.expectNoConsoleErrors('no browser console errors but the 403 step 4 asks for', [
    'HTTP 403 /nuxeo/api/v1/automation/Blob.AttachOnDocument',
  ]);
  h.note('a real phone camera: the file input is given the photos, as the camera would give them');
  h.note(
    "a server's permission check and what it stores: the stand-in keeps the uploads, and refuses one as told",
  );
  h.note("the record page's link to this page, which record-page.spec.ts holds");
}
