# Media rights (demo)

The media kit, version 0.2.0 ([development plan](../../../docs/business-apps/development-plan.md),
phase 9, "Media rights, records at scale", its builds' "Media rights and distribution: territories,
release windows, localised versions, delivery packages, watermarks", and its demo step 1: "A
localised film delivered to a distributor inside its window, and refused outside it"). It is the app
of the media rights of the assets add-on,
[`nuxeo-agentic-assets`](../../../nuxeo-agentic-assets/README.md#media-rights-territories-windows-and-deliveries)
0.5.0, and, from 0.2.0, of its watermarks: a delivery's key art marked for its distributor, and a
still from the film marked for an outside partner. All its data is fictional: no real studio, distributor, person or film, for the fictional
Acme Pictures.

**Installed nowhere.** The package passes the pipeline, and the add-on's decisions are held by its
Java tests in Nuxeo's own test framework, on H2; not held there: the REST API's answer to a refused
delivery, and a check-in or a restore of a delivery, which is not versionable. No server has the
add-on 0.5.0 or this kit: the local Nuxeo has the add-on's 0.1.0, and is not written to here. So its
pages have not been drawn on a server's records, and its seed and its demo's steps file have run
only on the kit's stand-in server, `demo/stand-in.mjs`.

## The short version

- **A film's record page:** its year, director, genre and original language; its release windows,
  each a territory and a channel with the days it opens and closes; and its localised versions, a
  related list, each with its language, its own territories and channels, and the day its rights
  end.
- **A localised version's page:** its film, linked; its language; its own rights, the territories it
  may be delivered to, its channels and its rights end, under a banner once they have ended; its
  files, the master, the subtitles, the key art and, from 0.2.0, a still from the film; and its
  deliveries, a related list.
- **Watermarks, from 0.2.0** (below, "The watermark"): a delivery's key art is marked for its
  distributor, and the delivery holds it marked; the still is served marked to an outside partner,
  a member of `media-partners`, naming them, and as it is to the kit's staff.
- **The queue of deliveries,** the latest first, and **a delivery's page:** the distributor, the
  territory and the version, linked; when it was delivered and by whom; and what was delivered,
  file by file, with each one's channel, name, type, size and digest.
- **No button.** A delivery is filed as a document in the deliveries folder, over the REST API, as a
  records request is in the records kit, and the add-on decides it on the server (below, "The
  demo"). Decision 3 is open, so the app runs no operation, and the add-on registers none for
  deliveries. The kit writes no create form for a delivery: it is filed over the REST API, as the
  demo files it.
- **A stand-in model:** two fictional types, `Film` and `FilmVersion`, the version's files its
  attachments. The delivery is the add-on's type, `MediaDelivery`, not the kit's.
- **A rights policy** for `FilmVersion`, for the add-on (below, "The rights").
- **A seed** that writes the film, its windows and its three versions with their files, the key art
  and the still drawn as pictures, and the deliveries folder, with the kit's three groups'
  permissions. It files no delivery.

## The rights

`bundle/OSGI-INF/media-demo-rights.xml`, for `nuxeo-agentic-assets` 0.5.0:

| A version's     | Where                                     |
| --------------- | ----------------------------------------- |
| Rights end      | `dc:expired`                              |
| Channels        | `fver:channels`                           |
| Territories     | `fver:territories`                        |
| Release windows | its film's `film:windows`, by `fver:film` |

| File                            | Cleared by  | In a delivery | Watermarked                                 |
| ------------------------------- | ----------- | ------------- | ------------------------------------------- |
| `files:files/0/file`, master    | `SVOD`      | Yes           | No                                          |
| `files:files/1/file`, subtitles | `SVOD`      | Yes           | No                                          |
| `files:files/2/file`, key art   | `Marketing` | Yes           | In a delivery, for its distributor          |
| `files:files/3/file`, still     | A preview   | No            | When downloaded by anyone outside the staff |
| The `thumbnail` rendition       | A preview   | No            | No                                          |

- **Each version has its own rights:** its own territories, channels and rights end. Its release
  windows are its film's: a window is the title's, the same for each of its language versions.
- **A delivery to a territory** is refused unless, for each of its three files, the version's rights
  have not ended, its channels hold the file's channel, its territories hold the territory, and a
  window of its film for that channel is open there today, in UTC. One file refused refuses the
  package whole: nothing is delivered.
- **A download** at the platform's endpoints names no territory: a file is served while a window for
  its channel is open in any territory the version may be delivered to. So the German version's
  master, refused for a delivery to Germany before SVOD opens there, is still downloadable by a
  reader of the version while SVOD is open in Switzerland: the seed gives `media-distribution` Read
  on the versions.
- **The film is named by its id, and must be a `Film`:** the policy's `<windows type="Film">`. A
  version naming a document of another type, a proxy, one in the trash or none is refused every use
  that needs its windows.
- **The still is a preview,** from 0.2.0: served whatever the version's rights, as a screener is,
  and marked for anyone outside the kit's staff (below, "The watermark").
- **The files are the attachments, by place.** The stand-in model has no file field of its own for
  each, so the master must be the first attachment, as the seed writes it. A real model gives each
  its own field, and the policy names those.

## The watermark

From 0.2.0, the policy's `<watermark>`, which `nuxeo-agentic-assets` 0.5.0 applies on the server:

```xml
<watermark text="ACME PICTURES · FOR {recipient} · {user} · {day}" placement="tiled">
  <previews><blob xpath="files:files/3/file" /></previews>
  <deliveries><blob xpath="files:files/2/file" /></deliveries>
  <except group="media-rights" />
  <except group="media-distribution" />
</watermark>
```

- **A delivery's key art is marked for its distributor,** its text `ACME PICTURES · FOR <the
distributor> · <the filer> · <the day>`, whoever files it: the add-on requires a delivery's mark to
  name its filer too, since the distributor's name is the filer's to write. The delivery records, for each file, whether it was
  marked, for whom and with what text, and holds the key art marked, a JPEG drawn on the server; the
  master and the subtitles are recorded unmarked, and not held. A key art that cannot be marked,
  such as one that is not a picture, refuses the delivery whole, `watermark-unavailable`.
- **The still is marked for outside partners.** The download endpoints refuse it unmarked, 403
  `watermark-required`, to anyone in neither `media-rights` nor `media-distribution`, an
  administrator included; `Asset.GetWatermarked` serves it to them marked, the text naming them.
  The kit's staff download it as it is.
- **The partners' group,** `media-partners`, reads the versions, which the seed grants: a
  festival's programmers, say, or a distributor's buyer before a deal. Their accounts are the
  server's.
- **Not marked:** the master and the subtitles. A subtitle file holds no picture, and the kit's
  master is a text placeholder; a real master would be marked through the server's video tools,
  which need ffmpeg (below, "What it does not do").

## What is in it

| File                                                              | What it is                                                                                          | Written by                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `bundle/agentic-ui-config/app.json`                               | The app: id and address `media`, two groups, `media-distribution` and `media-rights`                | `app-package`                 |
| `bundle/agentic-ui-config/layouts/Film/view.layout.json`          | A film's record page: the film, its release windows and its localised versions                      | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/layouts/FilmVersion/view.layout.json`   | A version's page: a banner, the version, its own rights, its files and its deliveries               | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/layouts/MediaDelivery/view.layout.json` | A delivery's page: the delivery, when and by whom, and what was delivered                           | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/queues/deliveries.json`                 | The deliveries, the latest first                                                                    | `app-queue`, then by hand     |
| `bundle/agentic-ui-config/queues/films.json`                      | The films, by title                                                                                 | `app-queue`                   |
| `bundle/agentic-ui-config/navigation.json`                        | The menu: the two queues                                                                            | By hand                       |
| `bundle/agentic-ui-config/labels/en.json`                         | Every label key the files name, and the fields' names                                               | The generators, then by hand  |
| `bundle/OSGI-INF/media-demo-config.xml`                           | The component: the three layouts, and the app with the files the registry serves                    | The generators                |
| `bundle/OSGI-INF/media-demo-model.xml`, `bundle/schemas/`         | **The stand-in model:** `Film`, `FilmVersion`, and their page providers; the film's windows by hand | `app-model`, then by hand     |
| `bundle/OSGI-INF/media-demo-rights.xml`                           | The rights policy for `FilmVersion`, with its watermark from 0.2.0                                  | By hand                       |
| `bundle/OSGI-INF/media-demo-queues.xml`                           | The two page providers over the add-on's deliveries. Not the stand-in's: they stay when it goes     | By hand                       |
| `content-model.json`                                              | The stand-in, and the add-on's `MediaDelivery`, as a server with both installed is to answer        | `app-model`, then by a script |
| `demo/seed.mjs`, `demo/data.mjs`                                  | The seed and its fictional film. Not packaged                                                       | By hand                       |
| `demo/png.mjs`                                                    | The key art and the still, drawn: the brand kit's PNG writer, copied, with shapes of its own        | By hand                       |
| `demo/stand-in.mjs`                                               | The stand-in server the seed's controls and the demo's steps file run on. Not packaged              | By hand                       |
| `demo/seed.selftest.mjs`                                          | The seed's controls, and the demo's four cases held to the seeded data. Not packaged                | By hand                       |
| `package/package.xml`                                             | The Marketplace package; it depends on `nuxeo-agentic-ui` and `nuxeo-agentic-assets` 0.5.0          | `app-package`, then by hand   |
| `build.mjs`                                                       | Version 1's builder: the generator's, byte for byte                                                 | `app-package`                 |

- **The film's windows are written by hand** in `bundle/schemas/film.xsd`: a complex list, which
  `app-model` does not write. Their subfields, `territory`, `channel`, `from` and `until`, are the
  add-on's names.
- **The add-on's type in `content-model.json`** was added from the add-on's XSD, since `app-model`
  writes the stand-in's own types only and the package must not register the add-on's. The pipeline
  holds the delivery's page and the queue to it.
- **The page providers** read the repository with the reader's permissions: a person who may not
  read the deliveries folder sees no delivery. The queues have no facets: a facet needs a page
  provider the search index answers, and these do not.
- **One version in three places:** `package.xml`'s, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`.

## Building it

```bash
npm run app-package -- business-apps/packages/media-demo --platform 0.2.0
```

It writes `dist/media-demo-0.2.0.zip` and its checksum. The pipeline holds the kit to its own
`content-model.json`, since it ships a stand-in model.

**0.2.0, held to 0.1.0 on the staging branch with `--previous`:** its two changes, the rights
policy's still and watermark and `package.xml`'s dependency raised to `nuxeo-agentic-assets` 0.5.0,
need a patch; 0.2.0 raises the minor, as a kit that newly needs its add-on's watermarks, a fourth
file on each version and a new group should. The upgrade check,
`npm run app-upgrade -- business-apps/packages/media-demo --since origin/staging/enterprise-grade-app`,
keeps every configuration. `content-model.json`'s `MediaDelivery` gains the add-on 0.5.0's four
fields of a delivered file, `watermarked`, `watermarkedFor`, `watermark` and `watermarkedFile`,
added by hand from the add-on's XSD, as its others were.

## Installing it, on a server of your own

Not done on any server. In this order:

1. **The assets add-on,** `nuxeo-agentic-assets` 0.5.0, built by Maven
   ([its README](../../../nuxeo-agentic-assets/README.md)), and **this kit**, with
   `nuxeoctl mp-install`, then a restart. The add-on's share links open a path that needs no
   sign-in: its README's install section says what must be in place first.
2. **The groups** `media-rights`, `media-distribution` and, from 0.2.0, `media-partners`, and the
   people in them, in the server's directory.
3. **The seed,** as an administrator: `node business-apps/packages/media-demo/demo/seed.mjs`, with
   `NUXEO_USER` and `NUXEO_PASS` exported.

**The release windows are days from the seed's day,** in UTC (`demo/data.mjs`): the demo's cases
hold for 30 days after the seed that wrote them. The seed leaves a film already there as it is; to
seed again, delete the kit's workspace first.

## The demo

Phase 9's demo step 1, by a distribution coordinator, a member of `media-distribution`. Each
delivery is a document filed in the deliveries folder, over the REST API, with the coordinator's own
credentials; the add-on decides it on the server and answers 403, with its reason in the message,
when it refuses. `<version>` is the localised version's id, which its page shows.

1. **Inside its window.** The French version, to a distributor in France:

   ```bash
   curl -sS --fail-with-body -u "$COORDINATOR" -H 'Content-Type: application/json' \
     -X POST "$NUXEO_URL/nuxeo/api/v1/path/default-domain/workspaces/media-demo/deliveries" \
     -d '{"entity-type":"document","type":"MediaDelivery","name":"fr","properties":{
          "mdlv:version":"<the French version>","mdlv:distributor":"Acme Distribution France",
          "mdlv:territory":"FR"}}'
   ```

   Delivered. The delivery's page names the distributor, the territory and the version, and lists
   the master and the subtitles for SVOD and the key art for Marketing, each with its digest; it is
   first in the queue of deliveries, and on the version's page. From 0.2.0 its record says the key
   art was marked for Acme Distribution France, with the text `ACME PICTURES · FOR Acme
Distribution France · <the coordinator> · <the day>`, and holds it marked; the master and the subtitles were not.

2. **Outside its window.** The German version, `"mdlv:territory":"DE"`, to Acme Verleih
   Deutschland: refused, 403, `outside-window` for the master and the subtitles, since SVOD in
   Germany opens 35 days after the seed's day. Nothing is made.

3. **Refused whole.** The French version to Belgium, where SVOD is open and Marketing closed the day
   before the seed's: refused for the key art alone, and the master and the subtitles are not
   delivered either.

4. **A version's own rights.** The French version to Germany, where the film's Marketing window is
   open: refused, `territory-not-covered`. The German version may go there; the French one may not.

5. **The still, for an outside partner,** from 0.2.0. The coordinator downloads the French
   version's still as it is, a PNG. A member of `media-partners` is refused it unmarked, 403
   `watermark-required`, and is served it marked, a JPEG naming them, by the add-on's operation:

   ```bash
   curl -sS --fail-with-body -u "$PARTNER" -H 'Content-Type: application/json' -o still.jpg \
     -X POST "$NUXEO_URL/nuxeo/api/v1/automation/Asset.GetWatermarked" \
     -d '{"input":"doc:<the French version>","params":{"use":"blob:files:files/3/file"}}'
   ```

The steps file runs these five, on the kit's stand-in, or with `MEDIA_DEMO_SERVER` on a server,
where the fifth's partner checks need `MEDIA_PARTNER_USER` and `MEDIA_PARTNER_PASS`, a member of
`media-partners`, and are not run without them:

```bash
npm run beta:evidence -- media-delivery
```

On 27 November 2026, on the stand-in: 33 of 33 checks passed. It proves the demo's script and its
data, not the server: the server's decision is the add-on's `MediaDeliveryTest`'s, and its marks the
add-on's `MediaDeliveryTest` and `WatermarkPolicyTest`'s. **The stand-in's marked file is not the
server's:** where the add-on draws the text across the picture, the stand-in answers an 8 by 8 grey
JPEG holding the text in a comment, so that its text can be read back there; on a server the steps
file checks only that a JPEG apart from the still is served. The seed's controls,
`demo/seed.selftest.mjs`, 64 of them, hold the watermark's cases on the stand-in too, and each of
the new ones was seen failing with its guard broken on purpose: a delivery marking nothing, or
naming its filer, a key art that is not a picture delivered, the staff not exempt, or everyone, the
operation serving the still unmarked, the policy's watermark read as its rules, `/nxfile/`
undecided, no still uploaded, the key art left a text file, and the partners not granted Read; the
steps file went red too with a delivery marking nothing, everyone exempt, and the operation serving
the still unmarked.

## What it does not do

- **Hand the files over.** A delivery is the record of what was delivered: the files, by their
  digests, to whom, where and when. It moves no byte. The add-on's share links serve watermarked
  pictures only, and a film's files are not pictures, so a delivery makes no share link (the
  add-on's README, "What deliveries do not do").
- **Watermark the master.** The kit's master is a text placeholder, so its delivery marks the key
  art only. The add-on marks a video through the platform's video tools, which need ffmpeg on the
  server (its README, "Watermarks"); the local Nuxeo has none, and a real master would be marked
  synchronously, as the delivery is filed, which a feature's length would hold for as long as its
  conversion takes.
- **Mark the lists' thumbnails,** or anything but the still: the watermark names the still alone
  among the previews.
- **Pages in the browser, on the stand-in.** The stand-in serves the REST API the seed and the steps
  file call, not the app.
