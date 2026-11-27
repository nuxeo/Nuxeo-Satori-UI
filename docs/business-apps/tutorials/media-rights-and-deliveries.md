# Tutorial: rights, release windows, watermarks and delivery packages for media

For a presales engineer showing media distribution, and for the administrator who sets it up: a
fictional film with its localised versions, each version's own rights, the film's release windows
by territory and channel, a delivery to a distributor taken inside its window and refused outside
it, refused whole when one file is refused, the key art marked for its distributor, and a still
served marked to an outside partner. The server side is
[`nuxeo-agentic-assets`](../../../nuxeo-agentic-assets/README.md) 0.5.0; the app is the media kit,
[`media-demo`](../../../business-apps/packages/media-demo/README.md) 0.2.0.

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5`, on macOS with Node 24.22.1 and JDK 21: the add-on's Java tests, the kit's pipeline
build, its seed's controls and its demo's steps file on the kit's stand-in server. The outputs
quoted are that run's, trimmed. No Nuxeo server was read or written. Each step that needs one is
marked **Server step**, and was not run.

## What is built, and what is not

From the two READMEs:

- **Installed nowhere.** No server has the add-on 0.5.0 or the kit: the local Nuxeo has the
  add-on's 0.1.0. The kit's pages have not been drawn on a server's records; its seed and its steps
  file have run only on the kit's stand-in, `demo/stand-in.mjs`.
- **The server's decisions are the add-on's Java tests',** in Nuxeo's own test framework, on H2.
  Not held there: the REST API's answer to a refused delivery, and a check-in or a restore of a
  delivery, which is not versionable.
- **A delivery moves no byte.** It is the record of what was delivered: the files by their digests,
  to whom, where and when, and the key art marked. Handing the files over is not built.
- **The master is not watermarked.** The kit's master is a text placeholder; a real one would be
  marked through the server's video tools, which need ffmpeg, which the local Nuxeo does not have.
- **Not every path.** The rights and the watermark are decided at the download endpoints, a stored
  file handed over with no document, the `Video.*` operations and share links. An operation that
  returns a conversion of a file, such as `Blob.ToPDF`, hands it over unmarked, whatever the rights,
  until the security review settles it (the add-on's README, "What it does not cover").
- **No button.** Decision 3 is open: a delivery is filed as a document, over the REST API.
- **Share links are a new path that needs no sign-in,** not to be relied on before their security
  review.

## 1. The rights, in the kit's policy

A kit contributes a rights policy for its document type; the add-on enforces it on the server, for
every user, administrators included. The media kit's is
[`bundle/OSGI-INF/media-demo-rights.xml`](../../../business-apps/packages/media-demo/bundle/OSGI-INF/media-demo-rights.xml),
for a localised version, `FilmVersion`:

| What               | Where the policy reads it                                                             |
| ------------------ | ------------------------------------------------------------------------------------- |
| Rights end         | `dc:expired`, the version's own                                                       |
| Channels           | `fver:channels`, the version's own                                                    |
| Territories        | `fver:territories`, the version's own: where it may be delivered                      |
| Release windows    | its film's `film:windows`, through `fver:film`, which must name a `Film`              |
| What each file is  | the master and the subtitles cleared for `SVOD`, the key art for `Marketing`          |
| A delivery package | the master, the subtitles and the key art                                             |
| The watermark      | the still, as a preview, for anyone outside the staff; the key art, in every delivery |

The seeded film is _The Lighthouse at Saltmere_, of the fictional Acme Pictures. Its windows are
days from the seed's day, in UTC, so the demo holds for 30 days after a seed (`demo/data.mjs`):

| Territory | SVOD                   | Marketing                                        |
| --------- | ---------------------- | ------------------------------------------------ |
| FR        | open                   | open                                             |
| BE        | open                   | closed: its window ended the day before the seed |
| DE        | opens 35 days after it | open                                             |

And the versions' own territories: the French version may go to France, Belgium and Switzerland,
the German version to Germany, Austria and Switzerland.

**What a delivery to a territory needs, for each of its files:** the version's rights not ended, its
channels holding the file's channel, its territories holding the territory, and a window of its
film for that channel open there today. One file refused refuses the package whole, and nothing is
made. **A download names no territory:** a file is served while a window for its channel is open in
any territory the version may go to.

## 2. The add-on's own tests

```bash
mvn -B -pl nuxeo-agentic-assets -am verify
```

```text
[INFO] Tests run: 241, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Among them `MediaDeliveryTest` (17), the deliveries decided and refused, and `WatermarkPolicyTest`
(9), the watermark's rules, each a policy that breaks one refused whole rather than served unmarked.

## 3. The kit, built

```bash
npm run app-package -- business-apps/packages/media-demo --platform 0.2.0
```

```text
3 layouts were held to the content model in business-apps/packages/media-demo/content-model.json.
8 files: 8 passed, 0 refused.
Compared with the 10 other kits in business-apps/packages: no name of the package's is another's.
media-demo 0.2.0: checked, built and verified: business-apps/packages/media-demo/dist/media-demo-0.2.0.zip, sha256 8dbcf777…71d83
```

Its `package.xml` depends on `nuxeo-agentic-assets` 0.5.0. The delivery is the add-on's type,
`MediaDelivery`, not the kit's: the kit's `content-model.json` describes it, so the pipeline holds
the delivery's page and the queue to the add-on's properties.

## 4. The demo, on the kit's stand-in

The seed's controls, 64 of them, run the seed against the stand-in and hold the demo's cases to the
seeded data:

```bash
node business-apps/packages/media-demo/demo/seed.selftest.mjs
```

