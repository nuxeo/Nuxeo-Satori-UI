# nuxeo-agentic-assets: an asset's rights, share links, watermarks and review, enforced on the server

The assets module's server add-on ([development plan](../docs/business-apps/development-plan.md),
phase 5, "The rights and sharing add-on"), version 0.5.0: the rights, for pictures and videos,
share links, and, for phase 9's media rights, territories, release windows, localised versions and
delivery packages; since 0.5.0, the watermarks a rights policy requires, phase 9's last build, and
an asset's review decided on the server, phase 5's. A Maven
module beside `nuxeo-agentic-core`, with its own Marketplace package, `nuxeo-agentic-assets`.
Publishing to channels and outside users are not built.

**Built against two open decisions.** Decision B, the packaging of the server tier, follows its
recommendation, "`nuxeo-agentic-core` for the runtime essentials; one add-on per domain module".
Share links follow decision C's recommendation, "Share links in phase 5, invited outside users in
phase 8" ([decisions.md](../docs/business-apps/decisions.md)): links, and no outside user. Decision
F, token sign-in, is not touched: no sign-in changes for anyone.

**Share links are a security control and a new path that needs no sign-in.** Neither half may be
relied on before its security review (below, "For the security review"). Nothing here is installed
anywhere: it was built, tested, and checked against the server's own jars, read only.

## The short version

- **It refuses, on the server, for every user, administrators included,** an asset's original, a
  picture view, a rendition, a video's transcoded video or a frame of its storyboard that the
  asset's rights do not cover: once its rights end day has passed, or when its channels do not hold
  the channel that covers that use. A preview is served whatever the rights. A use its policy does
  not list is refused. A transcoded video is decided by its conversion's name, whether the
  download endpoints or the video operations are given its name or its place.
- **Through the platform's own download permission,** the `permissions` point of
  `org.nuxeo.ecm.core.io.download.DownloadService`, which the platform asks before it streams a
  blob. So `/nxfile/` and the REST API's `@blob`, `@rendition` and `@preview` answer 403 to any
  client that calls them, and `Blob.BulkDownload` leaves a refused asset out of its zip.
- **The platform's `Video.*` operations ask the same rights.** Each is replaced by one of the same
  id, parameters and answers, which decides the video it reads as a download of that file, refuses
  it with 403 when the rights do not cover it, and otherwise runs the platform's own (below, "The
  video operations").
- **Not yet every path.** Other Automation operations that return a document's blob, or a
  conversion of it, hand it over without naming the document to that permission, and so are not
  refused; nor is what another add-on serves from its own endpoints. Until the security review
  settles them (below, "What it does not cover"), this is a control on the download endpoints and
  the video operations, not on every API.
- **It says why,** through a document enricher, `assetRights`: the decision for each use, with a
  reason code a client translates. The enricher explains; the permission refuses.
- **It enforces nothing on its own.** A package contributes a rights policy for its document type;
  the brand assets kit contributes one for `AcmeAsset`
  ([its README](../business-apps/packages/brand-assets-demo/README.md), "Rights on the server").
- **Share links** (below, "Share links"): a user who holds `WriteSecurity` on an asset, and is an
  administrator or in a group the server names, makes a link to some of its picture views, and its
  original where its rights allow, until a last day in UTC.
  Anyone with the address opens it, without signing in, at `/nuxeo/agentic-share/`, and gets those
  items only, watermarked on the server, while the link is neither revoked nor past its day and the
  asset's rights still allow each one. Every download is logged, with the time, the link and the
  item. The token is 256 bits; the server keeps its SHA-256 only.
- **Media rights** (below, "Media rights: territories, windows and deliveries"), since 0.4.0: a
  policy may read where an asset may be delivered and its release windows, per territory and
  channel, and a localised version may read its film's windows. A use is then refused outside them,
  at the same endpoints and in the same way as an ended right: `territory-not-covered` and
  `outside-window`. A `MediaDelivery`, a distributor's delivery of a localised version to a
  territory, is filed as a document; the server chooses its files by the version's policy, and
  refuses it whole when any is outside its window or territory. A policy that names neither is
  decided as before.
- **Watermarks** (below, "Watermarks"), since 0.5.0: a policy may require a mark on previews,
  downloads or a delivery's files, for everyone or for users outside named groups, with its own
  text and placement, naming the reader or the distributor. The unmarked file is then refused at
  the download endpoints, `watermark-required`, and `Asset.GetWatermarked` serves it marked: a
  picture drawn on the server in Java, a video through the platform's video tools, which need
  ffmpeg. Where it cannot be marked, it is refused, never served unmarked. A delivery records each
  file it marked, for whom, and holds it marked.
- **The review, held on the server** (below, "The review held on the server"), since 0.5.0:
  sending a round back, approving and rejecting an asset's review need the add-on's permission,
  `ReviewAsset`, granted on the asset to a member of a reviewer group the review policy names.
  Anyone else is refused, 403, with the reason; administrators are not exempt. Each decision is in
  the platform's audit. A pin is still anyone's whom Nuxeo lets comment.

## What it refuses, and how

For a document of a type a policy covers, each download is first named as a use:

| The download                                                                                                                                                        | The use                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The policy's original xpath (`file:content` unless it names another); `blobholder:0` or the `mainBlob` rendition when the blob it returns has the original's digest | the original                                      |
| `blobholder:0` or `mainBlob` returning another blob, such as `file:content` when the original is an attachment                                                      | that blob or rendition, never listed by the alias |
| `picture:views/<n>/content`, with `n` written plainly                                                                                                               | the view, by its title                            |
| `vid:transcodedVideos/<n>/content`, with `n` written plainly                                                                                                        | the rendition of its conversion's name            |
| `vid:storyboard/<n>/content`, with `n` written plainly, a frame the document has                                                                                    | the storyboard: one use for every frame           |
| A rendition, by the name the platform passes                                                                                                                        | the rendition, by name                            |
| Any other xpath                                                                                                                                                     | that blob, by its xpath                           |
| No xpath: the document's main blob, by its digest                                                                                                                   | the original                                      |
| Anything else, such as a view's place the document does not have, or a transcoded video's with no name                                                              | unknown, so never listed                          |

Then decided, the first that applies winning:

| In this order                                                                        | Answer | Reason code             |
| ------------------------------------------------------------------------------------ | ------ | ----------------------- |
| The policy has no rights end or no channels: it is broken                            | 403    | `policy-error`          |
| The policy does not list the use                                                     | 403    | `not-cleared`           |
| The policy marks the use a preview                                                   | served | `preview`               |
| The rights fields cannot be read, or are not a date and text                         | 403    | `policy-error`          |
| The rights end day has passed: from the day after it, in UTC                         | 403    | `rights-ended`          |
| The asset's channels do not hold the channel covering the use                        | 403    | `channel-not-covered`   |
| Under a policy with territories: none the asset may go to                            | 403    | `territory-not-covered` |
| Under a policy with territories: no window open for the use's channel in any of them | 403    | `outside-window`        |
| Since 0.5.0: a use served so far that the policy's watermark marks for this reader   | 403    | `watermark-required`    |
| Otherwise                                                                            | served | `cleared`               |

- **The watermark comes last,** since 0.5.0: a use either row serves, a preview or one cleared, is
  then held to the policy's watermark for the person downloading, and refused unmarked when it marks
  it for them (below, "Watermarks"). It never serves what a row before it refuses.

- **A video's files.** A transcoded video at its place, `vid:transcodedVideos/<n>/content`, is the
  rendition of the name at `vid:transcodedVideos/<n>/name`, the name the platform's video rendition
  provider serves it under through `@rendition`: so one `<rendition>` rule decides a conversion
  through `@rendition/<name>`, `@blob`, `/nxfile/` and `@preview` alike, whichever place it has.
  The platform appends a conversion when it finishes, and two run at once, so a place names no
  particular one. Every frame of the storyboard is one use, decided by the policy's
  `<storyboard>`, however many frames the server is configured to make.
- **A version or a proxy has its live document's rights.** A version keeps the fields it had when
  it was made, so rights narrowed since would not reach it: the rights are read from the live
  document, with a privileged session, since a reader of a proxy may not read the live document.
  Its views and its original are still the version's own. One with no live document is refused.
- **A container holding a covered asset is refused its renditions, but its thumbnail.** A folder's
  `zipTreeExport`, or a collection's `containerDefaultRendition`, holds the bytes of each document
  in it, under the container's own type, which no policy covers, and goes into a folder or a
  collection it meets. So a rendition of a folder, or of a collection, is refused, code
  `contains-assets`, when the reader's own session finds below it, or among its members, a
  document of a covered type, a collection, or, among a collection's members, a folder. That
  refuses more than it must: a collection with no asset in it refuses its folder's export, and a
  workspace or a domain holding assets refuses its every rendition, its metadata-only `xmlExport`
  included.
- **A preview is decided without reading the rights fields,** so a mistake in them refuses the
  uses they decide and leaves the thumbnails alone.
- **A mistake refuses.** A use with both a channel and `preview="true"`, or neither, is refused,
  whatever other declaration of the same use comes before or after it; a use listed twice as a
  channel and a preview keeps the channel, and listed twice with two channels keeps the first; a
  policy with no type is left out. Each mistake is logged as an error when the policy registers.
- **A failure refuses.** The script the platform runs only hands its globals to
  `AssetRightsDownloadPermission`, inside a `try` that answers `false`; the Java never throws, and
  answers `false` when the service is not running. The platform reads a permission that throws, or
  answers anything but a boolean, as not refusing: neither can happen here. **When the add-on
  cannot run at all,** its class not loading or its service not started, that `false` comes before
  any type is read, so every download on the server is refused, not only assets'.
- **Channels match as written, after trimming:** case counts, so `print` is not `Print`.
- **Every refusal is logged** at `INFO`, with the document, its type, the use, the user, the
  platform's reason and the code.
- **A document of a type no policy covers is not refused here,** but for a container's rendition
  above, and while the add-on runs; nothing of it is read but its type, and, for a rendition, whether
  it is a folder or a collection. Nor is a download that names no document: the platform hands some
  blobs over that way.

### The video operations

`nuxeo-platform-video`'s Automation operations read a document's video and answer what they made of
it: `Video.Slice` and `Video.SliceInParts` a cut, `Video.Concat` a join, `Video.AddWatermark` the
video with a picture drawn over it, `Video.ExtractClosedCaptions` its captions. The platform's
download service is not asked for any of them. So this add-on contributes five operations of the
same ids, `replace="true"`, after the platform's (`OSGI-INF/asset-rights-video-operations-contrib.xml`):

- **Each decides first,** for every document it is given, the file the platform's operation will
  read, as a download of that file is decided: the blob at its `xpath`, or, with none, the
  document's main blob, which is the original when it has the original's digest. So
  `Video.Slice` of an asset without Print is refused, and of its `MP4 480p` at its place, on an
  asset with E-commerce, is served. `Video.AddWatermark` decides the watermark document's
  `file:content` too, which the platform draws into the video it answers. A list, for
  `Video.Concat` or any operation given several documents, is refused whole when one is.
- **A stored file is decided for the assets that hold it,** whether it is given as the input or
  read from a document of a type no policy covers. A blob with a key in the blob store is looked
  for, with the system's rights, in every blob field of the covered types' schemas and of every
  facet's, and each covered document holding it is decided at each place it holds it, as a
  download there is; a file held by more than 100 such documents is refused. The blob store keeps
  one file per content, so the same bytes stored for a document no policy covers are refused as
  the asset's are, which refuses more than it must, never less.
