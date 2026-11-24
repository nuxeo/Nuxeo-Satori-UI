# nuxeo-agentic-assets: an asset's rights, enforced on the server

The assets module's server add-on ([development plan](../docs/business-apps/development-plan.md),
phase 5, "The rights and sharing add-on"), version 0.1.0: the rights half, without sharing. A
Maven module beside `nuxeo-agentic-core`, with its own Marketplace package, `nuxeo-agentic-assets`.

**Built against an open decision.** Decision B, the packaging of the server tier, is open; this
follows its recommendation, "`nuxeo-agentic-core` for the runtime essentials; one add-on per domain
module" ([decisions.md](../docs/business-apps/decisions.md)). Share links, decision C, are not
built.

**Needs its security review before anyone relies on it** (below, "For the security review"). It
is not installed anywhere: it was built, tested, and checked against the server's own jars, read
only.

## The short version

- **It refuses, on the server, for every user, administrators included,** an asset's original, a
  picture view or a rendition that the asset's rights do not cover: once its rights end day has
  passed, or when its channels do not hold the channel that covers that use. A preview is served
  whatever the rights. A use its policy does not list is refused.
- **Through the platform's own download permission,** the `permissions` point of
  `org.nuxeo.ecm.core.io.download.DownloadService`, which the platform asks before it streams a
  blob. So `/nxfile/` and the REST API's `@blob`, `@rendition` and `@preview` answer 403 to any
  client that calls them, and `Blob.BulkDownload` leaves a refused asset out of its zip.
- **Not yet every path.** Automation operations that return a document's blob, or a conversion of
  it, hand it over without naming the document to that permission, and so are not refused; nor is
  what another add-on serves from its own endpoints. Until the security review settles them (below,
  "What it does not cover"), this is a control on the download endpoints, not on every API.
- **It says why,** through a document enricher, `assetRights`: the decision for each use, with a
  reason code a client translates. The enricher explains; the permission refuses.
- **It enforces nothing on its own.** A package contributes a rights policy for its document type;
  the brand assets kit contributes one for `AcmeAsset`
  ([its README](../business-apps/packages/brand-assets-demo/README.md), "Rights on the server").

## What it refuses, and how

For a document of a type a policy covers, each download is first named as a use:

| The download                                                                                                      | The use                  |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| The policy's original xpath (`file:content` unless it names another), `blobholder:0`, or the `mainBlob` rendition | the original             |
| `picture:views/<n>/content`, with `n` written plainly                                                             | the view, by its title   |
| A rendition, by the name the platform passes                                                                      | the rendition, by name   |
| Any other xpath                                                                                                   | that blob, by its xpath  |
| No xpath: the document's main blob, by its digest                                                                 | the original             |
| Anything else, such as a view's place the document does not have                                                  | unknown, so never listed |

Then decided, the first that applies winning:

| In this order                                                 | Answer | Reason code           |
| ------------------------------------------------------------- | ------ | --------------------- |
| The policy has no rights end or no channels: it is broken     | 403    | `policy-error`        |
| The rights fields cannot be read, or are not a date and text  | 403    | `policy-error`        |
| The policy does not list the use                              | 403    | `not-cleared`         |
| The policy marks the use a preview                            | served | `preview`             |
| The rights end day has passed: from the day after it, in UTC  | 403    | `rights-ended`        |
| The asset's channels do not hold the channel covering the use | 403    | `channel-not-covered` |
| Otherwise                                                     | served | `cleared`             |

- **A version or a proxy has its live document's rights.** A version keeps the fields it had when
  it was made, so rights narrowed since would not reach it: the rights are read from the live
  document, with a privileged session, since a reader of a proxy may not read the live document.
  Its views and its original are still the version's own. One with no live document is refused.
- **A container holding a covered asset is refused its renditions, but its thumbnail.** A folder's
  `zipTreeExport`, or a collection's `containerDefaultRendition`, holds the bytes of each document
  in it, under the container's own type, which no policy covers. So a rendition of a folder, or of
  a collection, is refused, code `contains-assets`, when the reader's own session finds a document
  of a covered type below it or among its members.
