# feature-capture

The phone capture page, `/#/capture`: business apps phase 8's "phone capture app"
([development plan](../../../docs/business-apps/development-plan.md), phase 8), for demo step 5, "a
driver photographs damaged goods on a phone, and the photo is filed on the claim of the move". A
person on a phone chooses a record, takes photos with the phone's camera, looks them over, removes
any, adds a note, and files them as the record's attachments, where the record's layout says
([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 2, "Capture").

Built on 26 November 2026.

## A page of the app, not a native app

- **It needs nothing installed.** A phone's browser opens it, as it opens the app. A native app
  would need two stores' builds, signing and review, and an update for every change.
- **It is the app's own, so its rules are the app's:** its sign-in, its idle timeout, which the
  shell runs, and the server's permissions on every upload. A native app would sign in apart, and
  hold a token of its own on the phone.
- **The browser reaches the camera.** `<input type="file" accept="image/*" capture="environment">`
  opens the phone's back camera, on iOS and Android, with no permission prompt of the page's own
  and no third-party code. Barcodes are read by a scanner that types, or typed: no camera library.
- **What a native app would add,** and this does not: taking photos with no connection at all and
  filing them later, from the phone's own storage. Here a dropped connection is tried again while
  the page is open (below); closing the page with photos not filed asks first.

## What it does

1. **The record.** By its number or barcode, typed, pasted or scanned by a scanner that types and
   presses Enter: looked up in the properties every captured type's `findBy` names, as typed and in
   capitals, each a query value. By its id, or a link to its page or to this one, pasted. Or from
   the record page, whose link names it, `/#/capture?record=<id>`, for a reader the record's
   permissions let write it. Several records with the number are listed to choose from. A record
   the person may not write (`Write` or `WriteProperties`, not a version, as the Attachments panel
   asks), or whose type takes no photos, is refused before any photo is taken, saying why.
2. **The photos.** "Take a photo" opens the camera, `capture="environment"`; "Choose photos" opens
   the phone's photos, several at once. At most 20 at a filing. Anything that is not a picture is
   left out, and said to be. Each photo is made ready as it comes, one at a time, and shown from its
   own object URL, which is revoked when the photo is removed, made ready again for another
   record, or when the page is left.
3. **The note,** optional, filed after the photos as a text file beside them in the same property,
   with the names of the photos it goes with.
4. **The filing.** Each photo in turn, then the note, through
   `DocumentDetailService.uploadAttachment`, the Attachments panel's own upload: `Blob.AttachOnDocument`
   into the capture's property, saved, with each photo's progress.

## The photos' metadata (`prepare-photo.ts`, `photo-metadata.ts`)

- **Drawn down where large.** A photo longer than 3,072 pixels on a side is drawn down to it on a
  canvas, encoded as JPEG at 0.9: a 12-megapixel phone photo goes as about seven megapixels, at
  about a third of the bytes. A JPEG small enough goes as it came, its picture byte for byte.
- **Upright as its EXIF orientation says.** A photo drawn down is given to the canvas with no EXIF,
  so that no browser turns it, and turned by the page by its EXIF orientation, 1 to 8; the drawn
  photo's pixels are upright, and the EXIF it gets back says orientation 1, its new size, and no
  thumbnail. A photo sent as it came keeps its orientation tag, and the viewer turns it.
- **Where it was taken is taken out**, unless the layout says `"keepLocation": true`. From a JPEG:
  EXIF's GPS block, zeroed and unlinked; the camera maker's notes, which some makers fill with a
  location too, zeroed and unlinked; every XMP and IPTC segment; and anything after the picture's
  end, as a gain map or a depth map is, with the MPF index of it. The rest of the EXIF stays: the
  orientation, the camera, the time it was taken. EXIF that cannot be read is left out whole, its
  orientation kept in an EXIF segment of its own when that much can be read.
- **Another format,** such as a PNG, a HEIC or a WebP, whose metadata the page does not read, is
  drawn anew as a JPEG, which carries none. Kept, it goes as it came, at its size.
- **Read back before it is sent.** Unless the layout keeps the location, what the page would send
  is read again, and a photo still seen to carry a location, or that may, is refused, never sent.
- **Not looked for:** a location written into the picture itself, such as a street sign in it.

## The upload (`capture-filing.service.ts`)

- **The same API and permission as the Attachments panel.** The server checks the person's
  permission on every upload; what the page offers is no control. A 403 stops the filing, saying
  the person may not add files to the record; a 404 says the record is gone; a 413 or another
  refusal leaves that photo, with the reason, and the rest go on.
- **A dropped connection is tried again,** after 1, 4 and 10 seconds, then left to Try again. A try
  that takes three minutes is counted as dropped.
- **Never twice.** Before each try again, and before a photo a request has carried already, the
  record is read: a file of the photo's name and size there is the earlier try's, whose answer was
  lost, and is not sent again. Each photo's name is the page's own and unique, the record's number,
  the time and its number on the page, such as `DC-3003-photo-20261126-140512-1.jpg`, not the
  phone's `image.jpg`. When the record cannot be read either, the photo is sent again, and that try
  tells: a photo could then be filed twice, if its first answer was lost and the read failed.

## Accessibility

Built on the `nxs-` controls (`nxs-button`, `nxs-icon-button`, `nxs-text-field`), and held to them:
the library is in `NXS_CONTROL_FEATURES` (`scripts/review-guardrails.mjs`). One column, which does
not scroll sideways at 320 CSS pixels. Every control is named; each photo's picture is named for its
place in the list; the page tells a screen reader what it found, added, removed and filed, politely,
and moves the focus to the record once one is chosen and to the result once a filing ends. The specs
run axe-core, WCAG 2.2 A and AA, in each state, contrast left to the browser run, which runs axe on
the page in a browser.

## Its tests

- `photo-metadata.spec.ts`, `prepare-photo.spec.ts`: JPEGs made byte by byte, in either byte order,
  with a GPS block, the maker's notes, XMP, IPTC, MPF, an ICC profile and a gain map; each place a
  location is carried taken out, the rest kept, the picture byte for byte, the eight orientations,
  the drawing down, and a canvas that wrote a location refused.
- `capture-photos.spec.ts`: adding, refusing, removing, preparing again and leaving, each object URL
  revoked.
- `capture-filing.service.spec.ts`, `capture-records.service.spec.ts`: the upload, its progress,
  retry, a lost answer found, refusals, and the lookup's query values.
- `capture-page/capture-page.spec.ts`: choosing a record, the photos, the filing and its failures,
  the refusals, leaving, and axe.
- `scripts/beta-harness/steps/capture-phone.mjs`: the page in a browser at 320 pixels against a
  stand-in of the server, with the moves kit's layout and model, through a lost answer and a dropped
  connection, the photos sent read back.