- **A refusal is a `DocumentSecurityException`,** 403, logged at `INFO` as a download's is, with
  the operation's id. A document of a type no policy covers is not refused here, unless its file
  is a covered asset's, nor a blob stored for none, nor one not stored at all, such as an upload.
  With the add-on's service not running,
  every one of the five is refused, whatever its input.
- **Then the platform's own operation runs,** given the same parameters, so its behaviour is the
  platform's: the replacements declare each parameter as the platform's class does, since
  Automation reads only the parameters a class declares itself, and hand them to an instance of
  it. `BundleTest` holds each replacement to the platform's class: the id, every parameter's name,
  type, `required` and values, and every input, answer and collector.
- **On a server without `nuxeo-platform-video`** the component waits for the platform's and
  replaces nothing.

### Administrators

**Not exempt.** No line of the rights' decision reads the user or their groups; since 0.5.0, a
policy's watermark reads the person's groups, to exempt a member of one it names from a mark, and
for nothing else, and an administrator is marked as anyone else is; a review decision needs a
reviewer group and `ReviewAsset`, which an administrator holds only when granted (below, "The
review held on the server"). Where the platform makes an exemption unavoidable:

- **An administrator controls the server's configuration:** they can install a package that
  replaces or disables a policy, remove the add-on, or run code on the server, which no add-on can
  refuse.
- **Whoever may write an asset may write its rights.** The decision trusts the asset's rights end,
  channels and view titles as the document holds them. Who may change them is the model's and the
  permissions' business, not this add-on's, and a reader who may create documents somewhere can
  make a copy of an asset and write the copy's (below, "What it does not cover").
- **Server code that reads a blob is not a download,** and is not refused: making picture views,
  conversions, indexing, workers.

### The extension points, and how they were checked

Read from the Nuxeo LTS 2025.10.18 server in the local Docker container, read only: the jars of
`/opt/nuxeo/server/nxserver/bundles` and `nxserver/lib` copied out with `docker cp`, then
`unzip -p` and `javap -c`. Nothing was installed, restarted or written to the server.

- **`DownloadService`, point `permissions`** (`nuxeo-core-io`, `OSGI-INF/download-service.xml`):
  a `<permission name>` with a `<script>` defining `run()`. `DownloadServiceImpl.checkPermission`
  evaluates each permission in a new engine, from the component's one `ScriptEngineManager`, for
  the script's language, `JavaScript` by default, with the globals `Document`, `XPath`, `Blob`, `Reason`, `Infos`,
  `Rendition` and `CurrentUser`; `Boolean.FALSE` from any one refuses. `downloadBlob` then answers 403. A `ScriptException` or a result that is not a boolean is logged and the download goes on.
- **The engine:** `nashorn-core-15.7.jar` in `nxserver/lib`; no `nashorn.args` in `nuxeo.conf`
  restricts Java from scripts. The tests run the contributed script through Nashorn 15.7 the way
  `checkPermission` does.
- **A video's files and operations,** from `nuxeo-platform-video` 2025.10.18:
  `VideoRenditionDefinitionProvider` names each rendition of a video by its transcoded video's
  name; `VideoConversionWork` removes a conversion's entry and appends the new one at the end, and
  the `videoConversion` queue runs two at a time; the five `Video.*` operations, in
  `video-tools-operations-contrib.xml`, have the fields and methods their replacements copy, and
  read the file as above. Automation's `OperationTypeImpl` reads a class's own declared `@Param`
  fields only, and the automation component lets `replace="true"` replace an operation of the
  same id.
- **Who passes the document:** `DownloadServlet` (`/nxfile/`) through `handleDownload`; the REST
  API's `BlobObject` (`@blob`) through `DocumentBlobHolder`, and `PreviewAdapter` (`@preview`), with
  the document and the xpath; `RenditionObject` (`@rendition`) with the document and the
  rendition's name as the extended information `rendition`; `BulkDownload` with the document, no
  xpath and its main blob, and it leaves a refused document out of its zip rather than answering
  403; CMIS's content stream with the document and the xpath.
- **Versions and containers:** a Picture is versionable, and a version holds its own copy of the
  rights fields; the `zipTreeExport` rendition, on folders, exports the tree with each document's
  blobs, and `containerDefaultRendition` zips a container's or a collection's documents.
- **No other permission is contributed** by any bundle on that server, so before this add-on the
  platform's check returned at once; it now evaluates this script for every download.
- **What a Picture's blobs are:** `PictureBlobHolderFactory` gives `file:content` as its main blob,
  and `PictureBlobHolder.getBlobs` adds the views after it; the stock picture conversions are
  `Thumbnail`, `Small`, `Medium`, `FullHD` and `OriginalJpeg`, each also a rendition; the
  `mainBlob` rendition definition is the main blob.
- **The rendition service's own filters** (`renditionDefinitions` and
  `renditionDefinitionProviders` filters, through the action service) were read and not used: they
  decide whether a rendition is offered for a document, with no rendition name in their context,
  and a refusal there is a "not available" error with no reason a client could show.
- **Compiled and tested against those jars:** the module's sources and tests compile against the
  server's own 2025.10.18 jars in place of the 11.5 ones Maven resolves, and all 63 tests pass
  there. For 0.3.0 the module's sources were compiled against them again, the video operations
  included; the tests run on 11.5's, whose five video operations have the same fields and methods.

## What it does not cover

- **It decides the downloads the platform's download service is asked for with their document,
  and the platform's `Video.*` operations.** A blob the platform hands over without naming its
  document to that service, such as another Automation operation's result, and a blob another
  add-on serves from its own endpoint, are not decided here. Which of those must be closed, and
  how, is the security review's first question.
- **Who may write the rights.** A user who may read an asset and create a document somewhere, in
  their own workspace for one, can copy the asset there, write the copy's channels or rights end,
  and download the copy. Refusing that needs the rights fields written only by a rights manager,
  copies included, which this version does not do.
- **Publishing to channels and outside-user invitations** are the rest of the plan's rights and
  sharing add-on: not built. Share links are (below), with what they do not cover listed there.
- **Regions, embargoes and the asset's lifecycle state,** which the prototype also weighs, are not
  read for the brand assets kit: its stand-in model has regions as free text and no asset
  lifecycle. Territories and release windows are read for a policy that names them, since 0.4.0
  (below, "Media rights"); a policy that does not is decided as before.

## The policy

Contributed to `org.nuxeo.agentic.assets.rights`, point `policies`, by a component that requires
`org.nuxeo.agentic.assets.rights`:

```xml
<policy type="AcmeAsset">
  <rightsEnd xpath="dc:expired" />
  <channels xpath="acmeasset:channels" />
  <original channel="Print" />
  <view name="Medium" preview="true" />
  <view name="FullHD" channel="E-commerce" />
  <view name="OriginalJpeg" channel="Print" />
  <rendition name="thumbnail" preview="true" />
  <rendition name="OriginalJpeg" channel="Print" />
  <blob xpath="files:files/0/file" channel="Print" />
</policy>
```

A video's, as the brand assets kit's for `AcmeVideo`:

```xml
<policy type="AcmeVideo">
  <rightsEnd xpath="dc:expired" />
  <channels xpath="acmeasset:channels" />
  <original channel="Print" />
  <rendition name="MP4 480p" channel="E-commerce" />
  <rendition name="WebM 480p" channel="E-commerce" />
  <view name="StaticPlayerView" preview="true" />
  <rendition name="thumbnail" preview="true" />
  <storyboard preview="true" />
</policy>
```

- `rightsEnd` names a date property: its day in UTC is the last day the rights cover, and an empty
  one sets no end. `channels` names a text or list property.
- One policy per type, the exact type: a subtype is not covered by its parent's policy. A later
  policy for the type replaces it whole; `enabled="false"` removes it.
- A picture view and the rendition of the same name are listed apart, because they are two
  addresses for one file.
- A video's transcoded video is listed once, as a `<rendition>` by its conversion's name, which
  decides it at its place too. `<storyboard>`, with a channel or `preview="true"`, decides every
  frame of the storyboard; with none, every frame is refused. A `<blob>` at a transcoded video's
  or a frame's place is left out, and logged, since that place is decided by name.

## The `assetRights` enricher

Ask with the header `enrichers.document: assetRights`. For a document no policy covers it writes
`"assetRights": null`. Otherwise its `type`, the server's `today`, the `rightsEnd`, whether it has
`ended`, the `channels`, which are `null` for a proxy, whose live document a reader may not
read, then `uses`: the original, each picture view the document has by its
title, a video's transcoded videos as renditions by their conversions' names, each rendition and
blob the policy lists, and a video's storyboard, `"use": "storyboard"`, with no name, each with `allowed`, `reason`, and the
`channel` that covers it when there is one, and `rightsEnd` when that is the reason; and
`otherwise`, the answer for any use not listed. The client reads it in
`libs/shared/nuxeo-client/src/lib/utils/asset-rights.ts`, and asks for it only after a 403.

Under a policy with territories, two more fields follow `channels`: `territories`, and `windows`,
each `{ territory, channel, from, until }`; both `null` where `channels` is, and `windows` `null`
too when the policy reads them from another document, such as a localised version's film, which
the asset's reader may not read. A download names no territory, so the enricher's decisions are a
download's. **The client does not translate `territory-not-covered` and `outside-window` yet:** it
reads a use with a reason it does not know as not listed, so an asset page of a picture or a video
under such a policy would say "not cleared". No kit has one: the media kit's versions are records
with attachments.

Since 0.5.0, the decisions are the reader's: a use the policy's watermark marks for them is written
`"allowed": false, "reason": "watermark-required"`, with its channel, and the same use is the
download it is for a member of an exempt group. The client reads `watermark-required` and
`watermark-unavailable`, and, on a picture view refused `watermark-required`, asks
`Asset.GetWatermarked` for it marked (below, "Watermarks").

## Media rights: territories, windows and deliveries

Phase 9's "Media rights and distribution: territories, release windows, localised versions, delivery
packages, watermarks" ([development plan](../docs/business-apps/development-plan.md)), and its demo
step 1, "A localised film delivered to a distributor inside its window, and refused outside it".
Since 0.4.0. The media kit, [`media-demo`](../business-apps/packages/media-demo/README.md), is its
app. Built against decision B's recommendation, in this add-on, since media rights are an asset's
rights; decision 3 is not touched: a delivery is a document filed, which a listener decides, with no
Automation operation and no button.

### The policy

```xml
<policy type="FilmVersion">
  <rightsEnd xpath="dc:expired" />
  <channels xpath="fver:channels" />
  <territories xpath="fver:territories" />
  <windows xpath="film:windows" document="fver:film" type="Film" />
  <original xpath="files:files/0/file" channel="SVOD" />
  <blob xpath="files:files/1/file" channel="SVOD" />
  <blob xpath="files:files/2/file" channel="Marketing" />
  <rendition name="thumbnail" preview="true" />
  <delivery>
    <original />
    <blob xpath="files:files/1/file" />
    <blob xpath="files:files/2/file" />
  </delivery>
</policy>
```

- **`territories`** names a text or list property: where the asset may be delivered, matched as
  written after trimming, as channels are.
