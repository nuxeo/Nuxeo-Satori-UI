# Brand assets (demo)

The brand assets kit, version 0.2.4 ([development plan](../../../docs/business-apps/development-plan.md),
phase 5, "Files as records: brand assets"), for the fictional outdoor apparel brand Acme Outdoor of
the [prototype](../../../docs/prototype/business-apps/src/data-dam.js). All its data is fictional:
no real brand, product, studio or person. The pictures are drawn by the seed, and the two videos
generated from a test pattern, not photographed, filmed or downloaded.

## The short version

- **An asset page for pictures, as a layout file:** an asset is a Picture of the kit's own type,
  `AcmeAsset`, so its record page shows its picture views first, under two rights banners: one
  while its rights end within 30 days, one once they have ended
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), "Banners"). Its rights end on
  `dc:expired`.
- **An asset page for videos, from 0.2.3:** a video is an asset of the kit's own type,
  `AcmeVideo`, which extends Video, so its record page shows its player, the facts Nuxeo read of
  it and its storyboard first, under the same banners (below, "The videos"). The player plays the
  server's transcoded web cut where it made one, else the original.
- **Rights the server enforces:** the kit's rights policies for `AcmeAsset` and `AcmeVideo`, which the assets
  module's server add-on, [`nuxeo-agentic-assets`](../../../nuxeo-agentic-assets/README.md),
  enforces for every user at the platform's download endpoints: a print view or rendition refused to an asset whose channels hold no
  Print, every use but a preview refused once its rights have ended, and the server's reason on
  the asset page (below, "Rights on the server"). The package depends on the add-on.
- **A creative review on the asset page,** turned on by the layout file's `"review": {}`, with no
  code: a reviewer pins a note to a point of the picture, the pins are listed beside it, and the
  review goes in rounds, the earlier rounds' pins marked as past. The pins are Nuxeo's own
  annotations on the asset (layout-v2.md, "Review"). Phase 5's demo step 4, as a steps file of its
  own: [`scripts/beta-harness/steps/brand-assets-review.mjs`](../../../scripts/beta-harness/steps/brand-assets-review.mjs).
- **A product page:** a product's details, its shots, and the shots its shot list still misses,
  each a related list over a page provider.
- **Share links on the asset page,** turned on by the layout file's `"shareLinks": {}`, with no
  code: to a user the server lets manage them, the page lists the asset's links for people
  outside, offers a new one for some of its views or its original, until a last day, and Revoke,
  and shows what they served (below, "Share links"). The server, `nuxeo-agentic-assets` 0.2.0,
  holds every rule of a link.
- **Two queues, a menu and labels:** the asset library, pictures and videos, with four facets
  from its page provider's aggregates (Rights, Shot, Product and Type), and the products.
- **A stand-in model,** until a brand team's own arrives: the types, schemas and page providers
  those files name. It is fictional, and replaced whole when theirs comes.
- **A performance budget at 100,000 assets,** for the library and the asset page, checked against
  a stand-in for the server rather than a seeded one:
  [performance-budget.md](../../../docs/business-apps/performance-budget.md), and
  `npm run beta:asset-performance`. It does not measure the server's own query time.
- **A seed script** writes two products, six pictures, two videos and the products' shot list into
  the kit's own workspace, and nowhere else. Run it twice and nothing is added the second time. With
  `--preview`, before the package is installed, it writes the six pictures as the platform's own
  `Picture`, for a look at the asset page in dev mode.
- **The demo script,** as steps files of the beta harness:
  [`brand-assets-demo.mjs`](../../../scripts/beta-harness/steps/brand-assets-demo.mjs), the
  plan's demo step 2,
  [`brand-assets-rights.mjs`](../../../scripts/beta-harness/steps/brand-assets-rights.mjs), and
  the videos, [`brand-assets-video.mjs`](../../../scripts/beta-harness/steps/brand-assets-video.mjs).
- **On no shared server.** The package is built and checked by the pipeline. When its first
  checks ran, no server had it, and its asset layout was seen in dev mode on Pictures of the
  platform's own type (below, "What was checked, and how"). Version 0.1.0 has since been installed
  on the local Nuxeo those checks ran on, and the review's steps file ran against its stand-in model
  there. Read only, on 25 November 2026, that server's package list shows 0.2.0 started, with
  `nuxeo-agentic-assets` 0.1.0, which has no share links; 0.1.1 to 0.2.4 are installed nowhere,
  so no share link and no video page has run on a server. The product page, the queues and the
  demo script have not run on a shared server.

## What is in it