- **A preview is decided without reading the rights fields,** so a mistake in them refuses the
  uses they decide and leaves the thumbnails alone.
- **A mistake refuses.** A use with both a channel and `preview="true"`, or neither, is left out,
  and so refused; a use listed twice as a channel and a preview keeps the channel, and listed
  twice with two channels keeps the first; a policy with no type is left out. Each mistake is
  logged as an error when the policy registers.
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

### Administrators

**Not exempt.** No line of the decision reads the user or their groups. Where the platform makes
an exemption unavoidable:

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
  server's own 2025.10.18 jars in place of the 11.5 ones Maven resolves, and all 56 tests pass
  there.

## What it does not cover

- **It decides the downloads the platform's download service is asked for with their document.**
  A blob the platform hands over without naming its document to that service, such as an
  Automation operation's result, and a blob another add-on serves from its own endpoint, are not
  decided here. Which of those must be closed, and how, is the security review's first question.
- **Who may write the rights.** A user who may read an asset and create a document somewhere, in
  their own workspace for one, can copy the asset there, write the copy's channels or rights end,
  and download the copy. Refusing that needs the rights fields written only by a rights manager,
  copies included, which this version does not do.
- **Publishing and share links** are the rest of the plan's rights and sharing add-on: not built.
- **Regions, embargoes and the asset's lifecycle state,** which the prototype also weighs, are not
  read: the kit's stand-in model has regions as free text and no asset lifecycle.

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

- `rightsEnd` names a date property: its day in UTC is the last day the rights cover, and an empty
  one sets no end. `channels` names a text or list property.
- One policy per type, the exact type: a subtype is not covered by its parent's policy. A later
  policy for the type replaces it whole; `enabled="false"` removes it.
- A picture view and the rendition of the same name are listed apart, because they are two
  addresses for one file.

## The `assetRights` enricher

Ask with the header `enrichers.document: assetRights`. For a document no policy covers it writes
`"assetRights": null`. Otherwise its `type`, the server's `today`, the `rightsEnd`, whether it has
`ended`, the `channels`, then `uses`: the original, each picture view the document has by its
title, and each rendition and blob the policy lists, each with `allowed`, `reason`, and the
`channel` that covers it when there is one, and `rightsEnd` when that is the reason; and
`otherwise`, the answer for any use not listed. The client reads it in
`libs/shared/nuxeo-client/src/lib/utils/asset-rights.ts`, and asks for it only after a 403.

## Building and testing it

From the repository's root, with JDK 21 and Maven:

```bash
mvn -pl nuxeo-agentic-assets -am package
```

It runs the module's tests and writes the bundle and the Marketplace package,
`nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.1.0.zip`. `build-marketplace.yml` builds it on
every pull request it runs for, without uploading or publishing it. The tests need no Nuxeo
runtime: documents are proxies that answer only what the code reads.