- **`windows`** names a complex list of release windows, each a `territory`, a `channel`, a `from`
  day and an `until` day, in UTC, both included; a window with no `until` stays open. A window with
  no territory, channel or first day, or one that ends before it opens, is a mistake: the rights
  cannot be read, and every use that needs them is refused, `policy-error`.
- **`windows document`** names a property of the asset holding the id of the document its windows
  are read from, and **`windows type`** the type that document must be: a localised version reads
  its film's. A `document` with no `type` is broken, so that no document of another type can lend
  its windows. The film is read with a privileged session, as a version's live document is, since
  the version's reader may not read the film. A document that is not there, not live, in the trash
  or of another type refuses, `policy-error`; the type must match exactly, so a subtype of `Film`
  is refused too.
- **A localised version is an asset of its own,** of its own type, with its own rights: its own
  territories, channels and rights end, and its own files. Its windows are its film's when its
  policy says so, the title's release schedule for each of its language versions.
- **One of `territories` and `windows` without the other** is broken: every use of the type is
  refused. A policy with neither is decided as before 0.4.0.
- **`delivery`** lists the files a delivery package carries, each named as its rule names it, an
  `<original />`, a `<view name>` or a `<blob xpath>`, and decided by that rule. A package in a
  policy with no territories, an empty one, one that names a use the policy does not clear for a
  channel, a preview, a rendition or the storyboard, or gives an entry a channel, `preview` or the
  original an xpath, refuses every delivery of the type; the policy's downloads are as they were.

### What it decides

After the rights end and the channel, as for any asset, under a policy with territories:

| A download, which names no territory                                  | A delivery, to a territory                                | Code                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| The asset may be delivered nowhere                                    | The asset may not be delivered to that territory          | `territory-not-covered` |
| No window for the use's channel is open in any territory it may go to | No window for the use's channel is open in that territory | `outside-window`        |

- **The same endpoints:** the download permission, so `/nxfile/`, `@blob`, `@rendition`, `@preview`
  and `Blob.BulkDownload`; the five `Video.*` operations; and share links, at their making and at
  every request, since each decides through the same decision. A window that closes refuses the
  next download and the next request through a link, as a rights end does.
- **A preview** is served whatever the windows, as whatever the rights end.

### A delivery package

A `MediaDelivery` (`OSGI-INF/media-delivery-types.xml`, schema `mdlv`) is filed wherever its filer
may add a document, over the REST API, naming the localised version by its id, the distributor and
the territory:

```json
{
  "entity-type": "document",
  "type": "MediaDelivery",
  "name": "fr",
  "properties": {
    "mdlv:version": "<the version's id>",
    "mdlv:distributor": "Acme Distribution France",
    "mdlv:territory": "FR"
  }
}
```

`DeliveryListener`, synchronous, before the document is created, in the filer's transaction:

1. the version is read with the filer's own session: one they may not read, or that is not there,
   is refused alike, 403 `version`; a proxy, a version of a document or one in the trash, 409;
2. the version's policy chooses the files, its `<delivery>`; no policy, no package or a broken one
   refuses, `not-cleared` or `policy-error`;
3. each file is decided for the delivery's territory, by its rule's channel, as above, and must be
   on the version with a digest, else `no-such-file`;
4. **refused whole** when any file is refused: 403, its code the first refused file's reason, its
   message each refused file's, such as `The delivery to BE is refused whole: blob files:files/2/file
outside-window for Marketing.`, and nothing is made;
5. otherwise the server writes the record, over anything the filer wrote there: the version, the
   distributor and the territory, trimmed; each file, its use, name, channel, file name, type,
   length and digest; when, in UTC, and by whom. A blank title becomes `<distributor>, <territory>`.

**Kept:** a change to the record's `mdlv` properties is refused, 403 `kept`, whoever asks; its
title and description are Nuxeo's to allow. So are a copy, an import, a check-in and a restore; and
a move, a trash and a deletion, but an administrator's. A folder holding a delivery is not removed,
moved, trashed or copied but by an administrator either: the platform does those to a folder's
documents with no event of their own, so the listener asks, with the system's rights, whether a
delivery is below the folder. `MediaDelivery` has no Versionable facet, so a check-in and a
restore, which the listener refuses, are not reached in the tests.

### What deliveries do not do

- **Hand the files over.** A delivery is the record of what was delivered: which files, by their
  digests, to whom, where and when. It serves none of the version's files, and holds none but those
  the version's watermark marks for deliveries, since 0.5.0, each marked for its distributor (below,
  "Watermarks"): whoever may read the delivery may download those, and only those.
- **Refuse the files to whoever filed a refused delivery.** A delivery is decided for its
  territory; a download names none, and is served while a window for its channel is open in any
  territory the version may go to. So a delivery to Germany refused before SVOD opens there leaves
  the version's master downloadable, at the download endpoints, by anyone who may read the version,
  while its SVOD window is open in Switzerland. Who may read a version is its permissions' business.
- **Make a share link.** Share links (below) serve watermarked pictures only, JPEG or PNG, and a
  film's master and subtitles are neither. A link bound to a delivery's territory and window, and
  serving its files, is not built; the download log, revocation and end date would be the links' own
  if it were.
- **Bound a version by its film's own rights end or channels.** A version's rights are its own; its
  film gives its windows only.
- **Hear what writes documents without events,** such as server code or an importer that bypasses
  them: what the listener does not hear, it does not decide.
- **Translate the new codes in the client** (above, "The `assetRights` enricher").

## Watermarks

Phase 9's last build, "watermarks" ([development plan](../docs/business-apps/development-plan.md)),
since 0.5.0. Built against decision B's recommendation, in this add-on, since a watermark is a
condition of an asset's rights, decided at the same endpoints. The media kit's policy has one
([its README](../business-apps/packages/media-demo/README.md)).

### The watermark in a policy

```xml
<policy type="FilmVersion">
  <!-- ... rightsEnd, channels, territories, windows, the uses and the delivery package ... -->
  <blob xpath="files:files/3/file" preview="true" />
  <watermark text="ACME PICTURES · FOR {recipient} · {user} · {day}" placement="tiled">
    <previews>
      <blob xpath="files:files/3/file" />
    </previews>
    <deliveries>
      <blob xpath="files:files/2/file" />
    </deliveries>
    <except group="media-rights" />
    <except group="media-distribution" />
  </watermark>