| File                                                            | What it is                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`                             | The app: its name, version, platform range and groups                                                               |
| `bundle/agentic-ui-config/layouts/AcmeAsset/view.layout.json`   | The asset page: two rights banners, the picture as a review, its share links, the asset, its rights and its history |
| `bundle/agentic-ui-config/layouts/AcmeProduct/view.layout.json` | The product page: the product, its missing shots and its shots                                                      |
| `bundle/agentic-ui-config/layouts/AcmeShot/view.layout.json`    | A shot of the shot list, which a missing shot's row opens                                                           |
| `bundle/agentic-ui-config/layouts/AcmeVideo/view.layout.json`   | The video page: the same banners and cards, under the video, its facts and storyboard                               |
| `bundle/agentic-ui-config/queues/library.json`                  | The asset library, pictures and videos, the rights that end soonest first, with four facets                         |
| `bundle/agentic-ui-config/queues/products.json`                 | The products, the next launch first                                                                                 |
| `bundle/agentic-ui-config/navigation.json`                      | The menu: the two queues                                                                                            |
| `bundle/agentic-ui-config/labels/en.json`                       | Its labels, in English: every key the files above name, and its fields' labels                                      |
| `bundle/OSGI-INF/brand-assets-demo-config.xml`                  | The component that contributes the four layouts and the app                                                         |
| `bundle/OSGI-INF/brand-assets-demo-model.xml`                   | **The stand-in model:** document types, lifecycles, page providers                                                  |
| `bundle/OSGI-INF/brand-assets-demo-rights.xml`                  | The rights policy for `AcmeAsset`, which `nuxeo-agentic-assets` enforces                                            |
| `bundle/OSGI-INF/brand-assets-demo-video-rights.xml`            | The rights policy for `AcmeVideo`, which `nuxeo-agentic-assets` enforces                                            |
| `bundle/schemas/*.xsd`                                          | **The stand-in model's** schemas                                                                                    |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/png.mjs`                | The seed script, its fictional records, and the pictures it draws. Not packaged                                     |
| `demo/videos/*.webm`                                            | The two videos, a few kilobytes each, generated (below, "The videos"). Not packaged                                 |
| `demo/seed.selftest.mjs`                                        | The seed's controls, against a stand-in for the REST API it calls. Not packaged                                     |
| `package/package.xml`                                           | The Marketplace package: name, version, and what it depends on                                                      |
| `build.mjs`                                                     | Version 1's builder: the generator's, byte for byte                                                                 |
| `content-model.json`                                            | The model as a server with this package installed is to answer it, for `--model`                                    |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **No home.** The kit has no KPIs yet: the menu opens the two queues.
- **No operation button and no action file.** Decision 3 is open, so the pipeline refuses every
  operation, and a lifecycle button for an asset waits for an asset lifecycle, with its approval.
- **One version in three places:** `package.xml`'s, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`. The pipeline's step 3 refuses any of them that differs.

## Rights on the server

`bundle/OSGI-INF/brand-assets-demo-rights.xml` contributes the kit's rights policy to
[`nuxeo-agentic-assets`](../../../nuxeo-agentic-assets/README.md), on the stand-in model's fields:
the rights end on `dc:expired`, and `acmeasset:channels` holds the channels they cover. Which
channel covers each use is the prototype's renditions table, on the platform's stock picture
views:

| Use                                                                    | Covered by |
| ---------------------------------------------------------------------- | ---------- |
| The original file (`file:content`, the `mainBlob` rendition)           | Print      |
| `OriginalJpeg`, the picture at its own size: the kit's print rendition | Print      |
| `FullHD`: the web view                                                 | E-commerce |
| `Thumbnail`, `Small` and `Medium`, and the `thumbnail` rendition       | A preview  |

Each view is listed as a view and as the rendition of the same name. The add-on refuses, with
403, a use whose channel the asset's channels do not hold, every use but a preview from the day
after its rights end, in UTC, and any use the policy does not list, such as the `pdf` or
`zipExport` rendition. A preview is served whatever the rights, so the asset page and the lists
still show an ended asset's picture. Nothing here exempts an administrator. The add-on decides the
platform's download endpoints, `/nxfile/` and the REST API's `@blob`, `@rendition` and
`@preview`, and the platform's `Video.*` operations, not yet other Automation operations that
return a blob: its README, "What it does not cover".

**On the seeded assets:** asset 503 holds E-commerce and Social, so its print view and its
original are refused and its web view served; asset 505's rights have ended, so everything but its
previews is refused; the others hold every channel and are served everything listed.

**On the asset page,** choosing a view the server refuses shows the server's reason in its place,
asked of the add-on's `assetRights` enricher after the 403. No view is hidden or disabled: each is
asked for, and the server decides. The Annotations tab's viewer asks for the original, which the
server refuses on assets 503 and 505.

## Share links

The asset layout's `"shareLinks": {}` turns on the asset page's share links (layout-v2.md,
section 2, "Share links"). From 0.2.2 the package depends on `nuxeo-agentic-assets` 0.2.0, and
from 0.2.4 on 0.3.0, which holds every rule of a link ([its README](../../../nuxeo-agentic-assets/README.md)); the kit
contributes nothing of its own to them.

- **Who sees them:** the page asks the server for the asset's links, and draws nothing of them for
  a user it refuses, with 403: one without the asset's `WriteSecurity`, Nuxeo's permission to
  give anyone else access. Making a link needs more: an administrator, or a member of a group the
  server's `nuxeo.agentic.share.groups` names, none unless it is set; the kit sets none. Hiding the
  section is not the control: the server refuses the same user's every call.
- **A new link** lists the original or some of the asset's views, by their titles, and a last
  day, in UTC, from today to 90 days on. The server refuses an item the asset's rights do not
  allow now, and the page says which and why, in the rights' words. Its address is shown once,
  with Copy: the server keeps only a hash of its token, so a lost address is revoked and made
  again.
- **What a link serves,** to anyone who opens it, without signing in: only the items it lists,
  watermarked on the server, while it is neither revoked nor past its last day and while the
  asset's rights allow each one, so an ended right ends the link too. On the seeded assets, a link
  to asset 503's original or its print view is refused when it is made, since its channels hold
  no Print, and every link to asset 505 is, since its rights have ended.
- **Revoke** stops a link at once, after a confirmation. The page lists each link's state,
  active, expired or revoked, who made it and when, and the downloads log: each item served, when,
  through which link, and nothing about who opened it.

**Nothing of it has run on a server:** the add-on 0.2.0 or later and this version are installed nowhere,
and the page was tested against a stand-in for the server's answers.

## The videos

From 0.2.3, a video is an asset with its own page, as a picture is: an `AcmeVideo`, which extends
the platform's `Video`, with the same `acmeasset` schema as a picture asset, so that the library
lists both with the same columns and facets.

- **Its page,** `layouts/AcmeVideo/view.layout.json`, has a picture asset's banners and cards, the
  video's card headed "Video", and no review: a review is drawn on a picture, and the pipeline
  refuses one for a type with the `video` schema. Above the cards, the record page draws the
  video's player, the facts Nuxeo read of it and its storyboard, for any record with the `video`
  schema ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 11, "A video's record
  page shows its player first"). That is platform code, generic, and not this kit's.
- **What it plays:** the server's transcoded videos, the platform's automatic `MP4 480p` and
  `WebM 480p`, where it made them, else the original. Each file is fetched through the app and
  played from a blob URL, a transcoded one asked for by its rendition's name.

**Its rights** are `bundle/OSGI-INF/brand-assets-demo-video-rights.xml`, a component of its own
beside the pictures', as the prototype's video renditions table has them:

| Use                                                                                 | Covered by |
| ----------------------------------------------------------------------------------- | ---------- |
| The original file (`file:content`): the master                                      | Print      |
| The `MP4 480p` and `WebM 480p` renditions: the web cut                              | E-commerce |
| `Small` and `StaticPlayerView`, the frames Nuxeo takes from it, and the `thumbnail` | A preview  |
| Every frame of the storyboard, `<storyboard>`, however many the server makes        | A preview  |
| Any other file of it                                                                | Not listed |

The page asks for a transcoded video by its rendition's name, through `@rendition`; the
server's download endpoints decide one by its conversion's name at its place in
`vid:transcodedVideos` too, and the platform's `Video.*` operations on a video are decided as a
download of the file they read. From 0.2.4 the storyboard is one rule, which needs
`nuxeo-agentic-assets` 0.3.0, the package's dependency. `nuxeo-agentic-assets`'s
`KitVideoPolicyTest` reads this file and holds each of these decisions, and its `VideoRightsTest`
runs it in a Nuxeo runtime.

- **The seeded videos:** asset 511, _Into the Hills, campaign film_, 12 seconds, holds E-commerce
  and Social, so its original is refused and its web cut served; asset 512, _Trailhead Rain
  Jacket, Moss, turntable_, 4 seconds, is cleared everywhere. Nuxeo makes a storyboard for a video
  of 10 seconds or more, so 511 has one where the server transcodes, and 512 never does.
- **The files,** `demo/videos/ast-511.webm` and `ast-512.webm`, 4,762 and 1,978 bytes, VP8 in WebM
  with no sound, were generated by ffmpeg 8.1.2 from its own test sources, not filmed or
  downloaded, with this command for 511, and the same with `size=90x120`, `duration=4`, the Moss
  colours `0xd6e2cd` and `0x4a663e`, a 40 by 70 box moving as `25+12*sin(t*3)` and no ground, for 512. The same ffmpeg writes the same bytes again:

```bash
ffmpeg -f lavfi -i "color=c=0xf6dec4:size=160x90:rate=5:duration=12[bg];color=c=0xb05c28:size=30x28:rate=5[box];[bg][box]overlay=x='8+t*9':y=46:shortest=1,drawbox=x=0:y=74:w=160:h=16:color=0x8a4a22:t=fill" -c:v libvpx -b:v 8k -crf 50 -qmin 20 -qmax 63 -g 60 -auto-alt-ref 0 -an -map_metadata -1 -fflags +bitexact -flags +bitexact ast-511.webm
```

- **When the server cannot transcode.** Nuxeo reads a video's facts with ffprobe, and transcodes
  it and makes its storyboard with ffmpeg. The local Nuxeo has neither: `docker exec nuxeo which
ffmpeg` finds none, and its log says at each start that `ffmpeg` and `ffprobe` are not available,
  so `ffmpeg-info`, `ffmpeg-tomp4`, `ffmpeg-towebm` and `ffmpeg-screenshot` are not. There, the
  seed writes the videos all the same, checks that each is a Video to Nuxeo, and says that the
  server read no facts, transcoded nothing and made no storyboard; each page plays the original,
  and says the server has read none of its facts and made no storyboard. So on such a server asset
  511's page shows the server's refusal of its original, with its reason, and plays nothing, and
  asset 512's plays its original.

## The stand-in model

A brand team's model has not arrived. Until one does, the package carries a fictional one, in a
component of its own so that it can be replaced whole: `brand-assets-demo-model.xml` and
`bundle/schemas/`.

| Type              | Schema (prefix)                    | What it holds                                                                                                                                                     |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AcmeAsset`       | `acmeasset`, on a Picture          | `product` (a style number), `colorway`, `shot`, `campaign`, `credit`, `channels`, `regions`. Its rights end on `dc:expired`, and `dc:rights` says who holds them  |
| `AcmeVideo`       | `acmeasset`, on a Video            | The same as a picture asset, on a video: Nuxeo reads its facts, transcodes it and makes its storyboard, with ffmpeg                                               |
| `AcmeProduct`     | `acmeproduct`                      | `style`, such as `AO-3101`, `season`, `colorways`, `channels`, `launch`. Its name is its `dc:title`                                                               |
| `AcmeShot`        | `acmeshot`                         | One shot a product needs: `product` (its style), `colorway`, `shot`, `due`, and `asset`, the id of the asset that fills it, empty while it is missing             |
| `AcmeAssetSearch` | `acme_asset_search` (`acmesearch`) | The library's search document, never saved: `acme_rights_agg`, `acme_shot_agg`, `acme_product_agg` and `acme_type_agg`, the facets the library sends back. Hidden |

- **An asset is a Picture.** `AcmeAsset` extends `Picture`, so it has Picture's schemas and its
  `Picture` facet: Nuxeo makes its picture views as it does a Picture's, and the document page asks
  for the record again while they are being made, as it does for any record with that facet
  (layout-v2.md, section 11). A type of its own, not the platform's `Picture`, so that the kit's
  layout is drawn for the kit's assets only.
- **A video asset is a Video.** `AcmeVideo` extends `Video`, so it has Video's schemas and its
  `Video` facet, which declares the `picture` schema too, for its still frames: Nuxeo reads,
  transcodes and storyboards it as it does a Video, where it has ffmpeg, and its record page shows
  its player, not its picture.
- **Its rights end on `dc:expired`,** Dublin Core's day after which a document is no longer to be
  used. The asset page's two banners read it through `app.rules.datePassed` and
  `app.rules.dateWithin`, the app's own list of expired documents reads it
  (`DocumentService.getExpiredDocuments`), and the stock Picture's Edit form already offers it. The prototype keeps a licence end and a model release end, and the
  earlier of the two ends the asset's use: here the seed writes that earlier day.
- **A missing shot is a shot with no asset.** Each product's shot list is a record per shot and
  colourway; `acme_product_missing_shots` asks for those whose `acmeshot:asset` is empty. Nothing
  but the seed sets the asset yet: a real model would, when an asset for the shot is approved,
  which the review does not do: it holds pins and rounds, not an approval.
- **A product is named by its style number,** in an asset's `acmeasset:product` and a shot's
  `acmeshot:product`, not by its document id: the library's Product facet shows the number as each
  bucket's name, where an id would mean nothing to a reader.
- **Every type has the platform's default lifecycle.** An asset lifecycle, with an approval state
  that a review ends in, is not built.
- **Created by the seed, not by hand:** no folder lists the types among its subtypes, so the
  Create menu does not offer them, and a picture uploaded by hand is a platform `Picture`.
- **The names carry the brand's,** `Acme…` and `acme_…`, so that they do not collide with another
  model's on a shared server, as plain names such as `Asset` would. A brand team's model sets its
  own.

| Page provider                | Given                    | Returns                                                                                                                                                   |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acme_products`              | Nothing                  | Every product, the next launch first                                                                                                                      |
| `acme_product_assets`        | A product's style number | The product's assets, by title                                                                                                                            |
| `acme_product_missing_shots` | A product's style number | The product's shots that no asset fills, the soonest due first                                                                                            |
| `acme_asset_library`         | Nothing                  | Every asset, a picture or a video, the rights that end soonest first. Aggregates: `acme_rights_agg`, `acme_shot_agg`, `acme_product_agg`, `acme_type_agg` |

Each binds what it is given as a quoted literal, and leaves out versions, proxies and trashed
records.

- **The library reads the search index,** not the repository: its facets are aggregates, which
  only the index answers. It is a `SearchServicePageProvider`, the class Nuxeo 2025 gives
  `default_search`, with the search document `AcmeAssetSearch`, as the Payers kit's queues are.
- **The Rights facet is a `date_range` aggregate** over `dc:expired`: `Ended` before today,
  `Ending` from today to 30 days ahead, as the warning banner says, and `Cleared` after. Its bounds
  are the server's day in UTC (`now/d` and `now+31d/d`), which is how a stored day is written; the
  date math was run against the local OpenSearch, read only. Near midnight, a reader east or west
  of UTC can see a banner the facet puts in the next bucket for a few hours. An asset with no end
  date is in no bucket.
- **The library is sorted by `dc:expired`,** not by title: the index maps `dc:title` as analysed
  text, which sorts by one of each title's words.
- **The Type facet is a `terms` aggregate** over `ecm:primaryType`, which the index maps as a
  keyword; it was run against the local OpenSearch, read only. A bucket shows its key as the server
  returns it, so its buckets read `AcmeAsset`, the pictures, and `AcmeVideo`: a facet's bucket has
  no label of its own yet (`libs/shared/queues/README.md`).
- **The product page's shots are pictures:** `acme_product_assets` still asks for `AcmeAsset`
  records only, so a product's video is in the library, not among its shots.

## Building it

```bash
npm run app-package -- business-apps/packages/brand-assets-demo --platform 0.2.0
```

It writes `dist/brand-assets-demo-0.2.4.zip`. Held to its content model
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 4):

```bash
npm run app-package -- business-apps/packages/brand-assets-demo --platform 0.2.0 \
  --model business-apps/packages/brand-assets-demo/content-model.json
```

**`content-model.json` was not exported from a server with the package installed:** none had
it when it was written. Its stock types, facets and schemas, Picture's among them, are what Nuxeo 2025.10.18
answered, exported with `npm run app-package:model`; the kit's three types and its three record
schemas were written from the XSDs in the same form, and `AcmeAsset`'s facets and schemas are
Picture's with `acmeasset` added, as Nuxeo reports a type that extends another. Export it again,
and cut it down to the kit's types, once the package is installed.

## Installing it on a local Nuxeo

**Not run yet.** These steps are the Payers kit's, which were run, for this package; whoever runs
them first should check each step's outcome as step 3 says. The local Nuxeo is the Docker container
`nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed: this package depends on it
(`package/package.xml`), and it serves the layouts. If it is not, install it first, as the
[Payers kit's README](../payers-claims-demo/README.md#installing-it-on-a-local-nuxeo) says.

**From 0.2.0 it also depends on `nuxeo-agentic-assets`,** the add-on that enforces its rights
policy, and from 0.2.2 on its version 0.2.0, which adds the share links. Install the two in one
restart, as the
[add-on's README](../../../nuxeo-agentic-assets/README.md#installing-it-on-a-local-nuxeo) says:
build the add-on with `mvn -pl nuxeo-agentic-assets -am package`, copy both zips in, and name both
in the one-off script's `nuxeoctl mp-install`, the add-on first. The steps below install the kit
alone, onto a server that already has the add-on.

**1. Build it,** from the repository's root:

```bash
npm run app-package -- business-apps/packages/brand-assets-demo --platform 0.2.0
```

**2. Into the container,** then a one-off script that installs it when the container next starts.
`nuxeoctl mp-install` refuses while the server runs, and the server is the container's main
process, so stopping it stops the container. The image runs every `.sh` file in
`/docker-entrypoint-initnuxeo.d/` before it starts the server; this one removes itself.

```bash
docker cp business-apps/packages/brand-assets-demo/dist/brand-assets-demo-0.2.4.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/brand-assets-demo-0.2.4.zip --accept=true > /var/log/nuxeo/brand-kit-install.log 2>&1 || echo "brand kit: install failed, see /var/log/nuxeo/brand-kit-install.log"' 'rm -f "$0"' > /tmp/zz-brand-kit-install.sh && chmod 755 /tmp/zz-brand-kit-install.sh
```

```bash
docker cp /tmp/zz-brand-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- `/var/log/nuxeo/brand-kit-install.log` in the container lists the package installed;
- the server log's `Component Loading Status` has nothing pending or missing;
- `/nuxeo/api/v1/config/types/AcmeAsset` answers, with `Picture` among its facets;
- `/nuxeo/agentic-ui-config/layouts.json` lists the three `view` layouts;
- the server log names `nuxeo.config.brand-assets-demo.rights` among the components started, and
  has no `Asset rights:` error.

A rebuild of a version already installed is skipped as unchanged: in the one-off script, run
`nuxeoctl mp-remove brand-assets-demo --accept=true` before `mp-install`.

### Removing it

**First delete the seeded workspace,** `/default-domain/workspaces/acme-brand-assets`, and empty it
from the trash: do the same before replacing the stand-in model. A document whose type is gone
cannot be read, and would break the folder and the searches that hold it. Then remove the package
the way it was installed, with `nuxeoctl mp-remove brand-assets-demo --accept=true` in the one-off
script in place of `mp-install`.

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<user> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/brand-assets-demo/demo/seed.mjs
```

- **What it writes:** two products, six pictures, two videos and eight shots, under
  `/default-domain/workspaces/acme-brand-assets`, in the folders `products`, `assets`, which holds
  the pictures and the videos, and `shots`. Two of the shots are missing, one per product.
- **Only there, and only its own.** Every document it writes carries `data.mjs`'s marker as its
  `dc:source`. Before anything is written it reads every place it would write, and a document there
  without the marker, or of another type, stops the run with exit 2, untouched. It creates no user
  and no group, and grants no permission: anyone who may read the workspace sees the kit.
- **Dates count from the day it runs.** One asset's rights end in 20 days, so its page shows the
  warning banner; one's ended 10 days ago; the others are clear. Run it again on the day of a demo.
- **Safe to run twice.** A record already there is put back to `data.mjs`'s values, dates
  included, and a trashed one at its place is restored. A picture already holding the same bytes is
  not uploaded again, nor a video. With `nuxeo-agentic-assets` installed, the kit's own rights
  refuse the originals of assets 503, 505 and 511 to every user, the seed's included: it cannot
  read them back to compare, so it says so and uploads those three again, and Nuxeo makes their
  views again, and transcodes the video again where it can.
- **It checks what it wrote:** last, that Nuxeo made each picture's views, which proves
  `AcmeAsset` is a Picture to it, that each video has the `Video` facet, which proves `AcmeVideo`
  is a Video to it, and that the four page providers return what it seeded, the library's
  aggregates included. Views and the index come a moment after the repository, so the checks are
  asked again, once a second, for up to `NUXEO_INDEX_WAIT_MS` (60 seconds).
- **It says what the server made of the videos,** and does not check it: their facts, their
  transcoded videos and their storyboards, which Nuxeo makes with ffmpeg a while after the upload,
  or, on a server without it, none (above, "The videos").
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met: no
  credentials, no server, credentials refused, the package not installed, no
  `/default-domain/workspaces`, or a document at one of its places that is not its own.

Its controls run with Node alone, against a stand-in for the REST API it calls, so they prove the
script, not the server:

```bash
node business-apps/packages/brand-assets-demo/demo/seed.selftest.mjs
```

### Seeing it under `nx serve`

Installed on a server, the app reads its layouts from `/nuxeo/agentic-ui-config/`, which the
package fills. Under `npx nx serve nuxeo-ui` it reads `/agentic-ui-config/` on its own port instead,
which `npm run config:dev` writes. This serves the kit's layouts, menu, queues and labels there,
from the repository's root:

```bash
C=business-apps/packages/brand-assets-demo/bundle/agentic-ui-config && npm run config:dev -- --layout AcmeAsset/view=$C/layouts/AcmeAsset/view.layout.json --layout AcmeVideo/view=$C/layouts/AcmeVideo/view.layout.json --layout AcmeProduct/view=$C/layouts/AcmeProduct/view.layout.json --layout AcmeShot/view=$C/layouts/AcmeShot/view.layout.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/library.json --queue $C/queues/products.json
```

Then start the dev server, or restart it: it serves only the files that were there when it
started.

```bash
npx nx serve nuxeo-ui
```

### Previewing the asset page before the package is installed

With no kit type on the server, the seed's `--preview` writes the six pictures as the platform's
own `Picture`, under the workspace's `preview` folder, with their titles, rights end dates and
rights holders:

```bash
node business-apps/packages/brand-assets-demo/demo/seed.mjs --preview
```

and `config:dev` serves the kit's asset layout for `Picture`, on this development server only:

```bash
C=business-apps/packages/brand-assets-demo/bundle/agentic-ui-config && npm run config:dev -- --layout Picture/view=$C/layouts/AcmeAsset/view.layout.json --labels en=$C/labels/en.json
```

Each picture then shows its banners, its views, its title, its rights end date and its rights
holder, and its history. The kit's own fields are left out, since a Picture has no `acmeasset`
schema, and the console says so for each. Only for a look: the product page, the queues and the
demo need the package.

## Running the demo

As a steps file of the beta harness
([`scripts/beta-harness/README.md`](../../../scripts/beta-harness/README.md)), end to end:

1. a rights-ending banner on a live asset, above its picture views, the original file not
   downloaded: phase 5's demo step 1;
2. the other banner on an asset whose rights have ended, and none on cleared rights; then the
   cleared asset's Annotations tab, which downloads its original once, the control for "not
   downloaded";
3. the library, its Rights facet counted from the aggregate, and narrowed by it on the server;
4. a product page: its shots, and the shot it is still missing;
5. the layout files behind the pages: configuration, no code.

**The plan's demo step 2, the print rendition refused by the server,** is its own steps file,
[`brand-assets-rights.mjs`](../../../scripts/beta-harness/steps/brand-assets-rights.mjs), since
it needs `nuxeo-agentic-assets` installed with the kit:

1. in the app, asset 503's print view chosen: the server answers 403, and the page says the
   server's reason, with no view hidden or disabled;
2. the REST API called directly, outside the app: the print view, the print rendition, the same
   file through `/nxfile/` and the original refused, and asset 505's web view, its rights ended;
3. what the rights cover still served: the cleared asset's print view, print rendition and
   original, asset 503's web view and preview, asset 505's preview, and the cleared asset's print
   view shown in the app.

```bash
NUXEO_USER=<user> NUXEO_PASS=<password> npm run beta:evidence -- brand-assets-rights
```

`NUXEO_URL` names Nuxeo if it is not on `http://localhost:8080`: the REST API is called there,
not through the dev server. **Not run:** nothing installs the add-on or the kit yet.

The plan's demo step 3, a share link, has no steps file yet: once the add-on 0.2.0 and this kit
0.2.2 or later are installed, it is run by hand as the
[add-on's README](../../../nuxeo-agentic-assets/README.md#installing-it-on-a-local-nuxeo) says,
after the share links' security review. Step 4, the review, is the next section's.

**What it needs:** the package installed and seeded today (above), the dev server serving the
kit's files (above), Playwright (`scripts/beta-harness/README.md`, "Prerequisites"), and no asset,
shot or product on the server that the seed did not write, since it counts exactly.

```bash
NUXEO_USER=<user> NUXEO_PASS=<password> npm run beta:evidence -- brand-assets-demo
```

`APP_URL` names the dev server if it is not on `http://localhost:4200`. The evidence goes to
`~/Desktop/agentic-ui-evidence/beta/brand-assets-demo/`, outside the repository. **Not run end to
end:** on the local server, before it had the package, it stopped at its first precondition, with
exit 2, as it should. This README records no run since 0.1.0 was installed there. From 0.2.3 the
library it counts holds the two videos too.

### The videos

As a steps file of its own,
[`brand-assets-video.mjs`](../../../scripts/beta-harness/steps/brand-assets-video.mjs), which needs
the kit 0.2.4 and `nuxeo-agentic-assets` 0.3.0 installed, and reads what the server made of the videos
to check the branch it is on, and says which:

1. the cleared video's page: its player plays it from a blob URL, the transcoded web cut where the
   server made one, else the original, and the browser reads it as a video of its length; its
   facts, or the page's word that the server read none; and, at 4 seconds, the page's word that
   the server made no storyboard;
2. the video with no Print channel: where the server transcoded it, its web cut plays, with its
   storyboard, whose last frame moves the player; where it did not, its original is refused with
   403, and the page says the server's reason, with no player;
3. the REST API called directly: that original refused through `@blob` and `/nxfile/`, and through
   `Video.Slice`, which reads it, the cleared video's served; where the server transcoded them,
   each video's transcoded files decided by their conversions' names, through `@rendition` and at
   their places through `@blob` alike;
4. the library: both videos listed among the pictures, the Type facet counting them, and narrowed
   to them on the server.

```bash
NUXEO_USER=<user> NUXEO_PASS=<password> npm run beta:evidence -- brand-assets-video
```

**Not run:** no server has the kit 0.2.3 or later. On the local Nuxeo, which has 0.2.0, it stops at
its first precondition, the `AcmeVideo` type, with exit 2.

### The review: phase 5's demo step 4

As a steps file of its own, which writes only what it creates: it draws a picture with
`demo/png.mjs`, creates an asset from it in a folder of its own, and trashes the folder when it
ends, whatever happened. The seeded records are not touched.

1. a pin placed by clicking the picture, with a note, drawn where it was clicked and listed beside
   the picture; choosing it in the list highlights it on the picture;
2. round 1 closed and round 2 opened, round 1's pins still there, marked as past;
3. a pin placed with the keyboard alone, and the pins reached with the arrow keys;
4. the REST API's annotations, the same pins after a reload, and each pin on its point on a view
   of another size;
5. a reader, offered no pin, and a holder of `Comment`, offered a pin and not Close round: the
   record's permissions answered in the browser, since the kit has no people. Hiding the control is
   not the control: Nuxeo 2025 accepts an annotation from anyone who may read the asset.

**What it needs:** the dev server serving the kit's asset layout for the type it uses: `AcmeAsset`
where the package is installed, else the platform's `Picture` (the README's two `config:dev`
commands above); Playwright; picture conversion on the server; and `NUXEO_USER` and `NUXEO_PASS`,
someone who may create a folder and a picture and change it, so that Close round is offered. It
creates a workspace of its own under `/default-domain/workspaces`, or works in a folder of
`REVIEW_WORKSPACE`, a workspace path, when that is given.

```bash
NUXEO_USER=<user> NUXEO_PASS=<password> npm run beta:evidence -- brand-assets-review
```

**Run on the local Nuxeo 2025.10.18 (25 November 2026),** under the dev server, with the asset
layout from `config:dev` and the stand-in model's `AcmeAsset` from the package's 0.1.0, which was
already installed there: 30 of 30 checks passed, in a test workspace's folder, trashed at the end.

## What was checked, and how

- **The package pipeline** builds it, with and without its content model, and refuses a copy whose
  asset layout puts a `date` widget on a text property, given the model. Version 0.2.0 was held to
  0.1.1 on the staging branch with `--previous`: its three changes, the rights component, the
  manifest and `package.xml`'s new dependency, are "to judge", which the pipeline sees as a patch,
  and 0.2.0 raises the minor, as a package newly needing an add-on should.
- **0.2.1 names its schemas' sections in the Properties panel:** a product's heading was
  "Acmeproduct", its schema's name made readable, in a browser walkthrough of 0.2.0, since the
  labels gave it none. The labels now name the three, `layout.schema.acmeasset`, `acmeproduct` and
  `acmeshot`, "Asset", "Product" and "Shot" (app-definition-v2.md, section 7), and
  `kit-schema-labels.spec.ts` in `libs/shared/document-layouts` fails a kit that leaves one out.
  Held to 0.2.0 on the staging branch with `--previous`: three labels added, a patch. Not seen on a
  server yet.
- **0.2.2 turns the share links on:** held to 0.2.1 on the staging branch with `--previous`, its
  two changes, the asset layout's share links and `package.xml`'s dependency raised to
  `nuxeo-agentic-assets` 0.2.0, need a patch, and the upgrade check,
  `npm run app-upgrade -- --since origin/staging/enterprise-grade-app`, keeps every configuration.
  The share links were first numbered 0.2.1, before the labels took that version on the staging
  branch.
- **0.2.3 adds the videos.** Held to 0.2.2 on the staging branch with `--previous`, and its four
  layouts to its content model: two labels and a layout added, the library changed, and the
  manifest, the configuration and stand-in model, the search schema and the new video rights
  component to judge, a patch; the upgrade check keeps every configuration. `content-model.json`'s
  `AcmeVideo` is the local Nuxeo 2025.10.18's `Video`, exported read-only with
  `npm run app-package:model`, its facets and schemas, `video` and `files` among them, as it
  answered them, with `acmeasset` added. Not installed on a server: no video page has run on one.
  The videos were first numbered 0.2.2, before the share links took that version on the staging
  branch.
- **0.2.4 decides every storyboard frame by one rule,** `<storyboard preview="true" />` in place of
  nine `<blob>` rules, and depends on `nuxeo-agentic-assets` 0.3.0, which reads it. Held to 0.2.3
  on the staging branch with `--previous`: the video rights component and `package.xml` to judge,
  a patch; the upgrade check, `npm run app-upgrade -- business-apps/packages/brand-assets-demo
--since origin/staging/enterprise-grade-app`, keeps every configuration. Not installed on a
  server.
- **The rights policies,** `brand-assets-demo-rights.xml` and `brand-assets-demo-video-rights.xml`,
  are read by `nuxeo-agentic-assets`'s own tests, through XMap as the runtime reads a
  contribution, and decide the demo's uses as this README's tables say; giving `OriginalJpeg`
  another channel turns them red, and so does giving `MP4 480p` the Print channel.
- **The seed's controls,** `demo/seed.selftest.mjs`, hold against the stand-in: 107 of them, the
  videos' among them, each of those seen failing with its guard broken on purpose.
- **On the local Nuxeo 2025.10.18, before it had the package:** the seed stops with exit 2 and writes
  nothing; `--preview` wrote the six pictures into the kit's workspace, twice, the second time
  updating and uploading nothing, and Nuxeo made each one's views. In headless Chromium, under the
  dev server with the preview's `config:dev` above, the asset page showed the warning banner on the
  ending picture, the negative one on the ended picture and none on a cleared one, each picture's
  Medium view from a blob URL, and the kit's cards with the Picture's own fields; it did not
  download the original until the Annotations tab was opened, and against a build with that
  hold-back turned off on purpose, the same check saw the download and failed; and with the
  browser's clock pinned 25 days on, and then 380, the banners moved as the dates say.

## Not done yet

- **Versions 0.1.1 to 0.2.4 are not installed anywhere,** and 0.1.0 and 0.2.0 only on a local
  server, not a shared one: the review was seen with its layout from `config:dev`, and the
  product page, the queues, the full seed and the demo have not run on a shared server. No video
  page has run on a server, and the videos' steps file has not run past its first precondition.
- **The videos are not transcoded on the local server,** which has no ffmpeg: there a video's page
  plays its original, reads no facts and shows no storyboard, and the transcoded web cut and the
  storyboard have not been seen on a server.
- **A video is fetched whole before it plays:** there is no streaming, so a long original is a long
  wait, and the page offers no choice among a video's transcoded files: it plays the first the
  browser can.
- **A reference shows its stored value:** a shot's asset is its document id, until the
  `document-link` widget has its lookup, and an asset's product is its style number, not a link to
  the product.
- **The library is a list, not a grid of previews,** as the prototype draws it: a queue's cells are
  one line of text.
- **No home:** it is out of this version's scope. **Share links have not run on a server,** nor
  has their demo step, the plan's step 3, a steps file of its own: not written. A
  banner is not a control: refusing a download whose rights have ended is the server's, which
  `nuxeo-agentic-assets` does at the platform's download endpoints, on the local server only, at
  0.1.0, and waiting for its security review.
- **Regions are not weighed:** `acmeasset:regions` is free text, and no rule reads it.
- **The review is not held to who may review on the server:** Nuxeo 2025 takes a pin, or a round's
  close, from anyone who may read the asset, whatever the page offers.
- **The review moves or removes nothing, and reopens no round.** Each pin is also one of the
  asset's comments, which the Comments panel lists, and where Nuxeo lets a comment's author, or an
  administrator, edit or delete it: editing its text there keeps it a pin, on its place and round.
  Deleting a round's close renumbers the rounds after it.
- **A pin does not say which file it was placed on:** replace the asset's picture, and every pin
  shows on the new one.
- **The banner's message names no date:** labels have no placeholders yet, so the rights card shows
  the day.
- **The seed's and the demo's controls are not in CI:** the selftest needs Node alone and could be,
  but no workflow runs it yet; the demo needs a server and a dev server, and runs by hand.