| Test                           | What it holds                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AssetRightsTest`              | The decision, use by use, in its order, on the kit's policy                                                                              |
| `DownloadUseTest`              | Which use a download is, canonical forms only                                                                                            |
| `RightsPolicyTest`             | A policy read through XMap as the runtime reads it, each mistake a refusal, and the brand kit's own file                                 |
| `AssetRightsComponentTest`     | Policies replaced, removed and broken; unreadable rights refused; versions and proxies by their live document; containers holding assets |
| `DownloadPermissionScriptTest` | The contributed script run through Nashorn 15.7 as `checkPermission` runs it; every failure a `false`                                    |
| `AssetRightsJsonEnricherTest`  | What the enricher writes                                                                                                                 |
| `BundleTest`                   | The manifest's components, their classes, and the package's version                                                                      |

Every guard was seen failing: each of 23 breakages, one at a time (a use not listed let through,
the channel or the end day not checked, the script's `catch` removed, the point misnamed, the kit's
print view given another channel, a version read by its own fields, a container's renditions
served, and the others), turned the tests red, and the build unbroken was green.

The version is `assets.package.version` in `pom.xml`, which `package.xml` takes, and the manifest's
`Bundle-Version` repeats; `BundleTest` refuses a build where they differ.

## Installing it on a local Nuxeo

**Not run yet.** The local Nuxeo is the Docker container `nuxeo`, on port 8080. `nuxeoctl
mp-install` refuses while the server runs, and the server is the container's main process, so a
one-off script installs it when the container next starts, as the kits' READMEs do. Install the
add-on with the brand assets kit 0.2.0, which depends on it, in one restart.

**1. Build both,** from the repository's root:

```bash
mvn -pl nuxeo-agentic-assets -am package
```

```bash
npm run app-package -- business-apps/packages/brand-assets-demo --platform 0.2.0
```

**2. Into the container,** then the one-off script, which removes itself:

```bash
docker cp nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.1.0.zip nuxeo:/tmp/
```

```bash
docker cp business-apps/packages/brand-assets-demo/dist/brand-assets-demo-0.2.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-assets-0.1.0.zip /tmp/brand-assets-demo-0.2.0.zip --accept=true > /var/log/nuxeo/asset-rights-install.log 2>&1 || echo "asset rights: install failed, see /var/log/nuxeo/asset-rights-install.log"' 'rm -f "$0"' > /tmp/zz-asset-rights-install.sh && chmod 755 /tmp/zz-asset-rights-install.sh
```

```bash
docker cp /tmp/zz-asset-rights-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it,** once `http://localhost:8080/nuxeo/runningstatus` answers 200:

- `/var/log/nuxeo/asset-rights-install.log` in the container lists both packages installed;
- the server log's `Component Loading Status` has nothing pending or missing, and names
  `org.nuxeo.agentic.assets.rights`, `org.nuxeo.agentic.assets.rights.download`,
  `org.nuxeo.agentic.assets.rights.enrichers` and `nuxeo.config.brand-assets-demo.rights`;
- the server log has no `Asset rights:` error: a policy's mistakes are logged as it registers;
- once the kit is seeded, `GET /nuxeo/api/v1/path/default-domain/workspaces/acme-brand-assets/assets/ast-503`
  with the header `enrichers.document: assetRights` answers its `contextParameters.assetRights`,
  and `@blob/picture:views/<n>/content` on its `OriginalJpeg` view answers 403;
- the demo: `npm run beta:evidence -- brand-assets-rights`
  ([`scripts/beta-harness/steps/brand-assets-rights.mjs`](../scripts/beta-harness/steps/brand-assets-rights.mjs)).

**Removing it:** remove the kit first, which depends on it, then the add-on, with
`nuxeoctl mp-remove brand-assets-demo nuxeo-agentic-assets --accept=true` in the one-off script in
place of `mp-install`. With it gone, no download is refused for rights.

## For the security review

The plan requires one before this is relied on. It should check:

1. **Every path that hands out an asset's bytes,** listed from the server's own bundles, as this
   README lists the download endpoints: which pass the document to the download service, and which
   do not, such as Automation operations that return a document's blob or a conversion of it
   (`Document.GetBlob`, `Document.GetBlobs`, `Picture.GetView`, `Picture.Resize`,
   `Document.GetRendition`, `Document.GetContainerRendition`, `Document.Export`, `Blob.ToPDF`,
   `Blob.Convert`, and those of the previewer, PDF and video packages), CMIS renditions, and add-ons
   with their own endpoints. For each one that does not, decide how it is closed, or accept it in
   writing. The list can be made again with the read-only scan the pull request describes.
2. **The script and its failure modes:** that `checkPermission` still reads a permission as this
   README says on the release it runs on, that the engine still lets the script reach the class,
   and that refusing every download when the class cannot load is the right failure.
3. **The classification:** that only canonical xpaths are named, that `blobholder:0` and the
   `mainBlob` rendition are the original on every type a policy covers, and that a view is
   trusted by its title.
4. **Who may write the rights fields and view titles** on the kit's types, copies included, and
   whether they must be restricted to a rights manager.
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