</policy>
```

- **Occasions:** `<previews>`, a use the policy marks as a preview, at the download endpoints;
  `<downloads>`, a use cleared for a channel, at the download endpoints; `<deliveries>`, a file of
  the policy's delivery package. Each marks the uses it names, each named as its rule names it, an
  `<original />`, a `<view name>`, a `<rendition name>`, a `<blob xpath>` or `<storyboard />`, and,
  naming none, every use of its occasion. At least one occasion.
- **Exempt:** a member of a group an `<except>` names gets previews and downloads unmarked.
  Nobody else, an administrator included, nor the system acting for no one, whose groups are the
  administrators'; the system acting for someone is that person, as the user directory has them. An
  `<except>` naming `members`, every user's group, or `administrators`, is left out. A delivery's
  files are marked whoever files it: they go to a distributor, not to the filer.
- **The text,** 1 to 200 characters, may name, in braces: `{recipient}`, the person downloading,
  or a delivery's distributor; `{user}`, the person downloading, or filing the delivery; `{day}`, the
  server's day in UTC; and `{territory}`, a delivery's, empty for a download. Each value is cut to
  100 characters, its control characters dropped, and drawn as pixels: it reaches no command line. A
  person is named by their user name. A watermark with `<deliveries>` must name `{user}`: the
  distributor's name is the filer's to write, so a mark naming it alone could name anyone, and a
  delivery's mark names who filed it too.
- **Placement:** `tiled`, across the whole picture at -30 degrees, light over dark, as the share
  links' mark, which is the default; or once, at the `center` or a corner, `top-left`, `top-right`,
  `bottom-left` or `bottom-right`, a margin from its edges.
- **A mistake breaks the policy,** so that every use of its type is refused, `policy-error`, rather
  than one served unmarked: a second `<watermark>`; no text, one over 200 characters, with a control
  character, a name in braces it does not know, or a brace that names nothing; a placement it does
  not know, or spelled otherwise than above; no occasion; an occasion naming a use the policy does
  not list for it, a channel's use among the previews, a preview among the downloads, a file
  outside the package among the deliveries; `<deliveries>` in a policy with no `<delivery>`, or with
  no `{user}` in the text. An `<except>` naming no group, everyone, `members` or `administrators`, is
  left out and logged: that marks more, never less. XMap reads only the elements it knows, so a
  misspelt occasion, such as `<download>`, is not read, and marks nothing.

### Where it is enforced

- **The download endpoints:** the download permission, so `/nxfile/`, `@blob`, `@rendition`,
  `@preview` and `Blob.BulkDownload`, refuse a use the watermark marks for the person downloading,
  403 `watermark-required`. The permission's script hands the platform's `CurrentUser` global to the
  decision; a download with no person is held to the mark, exempt from nothing.
- **The same file wherever it is held:** under a policy with a watermark, a download of a stored
  file is decided too at every place a document of a covered type holds the same file, read with the
  system's rights, as the `Video.*` operations decide a stored file. So a copy of an asset, whose
  views its copier may retitle or whose attachments they may reorder where they may write, serves
  nothing the asset it was copied from would mark, nor refuse. A file held by more than 100 such
  documents is refused.
- **A blob handed over with no document:** the platform writes an Automation operation's blob, such
  as `Document.GetBlob`'s, `Picture.GetView`'s or a stored rendition's, through the download service
  with no document. Such a blob, when it is a stored file, is decided for the documents of covered
  types that hold it, at each place they hold it, for the person downloading: so those operations
  hand over no file the rights or the watermark refuse. A blob that is not a stored file, such as a
  conversion an operation makes, is not decided (below, "What watermarks do not do").
- **The platform's `Video.*` operations** decide as a download with no person, so a video the
  watermark marks is refused to all of them, an exempt group's members included: what they answer
  would be the video unmarked.
- **The `assetRights` enricher** says `watermark-required` for its reader (above).
- **Share links** draw their own mark, naming the link, on every picture they serve, whatever the
  policy's watermark says; their items are decided by the rights, not by the watermark.

### `Asset.GetWatermarked`

An Automation operation, for a signed-in user, with the asset as its input and the use as `use`:
`original`, `view:<title>`, `rendition:<name>`, `blob:<xpath>` or `storyboard:<n>`. It answers the
file marked for the person asking, made then, never cached, so that a mark naming its reader is
served to no one else. In this order, the first that applies answering:

| In this order                                                                                                   | Answer                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| The use in none of the forms above                                                                              | 400                            |
| A broken policy                                                                                                 | 403, `policy-error`            |
| No policy for the type, no watermark, the use not listed, or not marked by the watermark on its occasion        | 404: download it as it is      |
| The rights, as a download of the use is decided, a version or a proxy by its live document's                    | 403, with the rights' reason   |
| The document has no file for the use                                                                            | 404                            |
| The file cannot be marked: not a JPEG, a PNG or a video, over the limits, a video with no video tools, too busy | 409, `watermark-unavailable`   |
| Otherwise                                                                                                       | the file marked, as a new file |

- **The text** names the person asking as both `recipient` and `user`, the day, and no territory.
  A member of an exempt group is served it marked too: the download endpoints serve them the file
  itself.
- **A blob named by its xpath** is the use a download of that xpath is, as `DownloadUse` names it:
  `blob:file:content` is the original where that is the original's place, `blob:picture:views/0/content`
  that view by its title. So one place is decided by one rule.
- **Not a button, and it changes nothing.** The asset page asks for a picture view this way once the
  server has refused it unmarked. Decision 3 governs configuration binding buttons to Automation
  chains; no configuration binds this, and the platform's own page calls it as it calls the share
  links' operations.
- **Every file served is logged** at `INFO`, with the document, the use and the person; a file
  refused, with its reason.
- **Not the rendition service.** On Nuxeo LTS 2025.10.18, the REST API's `@rendition` builds a
  rendition in a background work, as the system, and keeps it in the transient store for every
  reader of the document: a rendition naming its reader would be served to the next one, and could
  not name anyone. So the marked file is this operation's.

### Pictures

Drawn on the server in Java, by the share links' watermarker (below, "How a link opens"): a JPEG or
a PNG, at most 64 MiB, 24 million pixels and 16384 a side, read from its header before its pixels,
decoded from memory, never a temporary file, marked, and written as a new JPEG with nothing of the
file but its pixels. The platform makes a picture's views with ImageMagick, and they are JPEGs, so a
view is always one it marks; an original of another format, such as a TIFF, is not, and is refused
where the watermark marks it. At most two pictures are marked at once on a node, and one video, apart,
each waiting its turn up to 10 seconds, then refused: a long video holds up no picture.

### Video

Through the platform's own video tools, `VideoToolsService.watermark`, the same the platform's
`Video.AddWatermark` runs: its `videoWatermarkWithPicture` command line draws a picture over every
frame with ffmpeg's `overlay`. The mark is drawn in Java, on a transparent PNG of the video's size,
which the platform's `ffmpeg-info` command line, ffprobe, reads; so the policy's text never reaches
a command line. The new video keeps the original's container and file name, `-watermarked` added.
Tiled, the mark is drawn on a square as wide as the video's longer side, so that it covers the frame
however a rotation flag turns it; at a corner or the centre, it is placed on the frame as ffprobe
reports its size, before any rotation. The test checks a frame: the mark where the policy places it.

- **On a server without ffmpeg,** or whose video tools say the tool is not available, a video the
  watermark marks is refused: at the download endpoints, `watermark-required`; by
  `Asset.GetWatermarked`, 409 `watermark-unavailable`, without asking the tools to run; and in a
  delivery, refused whole. **Never served unmarked.**
- **Tested where ffmpeg is,** on a machine with ffmpeg 8 and `libvpx`, in the Nuxeo test framework
  with the platform's video tools and command line executor: the brand kit's generated WebM marked,
  a new video of the same size. **Where it is not,** as on a build machine without ffmpeg, that test
  is skipped, and `VideoWatermarkRefusedTest` holds the refusal.
- **What remains for a server with ffmpeg:** to run it there, with the encoder for each container
  it is given, `libvpx` for WebM and `libx264` for MP4, as the platform's own conversions need; and
  to measure it. A video is marked in the request that asks for it, or, for a delivery, in the
  filer's transaction: a master of a feature's length would hold either for the length of its
  conversion, and making it as background work is not built.

### Deliveries

The delivery listener marks each file the watermark's `<deliveries>` names, once the package is
decided and every file allowed: its text names the distributor as `recipient`, the filer as
`user`, the day and the delivery's territory. The record says, for each file, whether it was marked,
`watermarked`, and for whom, `watermarkedFor`, the exact text drawn, `watermark`, and holds the file
marked, `watermarkedFile`, a new file the distributor receives. A file the watermark does not mark
is recorded by its digest only, as before, and not held. A file it marks that cannot be marked
refuses the delivery whole, 403 `watermark-unavailable`, naming the file, and nothing is made.

### What watermarks do not do

- **Close the paths the rights do not close.** A watermark is decided where the rights are: the
  download endpoints, a stored file handed over with no document, the `Video.*` operations and share
  links. An Automation operation that returns a conversion of a document's file, such as
  `Blob.ToPDF`, `Blob.Convert`, `Picture.Resize` or `Document.Export`, a previewer's own endpoint, and
  another add-on's hand over what they make unmarked, as they hand it over whatever the rights
  (above, "What it does not cover", and the security review's item 1). Nor is a covered file held by
  a document of a type no policy covers decided at that document's endpoints.
- **Mark a use it does not name.** A video's transcoded videos and storyboard, and a picture's
  views, are uses of their own: a watermark naming the original alone leaves them as the rights
  decide them. `<downloads />` and `<previews />` naming none mark every use of their occasion.
- **Stop a copy.** A visible mark can be cropped round, painted over or rebuilt by software; it names
  the person or the distributor a copy came from. A member of an exempt group downloads the file
  unmarked, and may pass it on.
- **Cache a marked file.** Each request marks it again: a page that shows a marked view to many
  readers marks it once for each.
- **Mark a video on the asset page.** The video page says `watermark-required` and
  `watermark-unavailable`, and fetches no marked video; a picture view is fetched marked.
- **Mark a list's thumbnail** unless the policy's watermark names the `thumbnail` rendition among
  its previews; the media kit's does not.
- **Name a person by more than their user name,** which the user directory gives every user.

## The review held on the server

Phase 5's "review with pins and rounds", decided on the server, since 0.5.0. Built against decision
B's recommendation, in this add-on; decision 3 is not touched: a decision is one of Nuxeo's own
annotations written, which a synchronous listener decides, with no Automation operation and no
button bound by configuration.

### Where it was decided before

The asset page's review (layout-v2.md, "Review") wrote a pin and a round's close as Nuxeo's own
annotations, and offered Close round to a holder of `Write` on the asset, from its `permissions`
enricher: the page alone decided it. Nuxeo 2025's comment service took the close from anyone who
may read the asset, whatever the page offered. Nothing approved or rejected a review, and no group
was asked, in the client or on the server.

### What the server decides now

A review annotation is one of Nuxeo's own, of the origin `nuxeo-satori.review`, on the picture's
views, `picture:views`, below the asset, its payload in `externalEntity:entity`, as the page reads
it. A well-formed pin, version 1, is anyone's whom Nuxeo lets comment, as before. **Everything else
of that origin is held as a decision:** a round sent back, `{"kind": "round-closed"}`, the review
approved or rejected, `{"kind": "decision", "decision": "approved"}` or `"rejected"`, and anything
that is not a pin however it is spelled: another version, a key written twice, not JSON. A decision
needs all three:

1. **a review policy** for the asset's type, `org.nuxeo.agentic.assets.review`, point `policies`,
   naming its reviewer groups:

   ```xml
   <review type="AcmeAsset">
     <reviewer group="creative-review" />
   </review>
   ```

2. **the person in one of those groups,** as the user directory has them, with their groups;
3. **the add-on's permission, `ReviewAsset`,** granted on the asset, its own or inherited, to the
   person or one of their groups, read from the asset's permissions by the add-on itself, in the
   platform's order, the first entry in force that names them deciding. `Everything` does not hold
   it, and neither does being an administrator, whom the platform's own check lets do anything. A
   block of inheritance, `Everyone` denied `Everything`, met first, refuses.

The groups narrow who may ever decide, at the server's configuration; the permission says on which
assets, at each folder's. Neither alone is enough: whoever manages a folder's permissions may grant
`ReviewAsset` there, themselves included, and a group alone would let its members decide
everywhere. `ReviewAsset` is in the platform's permissions list, for an administrator to grant. A
policy's group that is not a group's name, or names everyone or `members`, every user's group, is
left out and logged; a policy left with none lets no one decide.

### The listener

`AssetReviewListener`, synchronous, in the transaction of the change, as the user who makes it, or
the one a privileged session acts for, as Nuxeo's comment manager opens one to write an annotation.
Every refusal marks the transaction for rollback, and nothing of the request is written.

| A decision, written                                                                                        | Answer | Code             |
| ---------------------------------------------------------------------------------------------------------- | ------ | ---------------- |
| Below no asset, or with no person to name                                                                  | 400    | `invalid`        |
| No review policy for the asset's type                                                                      | 403    | `not-reviewable` |
| On a version, a proxy or an asset in the trash                                                             | 409    | `not-live`       |
| By someone in none of the groups, or not granted `ReviewAsset` on the asset                                | 403    | `not-a-reviewer` |
| Not a decision of the review's form, not on the picture's views, or not on the asset itself, as a reply is | 400    | `invalid`        |
| After an approval or a rejection on the asset, not in the trash                                            | 409    | `concluded`      |
| Otherwise                                                                                                  | made   |                  |

- **On the asset's own comments folder:** a decision is written in the `CommentRoot` folder below
  the asset, as the comment manager writes one, naming the asset as its `comment:parentId`. A review
  is read as the page reads it, below the asset and naming it, so a decision copied below another
  asset names the asset it was written on, and concludes nothing on the other.
- **The comments folder is kept too:** the platform removes, moves, trashes and copies a folder's
  documents with it, with no event of their own, and Nuxeo lets any member add and remove a comments
  folder's children. So the asset's comments folder, while a decision is below it, is removed,
  moved, trashed or copied by an administrator alone, 403 `kept`; trashed with its asset, it is
  allowed, as the platform trashes an asset's documents with it.
- **The server writes the author,** the person, whatever the request wrote: a decision's, and a
  pin's.
- **Kept as written:** a change to a decision's payload, origin, file, the asset it is on, its
  author, or when it was written, `dc:created` and `comment:creationDate`, which the page orders the
  review by, or a pin's changed into a decision, is refused, 403 `kept`, whoever asks; its note, the
  comment's text, is Nuxeo's to allow. Below a version of its asset, as the platform copies an
  asset's comments into a version it checks in and then points each copy at the version, a change
  is allowed. A decision deleted, trashed, moved or copied, but by an administrator, 403 `kept`,
  or trashed with its asset; imported, but by an administrator, 403 `server-only`.
- **Audited:** each decision fires `assetReviewDecided`, category `assetReview`, on the asset, with
  its comment, such as `Review round 2: approved`, and the decision, the round, the annotation and
  who; written to the platform's audit after the commit, in the background, as the documents and
  records add-ons write theirs, so an audit that refuses the entry leaves the decision made and says
  so in the server log. The entry carries a boolean mark, which Automation's `Event.Fire`, open to
  every user, cannot set: an event of that name it fires is not written. A refused decision records
  nothing, and is logged at `INFO`.

### What the page is told

The `assetReview` document enricher, `enrichers.document: assetReview`: for a document no review
policy covers, `null`; otherwise `{ "type", "mayDecide", "reason", "permission": "ReviewAsset" }`,
`reason` a code above or `null`, decided as the listener decides for the reader. The asset page
offers Send back, Approve and Reject only on `mayDecide`, and not once the review is concluded; with
no answer, a server without 0.5.0, it offers none. It explains; the listener refuses whatever it
said.

### What the review does not cover

- **Pins.** A pin is anyone's whom Nuxeo lets comment on the asset, as before.
- **Two decisions at once.** Two reviewers deciding in the same instant may both be written, since
  the review is read, not locked; the page reads the first, by when the repository wrote it, which
  no one may change, as the conclusion, and the audit holds both.
- **A decision trashed by an administrator and restored.** Whoever may write it may take it out of
  the trash; an administrator who must take one away removes it.
- **A copy of an asset.** The platform copies an asset's comments with it, its decisions included,
  with no event of their own, so the copy's review reads as its original's.
- **The principal cache.** A person's groups are read through the user manager, whose cache holds a
  change made outside Nuxeo, in LDAP or by single sign-on provisioning, up to its lifetime.
- **What writes documents without events,** such as an importer that bypasses them.

## Share links

**A security control, and a new path that needs no sign-in.** A share link gives someone who has
no account, and is not signed in, some of an asset's pictures. Its security review is the plan's
condition for phase 5 being done (below, "For the security review"); until then nothing may rely
on it, and it is installed nowhere.

**Decision C, built against its recommendation,** "Share links in phase 5, invited outside users in
phase 8": links, and no outside user. Nobody is invited, given an account or signed in. **Decision
F is not touched:** no sign-in changes for a signed-in user, and no token a share link carries signs
anyone in.

### What Nuxeo already offers, and why a link does not use it

Read from the local Nuxeo 2025.10.18's jars, read only, as above. Nuxeo's time-limited access for
someone outside the company is `Document.AddPermission` with `email`, `begin` and `end`
(`nuxeo-permissions`): an ACE for a transient principal, `transient/<email>`, with those dates, and
a token from `TokenAuthenticationService.acquireToken` (`nuxeo-platform-login-token`), which
`TransientUserPermissionHelper.addToken` asks for and the permission's email carries. That token
signs its bearer in, through the `TOKEN_AUTH` plugin and the `X-Authentication-Token` header or the
`token` parameter, as that principal, for the whole REST API and Automation, with whatever that
principal may read. It is a `UUID.randomUUID()`, 122 random bits, kept as written, as the id of the
`authTokens` directory, with a five-minute cache.

That is the right base for phase 8's invited outside users, and the wrong one for a link, which
must give only its listed pictures, watermarked, and nothing of the API: a signed-in principal reads
every rendition, the original, the document's metadata and anything else Nuxeo serves it. So a
share link signs no one in. It is a servlet that takes a token and answers bytes, deciding with
Nuxeo's own pieces: a directory to keep the links in, as Nuxeo keeps `authTokens`; the document's
permissions, through the user manager, for its creator; the picture views Nuxeo makes; and this
add-on's rights policy.

### How a link is made

`ShareLink.Create`, an Automation operation, by a signed-in user, with the asset as its input:

```json
{
  "input": "doc:<id>",
  "params": { "renditions": ["view:FullHD", "original"], "end": "2026-12-14" }
}
```

- **Who may:** whoever holds `WriteSecurity` on the asset, "Manage permissions", the permission
  Nuxeo itself asks of anyone who gives someone else access to a document, an outside person by
  email included, **and** is an administrator or a member of a group the server's
  `nuxeo.agentic.share.groups` names, in `nuxeo.conf`, comma-separated; unset, administrators only.
  `WriteSecurity` alone is not enough: every user holds it on their own workspace, and so on a copy
  there of any asset they may read, whose rights fields they may then write. `Write` was the other
  candidate: it lets a user change the asset, not say who else may see it. `WriteSecurity` alone
  lists the links, revokes them, and reads their downloads: stopping a link is not sharing.
- **What it lists:** 1 to 10 items, each the asset's `original`, or one of its picture views by its
  exact title, `view:<title>`, which holds no `/` or `\`. Not a rendition of the rendition
  service, not another blob, not a view by its place.
- **Until when:** a last day, `yyyy-MM-dd`, in UTC, from today to 90 days on: the link stops at the
  first instant of the next day, in UTC, as an asset's rights end does.
- **Only what the rights allow now:** each item is decided by the asset's rights policy as a
  download of it would be, and refused when the rights have ended, a preview's included. A request
  with any item refused makes no link, and says which and why: `{"refused": [{"rendition",
"reason"}]}`, with the rights' codes and `no-such-rendition`.
- **Bound to the files:** each item's file digest, as the store gives it, and the SHA-256 of its
  bytes are recorded with the link. An item is served only while the document's file for it still
  has that digest, and the bytes read for it that SHA-256. A view renamed onto another file, a
  picture replaced, or its views made again as other files, ends the link for that item; a file
  with no digest is not shared, answered `no-such-rendition`.
- **Not for** a version, a proxy, a document in the trash or a type no rights policy covers; a
  document has at most 100 open links, and keeps at most 1000 in all.
- **The token:** 32 bytes from `SecureRandom`, 256 bits, written as 43 characters of base64url.
  The answer carries it once, with the path the link opens at, `/nuxeo/agentic-share/<token>/`;
  the server keeps its SHA-256 only, as the link's id. A lost address cannot be shown again: the
  link is revoked and another made.

### How a link opens

`GET /nuxeo/agentic-share/<token>/` is the link's page; `.../original` and `.../view/<title>` are
its items. The servlet has no authentication filter, on purpose
(`OSGI-INF/deployment-fragment.xml`): nothing is decided by who the visitor is. Each request runs in
a transaction of its own, with the system's rights, and an item is served only while all of these
hold, in this order:

1. the token has a token's form, checked before anything is read, and a link has its hash,
   compared in constant time once found;
2. the link is not revoked, and its last day has not passed, in UTC;
3. the link lists the item;
4. the link's creator, as the user directory has them now, with their groups, still holds
   `WriteSecurity` on the document, and is still an administrator or in a group
   `nuxeo.agentic.share.groups` names;
5. the document, read by the id the link holds, is that document, live, and not in the trash;
6. a rights policy covers its type, the asset's rights have not ended, a preview included, and the
   policy allows the item's use: so an ended right, a channel taken off the asset, or a use the
   policy no longer lists ends the link for that item;
7. the document has the item with the file the link was made for: a view of that title, or its
   original, with the digest the link recorded;
8. the bytes read for it, at most 64 MiB, have the SHA-256 the link recorded, and are a JPEG or a
   PNG of at most 24 million pixels, no side over 16384, whose decoding and marking take at most
   200 MiB as counted, the file twice included, and whose text is drawn at most 20000 times: all
   read from its header before its pixels; and the watermark is drawn on it;
9. the download is logged.

- **Nothing in a request names a document.** The document is the link's; the path names only an
  item of it. Anything else under the path is the refusal.
- **One refusal for everything:** a token that is not one, a link that is not there, revoked,
  past its day, an item it does not list, rights that refuse it: each is the same 404, byte for
  byte. The server log says which, at `INFO`, with the link's label, the first 8 characters of its
  id, and never the token; a token no link has is logged at `DEBUG` only, so that a scan writes no
  line per request.
- **The page** lists what the link may serve now, and opens nothing, the same 404, when that is
  nothing. It is the server's, in English, with no script, no style sheet and nothing from another
  address, everything written from the link escaped. It shows neither the asset's title nor any of
  its metadata: until the architecture's outside-user portal is built, it is the share-link view.
- **The watermark** is drawn on the server, in Java with ImageIO and Java 2D: the picture decoded
  from memory, never a temporary file, the link's label and last day, `SHARED ab12cd34 UNTIL