```text
ok   no credentials: exit 2
ok   no credentials: nothing asked of the server
…
Every control passed.
```

The demo's steps file, with no server named, starts the stand-in, seeds it with the kit's own seed,
and files the demo's deliveries there over the REST API, as a distribution coordinator would. It
needs no credentials, and sends none:

```bash
npm run beta:evidence -- media-delivery
```

```text
[step 2] 1. Inside its window: the French version delivered to a distributor in France
  [pass] delivered: 201
  [pass] what was delivered: the master and the subtitles for SVOD, the key art for Marketing
  [pass] each delivered file by the digest the version holds
  [pass] the key art marked for its distributor, the mark's text naming them and the day
  [pass] the delivery holds the key art marked, a JPEG apart from the version’s
[step 3] 1. Outside its window: the German version refused in Germany, before SVOD opens there
  [pass] outside: refused, 403, outside-window
  [pass] outside: nothing made
[step 4] Refused whole: the French version to Belgium, where Marketing has closed
  [pass] whole: the refusal names files:files/2/file outside-window for Marketing
  [pass] whole: the refusal does not name original
  [pass] whole: nothing made
[step 5] A version's own rights: the French version to Germany, which it may not go to
  [pass] territory: refused, 403, territory-not-covered
[step 6] The still, for an outside partner: refused unmarked, served marked
  [pass] the still served as it is to the coordinator, whom the watermark exempts: a PNG
  [pass] the still refused unmarked to the outside partner, 403 watermark-required
  [pass] the still served marked to the partner: a JPEG, apart from the still
  [note] the record pages, … the stand-in serves no app …
  [note] the server's own decision and its marks: held by the add-on's tests in Nuxeo's test framework, MediaDeliveryTest and WatermarkPolicyTest, not by this run
verdict  PASS  (33/33 checks passed)
```

The report is written outside the repository, under `~/Desktop/agentic-ui-evidence/beta/`.

**What this proves, and what it does not.** The demo's script and its data: that the seeded windows
put the French version inside them in France and the German one outside them in Germany, and that a
delivery's record says what the demo says. The stand-in decides as the add-on does, from the kit's
own policy file, but **the stand-in's marked file is not the server's:** it answers a small grey JPEG
holding the text in a comment, so that the text can be read back. The server's decisions and marks
are the Java tests' (step 2).

## 5. On a server

**Server step, all of it.** None was run.

1. **Install,** in this order (the kit's README, "Installing it, on a server of your own"): the
   add-on 0.5.0, `nuxeo-agentic-assets/target/nuxeo-agentic-assets-0.5.0.zip`, which step 2's
   Maven run wrote, and the kit, with `nuxeoctl mp-install`, then a restart. The add-on's share links open a path that needs no
   sign-in: read its README's install section first.
2. **The groups** `media-rights`, `media-distribution` and `media-partners`, and the people in them,
   in the server's directory. The kit creates none.
3. **The seed,** as an administrator, with `NUXEO_USER` and `NUXEO_PASS` exported:
   `node business-apps/packages/media-demo/demo/seed.mjs`. To seed again, delete the kit's
   workspace first.
4. **A delivery inside its window,** by a member of `media-distribution`, with their own credentials
   in `COORDINATOR` as `user:password`, never typed on the command line. `<the French version>` is
   its id, which its page shows:

   ```bash
   curl -sS --fail-with-body -u "$COORDINATOR" -H 'Content-Type: application/json' \
     -X POST "$NUXEO_URL/nuxeo/api/v1/path/default-domain/workspaces/media-demo/deliveries" \
     -d '{"entity-type":"document","type":"MediaDelivery","name":"fr","properties":{
          "mdlv:version":"<the French version>","mdlv:distributor":"Acme Distribution France",
          "mdlv:territory":"FR"}}'
   ```

   The add-on writes the record over anything the filer wrote: each file's channel, name, type,
   length and digest, who and when, and the key art marked `ACME PICTURES · FOR Acme Distribution
France · <the coordinator> · <the day>`. Its `mdlv` properties cannot be changed after, whoever
   asks: 403 `kept`.

5. **Outside it, and refused whole:** the German version to `DE`, 403 `outside-window`; the French
   version to `BE`, refused for the key art alone, and nothing made; the French version to `DE`, 403
   `territory-not-covered`.
6. **The still for an outside partner,** a member of `media-partners`, `PARTNER` as `user:password`:
   the download endpoints refuse it unmarked, 403 `watermark-required`, and the add-on's operation
   serves it marked, naming them:

   ```bash
   curl -sS --fail-with-body -u "$PARTNER" -H 'Content-Type: application/json' -o still.jpg \
     -X POST "$NUXEO_URL/nuxeo/api/v1/automation/Asset.GetWatermarked" \
     -d '{"input":"doc:<the French version>","params":{"use":"blob:files:files/3/file"}}'
   ```

7. **The same steps file on the server:** `MEDIA_DEMO_SERVER=<the server's address>`, with
   `NUXEO_USER` and `NUXEO_PASS` a member of `media-distribution`, and `MEDIA_PARTNER_USER` and
   `MEDIA_PARTNER_PASS` a member of `media-partners`, then `npm run beta:evidence -- media-delivery`.
   Without the partner's pair, its checks are not run, and a note says so.
8. **The pages:** a film's page with its windows and versions, a version's page with its rights,
   files and deliveries, the queue of deliveries and a delivery's page, through the dev server or
   the installed app.

## Cleaning up

Nothing here was written to the repository but the kit's `dist/` and Maven's `target/`, which git
ignores. On a server, delete the kit's workspace, then remove the kit.