2026-12-14 UTC`, tiled across all of it at -30 degrees, light over dark, and the result written as
  a new JPEG. Nothing of the file but its pixels goes through: its metadata, colour profile and any
  embedded image are left behind. A picture too small for the whole text along its diagonal
  carries the label alone, so that a thumbnail's copy names its link too. At most two pictures are
  drawn at once, each holding a decoded picture, and one at a time for any one link: a link's page
  asks for all its pictures at once, and they wait for their link's turn, up to 10 seconds, then for
  one of the two, up to 2; a request that waits longer is answered 503, never with the file. Links
  share 64 turns, so two links on one turn wait for each other. A file that cannot be marked is not
  served. A copy carries the label of the link it came from.
- **A failure refuses:** an exception anywhere, an `Error` such as running out of memory while a
  picture is decoded, or a transaction that does not commit, is answered with the same 404.
- **Every answer** is sent with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, a content
  security policy that runs no script and frames nothing, `X-Frame-Options: DENY`, `X-Robots-Tag:
noindex`, `nosniff` and `Cross-Origin-Resource-Policy: same-origin`. GET only: anything else is 405.
- **Nothing is held in memory between requests:** each reads the link, the creator's permission,
  the document and its rights again, so a revocation, a permission taken away or a right ended
  holds from the next request on, on any node.

### Where links are kept, and the download log

Two directories, `agenticShareLinks` and `agenticShareDownloads`
(`OSGI-INF/share-links-directories.xml`), on the server's directory template, as Nuxeo keeps
`authTokens` and `aceinfo`: of the `system` type, which the REST API's directory list leaves out,
readable by the group `__Nobody__` only, so by an administrator and by code run with the system's
rights alone, with no cache. Every value is text: instants in UTC to the millisecond, always 24
characters, so sorted as text they are sorted in time.

| Directory               | Keeps                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `agenticShareLinks`     | The token's SHA-256 as its id, the repository, the document, the items, the last day, when and by whom it was made, and revoked |
| `agenticShareDownloads` | One entry per item served: when, the link's id, the document and the item                                                       |

The log keeps nothing about who downloaded: no address, no browser, no name. The link is what tells
its owner which recipient it went to. The creator's and revoker's user names are kept, because the
creator's permission is asked again at each opening, and they are staff, not the recipient.

### The asset page

The record page of an asset whose layout file has `"shareLinks": {}` lists its links, offers
Revoke and a new link, and shows the downloads, to those who may manage them; it draws nothing
for anyone the server answers 403 ([layout-v2.md](../docs/business-apps/layout-v2.md), "Share
links"). The brand assets kit turns it on in 0.2.2. The operations:

| Operation             | Input     | Parameters                           | Answers                                                                            |
| --------------------- | --------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `ShareLink.Create`    | the asset | `renditions` (a list), `end` (a day) | `{ link, token, path }`, or `{ refused: [{ rendition, reason }] }` and no link     |
| `ShareLink.List`      | the asset |                                      | `{ links }`, newest first: every open link, then closed ones up to 200 in all      |
| `ShareLink.Revoke`    | the asset | `link` (its id)                      | `{ link }`; 404 for a link of another document                                     |
| `ShareLink.Downloads` | the asset |                                      | `{ downloads: [{ time, link, rendition }], truncated }`, newest first, at most 200 |

A link is `{ id, document, renditions, end, created, createdBy, revoked, revokedBy, state }`, its
`state` `active`, `expired` or `revoked`. Each needs `WriteSecurity`, and Create a sharer too: 403
otherwise.

### What share links do not cover

- **Who may write the rights.** A link is decided by the asset's rights fields as the document
  holds them, and anyone who may write the asset may write those: move `dc:expired` on, and a link
  its rights had ended opens again; add a channel, and an item it refused is served. And a sharer
  who may read an asset can copy it where they manage permissions, write the copy's rights, and
  share the copy. The sharing group narrows who can do the second; neither is closed until the
  rights fields are written by a rights manager only, copies included (above, "What it does not
  cover").

- **A copy taken before revocation.** Whoever opened the link has the watermarked bytes. Revoking
  stops the next request, not what was saved. The watermark names the link; it does not stop a
  copy, and a visible mark can be cropped, painted over or rebuilt by software.
- **Rate limits.** A token of 256 bits cannot be guessed, so a limit is not what keeps links
  secret; the server limits only how many pictures it marks at once. The architecture rate-limits
  the share-link path at the edge, which an install must configure (below).
- **Outside users and the portal:** decision C's phase 8. No one is invited, signed in or given an
  account, and the page is not the portal.
- **Renditions of the rendition service, PDFs, video and anything but a picture view or the
  original**, and an original that is not a JPEG or a PNG, or is over the watermark's limits.
- **The page in other languages:** it is the server's, in English, until the portal.
- **Other nodes' caches:** none is used, so there is nothing to hold stale; a proxy or a CDN in
  front of the server must honour `no-store`, which is the install's to check.

## Building and testing it

From the repository's root, with JDK 21 and Maven:

```bash
mvn -pl nuxeo-agentic-assets -am package
```

It runs the module's tests and writes the bundle and the Marketplace package,
`nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.5.0.zip`. `build-marketplace.yml` builds it on
every pull request it runs for, without uploading or publishing it. The tests but two need no Nuxeo
runtime: documents are proxies that answer only what the code reads. `VideoRightsTest` runs in the
Nuxeo test framework, as `nuxeo-agentic-documents`'s tests do: a runtime and a repository on H2,
the platform's Video type and `Video.*` operations, its download service evaluating the contributed
permission through Nashorn, and the kit's own video policy, which the build copies from the kit; only
the video tools service, which runs ffmpeg, is a fake. `MediaDeliveryTest` runs there too, with the
delivery types and listener, the download permission, and the media kit's own rights policy and
schemas, which the build copies from the kit (`kit-media-policy`, `kit-media-schemas`), under the
kit's types, which `KitMediaModelTest` holds to the kit's model file.

Since 0.5.0, five more run there. `AssetReviewTest`: the review service and listener, the brand
kit's own review policy, which the build copies from the kit, Nuxeo's `Annotation` and `CommentRoot`
types, written as the platform's comment manager writes them, the user manager with its test
directories, and the platform's audit, on H2, as the documents add-on's tests run it.
`WatermarkPicturesTest`: the download permission through Nashorn with the person downloading, and
`Asset.GetWatermarked` through Automation. `VideoWatermarkTest`: the platform's own video tools,
their command lines and the command line executor, running ffmpeg and ffprobe where they are
installed, and skipped where they are not; `VideoWatermarkRefusedTest`: the video tools of a server
without ffmpeg, no tool available.

| Test                           | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AssetRightsTest`              | The decision, use by use, in its order, on the kit's policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DownloadUseTest`              | Which use a download is, canonical forms only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `RightsPolicyTest`             | A policy read through XMap as the runtime reads it, each mistake a refusal, and the brand kit's own file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `AssetRightsComponentTest`     | Policies replaced, removed and broken; unreadable rights refused; versions and proxies by their live document; containers holding assets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DownloadPermissionScriptTest` | The contributed script run through Nashorn 15.7 as `checkPermission` runs it; every failure a `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `AssetRightsJsonEnricherTest`  | What the enricher writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `KitVideoPolicyTest`           | The brand kit's video policy, read from its file: a video's downloads decided, its transcoded videos by name at their places, every storyboard frame a preview                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `VideoPolicyTest`              | A video's files in their canonical forms only; `<storyboard>` through XMap, with a channel or as a preview; a `<blob>` at a video's place left out and said; what the enricher writes of them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `VideoRightsTest`              | In a Nuxeo runtime: a transcoded video decided by its conversion's name at every place and through `/nxfile/`'s form, as by name; every one of twelve storyboard frames by the one rule; each `Video.*` operation refused or run as a download of its file, with every parameter handed on, a stored file given as its input decided for its holders, a version by its live document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `BundleTest`                   | The manifest's components, their classes, and the package's version; the share servlet mapped with no authentication filter; the two directories readable by `__Nobody__`, of the `system` type, with no cache and their fields; the four operations; the five video operations, each the platform's id, parameters and methods; the delivery listener synchronous on every event that could make or change a delivery, and `MediaDelivery` with no facet and its fields                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ShareTokenTest`               | 256 bits from the generator given, every bit varying; one canonical form; the SHA-256 kept; hashes compared exactly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ShareLinkTest`                | A link's state at the edges of its last day in UTC, revoked whatever the time; the items a link may list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ShareLinkComponentTest`       | Making a link: the permission and the sharing group, items, day, rights now, each item's digest and SHA-256; opening it: every condition above, each refusal by its reason, the bytes marked and logged; one turn per link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `WatermarkerTest`              | The mark across the whole picture, light and dark, the label whole on a thumbnail; nothing but the pixels kept; formats, bytes, pixels, sides, tiles and the budget refused from the header                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ShareEndpointTest`            | GET only; the paths and nothing else; one refusal byte for byte; the headers on every answer; the page escaped and self-contained                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `DirectoryShareLinkStoreTest`  | Every call with the system's rights; text only, the token nowhere; what does not read back refused; newest first, truncated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ShareLinkJsonTest`            | What the operations answer, and the token in Create's answer only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `TerritoriesPolicyTest`        | Territories, windows, a film's windows and a delivery package read through XMap; each mistake a refusal; a window's parts and days; the decision's order for a delivery and a download; the media kit's own file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `TerritoriesEnricherTest`      | What the enricher writes under a policy with territories: the territories, the asset's own windows, a film's windows left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `KitMediaModelTest`            | The test runtime's media model is the kit's: its types, their parents and schemas, and the schema files as copied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `AssetReviewTest`              | In a Nuxeo runtime, on the brand kit's review policy: a round sent back, approved and rejected by a reviewer, each audited on the asset; refused to a holder of `ReviewAsset` outside the groups, to a group member not granted it, to `Everything`, above a blocked inheritance, to an administrator until granted, and on a type with no policy; a pin anyone's, anything else of the review's origin held; the form, the views and a concluded review; the author the server's; a decision kept, a pin not turned into one, deleted by an administrator alone; what the enricher says; a comments folder holding a decision kept, and a copy of it deciding nothing elsewhere; a decision outside the asset's own comments folder refused; a pin's author the server's; an entry fired with no mark not audited                                                                                                       |
| `AssetReviewsTest`             | With no runtime: `ReviewAsset` read from an asset's permissions in the platform's order, a denial or a block met first refusing, `Everything` and others' grants holding nothing; the payload read as the page reads it, strictly; a review policy's mistakes never widening it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `WatermarkPolicyTest`          | A watermark read through XMap: its occasions, uses, exempt groups, text and placement; each mistake breaking the policy; a use refused unmarked to anyone not exempt, an administrator included; the rights' refusals kept; the text's names filled, cleaned and cut; the media kit's own file; the system acting for no one exempt from nothing; a mark for deliveries naming its filer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `WatermarkPicturesTest`        | In a Nuxeo runtime: a marked view and download refused unmarked at the download service, served to the exempt group; the enricher's `watermark-required` for its reader; `Asset.GetWatermarked` serving the file marked, byte for byte the mark naming its reader and the day; nothing it does not mark served; the rights still deciding; a file that cannot be marked refused; a stored file handed over with no document decided for the assets that hold it; a copy whose views are retitled serving nothing the original would mark; a blob named at a place decided as a download of that place is                                                                                                                                                                                                                                                                                                                 |
| `VideoWatermarkTest`           | In a Nuxeo runtime with the platform's video tools: the original refused unmarked; where ffmpeg is installed, the kit's WebM marked through the tools, a new video of the same size; the mark drawn over the frames, the text alone at its place; a frame carrying the mark where the policy places it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `VideoWatermarkRefusedTest`    | In a Nuxeo runtime with no ffmpeg: the original refused unmarked to everyone, and `Asset.GetWatermarked` refusing, 409, without asking the tools to run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MediaDeliveryTest`            | In a Nuxeo runtime, on the media kit's policy and schemas: a localised version delivered inside its window and refused outside it, before it opens and after it closes, its first and last days included; outside its territory; by its own rights, its rights end and its channels; a package refused whole for one file, or a file missing; the same windows at the download endpoints; the film's windows read for a reader who may not read the film, a film missing or in the trash refusing; the record the server writes over the filer's; the record kept; the filer held to a live version they may read; since 0.5.0, the key art marked for its distributor, byte for byte, and held, the others recorded unmarked; a delivery whose marked file cannot be marked refused whole; the still refused unmarked to an outside partner and an administrator, served to staff, and served marked naming the partner |

Every guard was seen failing: each of 28 breakages, one at a time (a use not listed let through,
the channel or the end day not checked, the script's `catch` removed, the point misnamed, the kit's
print view given another channel, a version read by its own fields, a container's renditions
served, a nested collection not looked for, a proxy's live fields written, and the others), turned
the tests red, and the build unbroken was green. `KitVideoPolicyTest`, added with the kit's videos
and with no change to the add-on's code, went red with the kit's `MP4 480p` given the Print channel.
**The video rules' guards were seen failing too:** each of 15 breakages, one at a time, turned the
tests red, `VideoRightsTest` among them for each that a runtime decides: a transcoded video named by
its place, storyboard frames named by their places, a frame's place not checked, the operations'
decision skipped, a stored file given as the input not decided, nor one read from a document no
policy covers, a facet's blob fields not searched, a prefix-less schema's place misnamed, the watermark's picture not decided, a list's documents not decided,
`<storyboard>` not read, the enricher listing no conversion, a `<blob>` at a frame kept, or at a
video's place in another form, a parameter
not handed to the platform's operation. **What the tests cannot reach:** the container query
runs against fakes here; its text is held exactly, but it has not run on a repository. The
privileged lookup of a version's live document, and the query for a stored file's holders, run on
H2 in `VideoRightsTest`, not on the server's database.

**The share links' guards were seen failing too:** each of 80 breakages, one at a
time, turned the tests red, and the build unbroken was green. Among them: a link that never
expires or expires a day late; a revocation not read; an item the link does not list served, or
`rendition/` mapped; another document served, or another document's link revoked; ended rights
not checked when serving, on the page or when making a link, previews included; the rights
decision ignored; a creator's permission or group not asked, or asked for `Read`; a token compared
loosely, not checked for its form, of 128 bits, not from the generator given, or kept in place of
its hash; the file served unmarked, the watermark not drawn or drawn once, its limits on bytes,
pixels, sides, tiles and memory removed, metadata kept; the turns removed; the download not
logged, or a failure to log still serving; Create, List or Downloads with no permission, or
`Write` in place of `WriteSecurity`; a view or the original served whatever its file; the
`no-store`, `no-referrer` or `DENY` header dropped; an expired link answered apart; the page not
escaped; the directories readable by `Everyone`, cached, or not `system`; the authentication filter
mapped on the path. The script that broke them is not in the repository; the list is in the pull
request. **What the tests cannot reach:** the directories, the repository, the user manager, the
servlet container and Automation are fakes here, so the operations' statuses, the directories'
tables and the servlet's mapping have not run on a server.

**The media rights' guards were seen failing too,** on 26 November 2026: each of 31 breakages, one
at a time, turned the tests red, and the build unbroken was green. A delivery's territory or window
not checked; a download's window not checked, or a download held to no territory; a window's last
day left out, or one with no first day skipped; a package delivered in part, or with a file missing;
a version's windows read from itself and not its film; a film in the trash still read, read with
the reader's own session, or of another type; a proxy delivered, or the version read with the
system's rights; the filer's own `deliveredBy` kept; a delivery's record changed, deleted, moved or
copied by its filer; a folder holding one not looked into; a refusal not marked for rollback; an
import let through; a territory with no window, windows from a document of no type, a preview, or
a rendition in a package taken for sound; a film's windows written by the enricher; the listener
deaf to imports; the test model drifted from the kit's; the kit's key art cleared by SVOD; and a
share link's item served once its window closed. Three of the first run's breakages did not count,
two that did not compile and one that no test caught, a preview in a package; the test was added,
and the three made again went red; so did three of the review's fixes' that first did not compile.
The script that broke them is not in the repository; the list is in the pull request. **What the
tests cannot reach:** the listener and the privileged reads run on H2 in `MediaDeliveryTest`, not
on the server's database; a check-in and a restore, since `MediaDelivery` is not versionable; and
the REST API's answer to a refused delivery, its status and message, which has not run on a server.

**The watermarks' and the review's guards were seen failing too,** on 27 November 2026: 50
breakages, made one at a time, and 49 of them turned the tests red; the build unbroken was green.
**The review, 23:** a decision not held; the reviewer group not asked; `ReviewAsset` not asked;
`Everything` counted as `ReviewAsset`; a denial or a block of inheritance not read; an administrator
exempt; the system deciding, not the person a privileged session acts for; a concluded review not
looked for; a decision not kept; anyone deleting a decision; the request's author kept, for a
decision and for a pin; a decision not audited; an entry fired under the decision's name with no mark
audited; a pin of another version taken for one; a key written twice read as its last; anything
after the payload read past; the enricher letting everyone decide; a decision off the picture's
views accepted; a type with no policy reviewable; a comments folder holding a decision not kept; a
decision copied below another asset counted there. **The watermarks, 27:** the watermark not applied
to a download; everyone exempt; no one exempt; the system exempt by its groups; every user's group
accepted as exempt; the person downloading not handed on by the script; a stored file handed over
with no document not decided; a copy's file not decided where the asset holds it; an unknown name in
the text accepted; a second watermark accepted; a broken watermark not breaking the policy; a use not
cleared for its occasion accepted; a delivery's mark not naming its filer accepted; the marked file
served whatever the rights, served unmarked, naming someone else, or for a use the watermark does not
mark; a blob named at another use's place taken as written; a file that cannot be marked served
unmarked; the video tools run without asking whether they can; a video's mark drawn at the top left;
a delivery marking nothing, marked for its filer, or made with a file that cannot be marked; the
enricher not saying `watermark-required`; and, in the media kit's own policy, outside partners exempt
and its delivered key art not marked. **The one not seen failing** is a decision's folder not checked
to be a comments folder: the folder's place, the asset's own child, is checked too, and holds it. Two
of the first run's breakages went unseen: a denial not read, since Nuxeo refuses a denial but its own
block, and its merged permissions stop at a block, and the video tools' availability not asked,
since ffprobe's absence refuses next. `AssetReviewsTest` and a count of the tools' answers were
added, and both, made again, went red. The script that broke them is not in the repository; the
list is in the pull request. **What the tests cannot reach:** the comment manager, which the tests
stand in for as it writes on Nuxeo 2025.10.18, and its fix-up of a version's comments; the platform's
trash of an asset's documents with it; the REST API's answer to a refused annotation and to
`Asset.GetWatermarked`; Automation's writing of an operation's blob, which the tests stand in for as
a download naming no document; the audit on the server's database; and a video marked on a server:
the video test ran with this machine's ffmpeg 8, and is skipped where there is none.

The version is `assets.package.version` in `pom.xml`, which `package.xml` takes, and the manifest's
`Bundle-Version` repeats; `BundleTest` refuses a build where they differ.

## Installing it on a local Nuxeo

**Not run for 0.2.0 to 0.5.0.** The local Nuxeo is the Docker container `nuxeo`, on port 8080. Read
only, on 25 November 2026, its package list shows `nuxeo-agentic-assets-0.1.0` and
`brand-assets-demo-0.2.0` started: this upgrades both, to the add-on 0.5.0 and the kit 0.2.5, which
depends on it, in one restart. The media kit, `media-demo` 0.2.0, which depends on 0.5.0, installs
the same way, with its own seed ([its README](../business-apps/packages/media-demo/README.md)). `nuxeoctl mp-install` refuses while the server runs, and the server is the container's main
process, so a one-off script installs them when the container next starts, as the kits' READMEs do.
**Not before the share links' security review:** the upgrade opens `/nuxeo/agentic-share/` to
anyone who can reach the server.

**1. Build both,** from the repository's root:

```bash
mvn -pl nuxeo-agentic-assets -am package
```

```bash
npm run app-package -- business-apps/packages/brand-assets-demo --platform 0.2.0
```

**2. Into the container,** then the one-off script, which removes itself. `mp-install` given a
package's later version upgrades the one installed:

```bash
docker cp nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.5.0.zip nuxeo:/tmp/
```

```bash
docker cp business-apps/packages/brand-assets-demo/dist/brand-assets-demo-0.2.5.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-assets-0.5.0.zip /tmp/brand-assets-demo-0.2.5.zip --accept=true > /var/log/nuxeo/asset-rights-install.log 2>&1 || echo "asset rights: install failed, see /var/log/nuxeo/asset-rights-install.log"' 'rm -f "$0"' > /tmp/zz-asset-rights-install.sh && chmod 755 /tmp/zz-asset-rights-install.sh
```

```bash
docker cp /tmp/zz-asset-rights-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- `/var/log/nuxeo/asset-rights-install.log` in the container lists both packages installed, at
  0.5.0 and 0.2.5;
- the server log's `Component Loading Status` has nothing pending or missing, and names
  `org.nuxeo.agentic.assets.rights`, `org.nuxeo.agentic.assets.rights.download`,
  `org.nuxeo.agentic.assets.rights.enrichers`, `org.nuxeo.agentic.assets.share.directories`,
  `org.nuxeo.agentic.assets.share`, `org.nuxeo.agentic.assets.share.operations`,
  `org.nuxeo.agentic.assets.rights.video.operations`, `org.nuxeo.agentic.assets.delivery.types`,
  `org.nuxeo.agentic.assets.delivery`, since 0.5.0 `org.nuxeo.agentic.assets.watermark.operations`,
  `org.nuxeo.agentic.assets.review` and `org.nuxeo.agentic.assets.review.listener`, and
  `nuxeo.config.brand-assets-demo.rights`, `nuxeo.config.brand-assets-demo.video-rights` and
  `nuxeo.config.brand-assets-demo.review`;
- the server log's `CommandLineExecutorComponent` warnings name `videoWatermarkWithPicture` and
  `ffmpeg-info` where ffmpeg is not installed: a video a policy marks is then refused, never served
  unmarked;
- the server log has no `Asset rights:` error, no `Asset review:` error and no `Share links:` error;
- the generated `nxserver/nuxeo.war/WEB-INF/web.xml` maps the servlet `Agentic Share Links` on
  `/agentic-share/*`, and no `NuxeoAuthenticationFilter` on that path;
- `GET /nuxeo/agentic-share/` followed by any 43 characters of `[A-Za-z0-9_-]` and `/` answers
  404, with `Cache-Control: no-store, max-age=0` and `Referrer-Policy: no-referrer`; and `POST` to
  it, 405;
- `GET /nuxeo/api/v1/directory` does not list `agenticShareLinks` or `agenticShareDownloads`, and
  `GET /nuxeo/api/v1/directory/agenticShareLinks` as a user who is not an administrator answers no
  entry;
- once the kit is seeded, `GET /nuxeo/api/v1/path/default-domain/workspaces/acme-brand-assets/assets/ast-503`
  with the header `enrichers.document: assetRights` answers its `contextParameters.assetRights`,
  and `@blob/picture:views/<n>/content` on its `OriginalJpeg` view answers 403;
- the rights demo: `npm run beta:evidence -- brand-assets-rights`
  ([`scripts/beta-harness/steps/brand-assets-rights.mjs`](../scripts/beta-harness/steps/brand-assets-rights.mjs));
- the share links demo, the plan's demo step 3, by hand, with no steps file yet: on asset 501's page,
  as a user who holds `WriteSecurity` on it, make a link for `FullHD` and `Medium`; open its address
  in a private window, and see both watermarked with the link's label; the asset page's downloads
  list them; Revoke it, reload the private window, and see "This link is not available". A link
  to asset 503's original, or to anything of asset 505, is refused when it is made.

**Who may make links:** with nothing set, administrators only. To let a group make them, set
`nuxeo.agentic.share.groups=<group>[,<group>...]` in the container's `nuxeo.conf` before the
restart, for one through the image's `NUXEO_CUSTOM_PARAM`; the demo above runs as an administrator
and needs none.

**Before anyone outside the company has a link,** whatever reaches the server from outside must:
rate-limit `/nuxeo/agentic-share/` per client, as the architecture's deployment table has it;
keep and cache nothing of it, honouring `no-store`; and log no full request path, or keep such logs
as secrets, since the path carries the token. Nothing here configures any of that.

**Removing it:** remove the kit first, which depends on it, then the add-on, with
`nuxeoctl mp-remove brand-assets-demo nuxeo-agentic-assets --accept=true` in the one-off script in
place of `mp-install`. With it gone, no download is refused for rights and no share link opens; its
two directories' tables stay in the database until dropped by hand.

## For the security review

The plan requires one before this is relied on. It should check:

1. **Every path that hands out an asset's bytes,** listed from the server's own bundles, as this
   README lists the download endpoints: which pass the document to the download service, and which
   do not, such as Automation operations that return a document's blob or a conversion of it
   (`Document.GetBlob`, `Document.GetBlobs`, `Picture.GetView`, `Picture.Resize`,
   `Document.GetRendition`, `Document.GetContainerRendition`, `Document.Export`, `Blob.ToPDF`,
   `Blob.Convert`, and those of the previewer and PDF packages), CMIS renditions, and add-ons
   with their own endpoints. For each one that does not, decide how it is closed, or accept it in
   writing. The list can be made again with the read-only scan the pull request describes. The
   video package's five `Video.*` operations are decided here (above, "The video operations"):
   check that their replacements still match the platform's classes on the release the server
   runs, since a parameter the platform adds would not reach its operation.
2. **The script and its failure modes:** that `checkPermission` still reads a permission as this
   README says on the release it runs on, that the engine still lets the script reach the class,
   and that refusing every download when the class cannot load is the right failure.
3. **The classification:** that only canonical xpaths are named, that `blobholder:0` and the
   `mainBlob` rendition count as the original only when their blob has the original's digest, so a
   rendition blob whose digest differs is refused, that a view is
   trusted by its title, a transcoded video by its conversion's name, as `@rendition` trusts it,
   and every storyboard frame as one use. A conversion's name is the document's to say: one named
   as another rendition the policy lists, a preview among them, is decided by that rendition's
   rule, as a view titled as a preview view is. And that a stored file read by a `Video.*`
   operation is found for every covered document holding it, on the repository the server runs
   (its blob fields' `data`, by one query of comparisons on each blob field), and what that query
   costs there per call.
4. **Who may write the rights fields, view titles and transcoded videos' names** on the kit's
   types, copies included, and whether they must be restricted to a rights manager.
5. **Versions, proxies and containers:** the live document's rights for a version or a proxy, read
   with a privileged session; and a container refused its renditions when the reader's session
   finds a covered document in it, by an `ecm:ancestorId` or collection-member query per rendition.
6. **`@preview`'s redirect:** the REST adapter sends a blob provider's embed URI, where it has one,
   before it asks the download service. The local server's provider has none; a provider that does
   would serve a preview without this permission.
7. **The default for what a policy does not list:** refused. And what a broken policy does:
   refuses every use of its type. And that the add-on, unable to run, refuses every download.
8. **The day:** the server's in UTC, while the asset page's banner reads the reader's day.
9. **The enricher:** that it says nothing a reader of the asset may not already read, and that it
   answers `null`, "no policy", when the service is not running, while the permission refuses.
10. **The cost:** a new script engine and one evaluation per download, for every document, which
    measured 0.7 to 2.8 ms with Nashorn 15.7 on JDK 21, and the log line per refusal.

**Share links,** a new path that needs no sign-in, add these. The plan makes their review the
condition for phase 5 being done:

11. **Token entropy and storage:** 32 bytes of `SecureRandom` per token, the JVM's default
    provider on the server; base64url, 43 characters, one canonical form; only the SHA-256 kept, with
    no salt or key, on the argument that a 256-bit random token has no dictionary; the token in
    Create's answer once, and nowhere the client keeps it. Whether a keyed hash is wanted anyway,
    so that a copy of the database alone cannot be checked against a token seen elsewhere.
12. **The timing of the comparison:** the store is asked for the link by the token's hash, which
    the caller cannot choose the bits of, and the hash found is compared to the hash asked for
    with `MessageDigest.isEqual`. Whether the directory's own lookup by id needs more than that.
13. **Enumeration and rate limiting:** a token's form refused before the store is read; one 404
    for every refusal, byte for byte, whatever the reason; the log line for an unknown token at
    `DEBUG`. No per-client limit on the server: the edge must add one, and whether the server
    needs its own, beyond two pictures marked at once.
14. **Scope escape:** the document is the link's, never the request's; the path names an item of
    it and nothing else; no authentication filter, so no session and no principal, and the
    system's rights used only to read that document, its creator's permission and the two
    directories. Whether anything else under `/nuxeo/` can be reached with a link's token (it is
    no sign-in token: `TOKEN_AUTH` does not know it). A view's title, which anyone who may write the
    asset may change, no longer decides what a link serves: each item is bound to its file's digest
    and its bytes' SHA-256 (item 24).
15. **Watermark removal:** a visible mark, tiled, light over dark, at -30 degrees, the link's label
    and last day in it, on a new JPEG with no metadata. It can be cropped round, painted over or
    rebuilt by software; it names the link a copy came from, and does not stop a copy. Whether an
    invisible mark is wanted too.
16. **Caching and proxies:** `no-store` on every answer, 200, 404, 405 and 503 alike; whether every
    proxy and CDN in front of a customer's server honours it, and keeps no copy of a 200.
17. **Referrer leakage:** `Referrer-Policy: no-referrer` and the page's own `<meta name="referrer">`;
    the page loads nothing from elsewhere and links nowhere else. The token is still in the
    address bar, the browser's history, and the server's and every proxy's access logs, which the
    install must treat as secrets; and in the traces of the server's OpenCensus filter on every
    path, which records the request's address whenever tracing is exported.
18. **Revocation latency:** no cache in the directories or in the service, so a revocation holds
    from the next request on, on any node, with the database's own isolation. A request already
    being answered finishes, and what a visitor saved before is theirs. The creator's groups and
    permission are asked through the user manager, whose principal cache is the server's
    `default-cache`, with a 20-minute lifetime on the local server: a change made through Nuxeo
    clears it, one made in LDAP or by single sign-on provisioning is seen up to 20 minutes late.
19. **Clock and time zone:** a link's last day and the rights end are days in UTC, decided by the
    server's clock; the asset page shows the day in UTC and says so. A server whose clock is wrong
    serves for the wrong days.
20. **The log's privacy:** per download, the time, the link's id, the document and the item, and
    nothing about the visitor; the creator's and revoker's user names on the link. The server's own
    access log still holds the visitor's address and the path, with the token in it.
21. **Interaction with the rights policy:** every item is decided at every request by the asset's
    policy as a download of it would be, and refused once the rights have ended, a preview
    included, which is stricter than a download; a link made for an item the rights refuse is not
    made. The servlet reads the bytes itself, not through the download service, so the download
    permission is not what refuses a link's item: this decision is. Whether a link should also be
    refused when the asset's rights would refuse a download for another reason the policy adds
    later.
22. **Who may make a link:** `WriteSecurity` and an administrator or a member of a group
    `nuxeo.agentic.share.groups` names, asked again of the creator at every request, through the
    user manager, with their groups; a user no longer there refuses. Whether that is the right
    pair, rather than a permission of its own, given that `Everything` grants every permission on
    a user's own workspace; the principal cache's delay (item 18); and the rights fields, which
    whoever may write an asset may write, and which decide its links.
23. **Denial of service:** at most two pictures marked at once, and one per link, each at most
    64 MiB, 24 million pixels, 16384 a side, 20000 tiles of text and 200 MiB as counted, read from
    the header first; a request waiting its turns longer than 10 and 2 seconds answered 503. The
    count is not the JVM's peak, which runs higher: up to twice it was measured. Every page view
    marks and logs each picture it shows.
24. **Binding to the files:** an item is served only while its file has the digest the store gave
    it when the link was made, and the bytes read have the SHA-256 recorded then, so that a store
    whose digest is MD5 does not decide alone; whether a view's file is stable enough on the release
    it runs on for a link not to end by itself, and whether ending it when a picture is replaced is
    what customers want.

**Media rights,** since 0.4.0, add these. The review is deferred until the app is finished, as
every review is ([security-reviews.md](../docs/business-apps/security-reviews.md)):

25. **The decision's order and its two codes:** that a territory and a window are decided after
    the rights end and the channel, and only under a policy that names both territories and
    windows, a policy naming one of them refusing every use. Whether a download, which names no
    territory, should be served while a window for its channel is open in any territory the asset
    may be delivered to, as it is, and refused before every window opens, as it is; and whether a
    delivery refused for one territory should leave the files downloadable while another
    territory's window is open, as it does.
26. **A film's windows read with the system's rights:** that the document a version names for its
    windows is held to the policy's `type`, there, live and not in the trash; that what the
    enricher writes of the version, its decisions, which depend on that document's windows, tells
    a reader of the version nothing they should not know of a film they may not read; and whether
    a version must also be bound by its film's own rights end or channels, which it is not.
27. **Who may write the territories and the windows:** the trust model of item 4, for versions,
    their film reference, and films: who may widen where and when a version may be delivered.
28. **The delivery's way in:** that a `MediaDelivery` is only ever made through the synchronous
    listener on `aboutToCreate`, in the filer's transaction, which it marks for rollback when it
    refuses, as the documents and records add-ons' listeners do; that an import, a copy, a folder
    copied whole, a check-in and a restore are each refused on the release the server runs; and
    which server code, importers or bulk actions, such as one that sets a document's trash flag
    directly, write documents without the events it hears.
29. **Who may file a delivery:** whoever may add a document to a folder and read the version, with
    their own session. Whether that is enough for a record that moves no byte, whether an
    integration acting on a delivery's record must check who filed it, and whether a permission of
    its own is wanted.
30. **The record kept:** that its `mdlv` properties, a copy, an import, a check-in and a restore
    are refused, a move, a trash and a deletion are an administrator's alone, and a folder holding
    a delivery is removed, moved, trashed or copied by an administrator alone, the folder's subtree
    looked into with the system's rights at each such event; whether that query sees a folder's
    copy, not yet committed, on the database the server runs, as it does on H2; and what it costs
    there, once for each folder a person removes, moves, trashes or copies.
31. **The refusal's message:** that it names each refused file by its use and place, its reason
    and its channel, and the territory, and names the version only by the id the filer gave; and
    whether the REST API answers it as written, status and message, on the release the server runs.
32. **The clock:** windows are days in UTC, decided by the server's clock, as rights ends and share
    links' last days are (item 19).

**Watermarks and the review held on the server,** since 0.5.0, add these. The review is deferred
until the app is finished, as every review is
([security-reviews.md](../docs/business-apps/security-reviews.md)); what follows is what it should
check, not what it found:

33. **Every path to a marked file's original:** that the download permission is asked, with the
    person downloading as `CurrentUser`, at every endpoint item 1 lists, on the release the server
    runs; that the platform writes an Automation operation's blob through the download service with
    no document, so that a stored file is decided for the documents holding it, and what that query
    costs per download there; that the `Video.*` operations, deciding with no person, refuse a marked
    video to everyone; for each path item 1 finds that makes a conversion of a document's file,
    whether it hands over what a watermark marks, unmarked; and whether a covered file held by a
    document of a type no policy covers should be decided at that document's endpoints too.
34. **Who is exempt:** a member of a group `<except>` names, as the user directory gives the person's
    groups; that nobody else is, an administrator included; that a download with no person, or with
    the system's, is exempt from nothing; and the principal cache's delay (item 18).
35. **`Asset.GetWatermarked`:** that it serves only a use the watermark marks on its occasion, decided
    by the rights as a download of it is, and the file the document holds for that use; that a
    member of an exempt group served it marked gets nothing they could not download; and its cost,
    one marking per request, at most two at once on a node, with no cache.
36. **The text:** that each value filled in, a user name, a distributor's name, a territory, is cut,
    cleaned of control characters and drawn as pixels, and reaches no command line, the video's
    mark included, which is a picture drawn in Java and handed to ffmpeg as a file.
37. **The picture's mark:** the share links' watermarker and its limits (items 15 and 23), on any
    picture a policy marks; and whether a visible mark naming its reader is enough for the uses a
    customer marks.
38. **The video's mark:** the platform's `videoWatermarkWithPicture` and `ffmpeg-info` command lines
    on the release the server runs, the temporary files they write, the mark's drawing removed after
    each run, and that a server without ffmpeg refuses rather than serves; and the time a long video
    takes, in a request or in a filer's transaction.
39. **A delivery's marked files:** that the delivery holds only the files the watermark marks, each
    marked for its distributor, and that whoever may read a delivery may download them; whether a
    marked copy made for one distributor should stay downloadable once the version's rights end.
40. **Who may decide a review:** a member of a policy's reviewer group granted `ReviewAsset` on the
    asset, read from the asset's permissions by the add-on, the first entry in force that names
    them deciding, `Everything` and an administrator holding nothing unless granted; that whoever
    manages a folder's permissions may grant it there, and whether the groups are enough to keep
    that from deciding anything; and whether a policy should name the groups, or the permission
    alone should, or both, as it is.
41. **What the listener holds:** every annotation of the review's origin that is not a well-formed
    pin, read strictly, a key written twice refused; in the asset's own comments folder, naming the
    asset, as the page reads it; on a live asset; once an approval or a rejection is written, no
    other decision. That the comment manager's privileged session, acting for the person, is read as
    that person on the release the server runs; that the platform's own fix-up of a version's
    comments, and its trash of an asset's documents with the asset, run as this README says they do;
    and what else, an importer or a bulk action, writes, moves or removes a comments folder's
    documents with no event the listener hears.
42. **A decision kept:** its payload, origin, file, asset and author unchanged, whoever asks; moved,
    copied, trashed or deleted by an administrator alone; never imported. Whether a pin should be
    held too, since a reader may write one.
43. **The audit:** one `assetReviewDecided` entry per decision, on the asset, after the commit, with
    who, the decision and the round; whether a refused attempt should be audited as well as logged.
44. **The enricher:** that `assetReview` says nothing a reader may not know, whether they may decide
    and the permission's name, and that `assetRights`'s `watermark-required` says nothing more than
    the download endpoints' refusal does.
