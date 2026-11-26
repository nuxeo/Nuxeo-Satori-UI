# Records (demo)

The records kit, version 0.1.1 ([development plan](../../../docs/business-apps/development-plan.md),
phase 9, "Media rights, records at scale", demo step 2: "A disposition run: the records due,
approved by two people, with a certificate", and its "Done when": "a records specialist accepts the
disposition audit export"). It is the app of the records add-on,
[`nuxeo-agentic-records`](../../../nuxeo-agentic-records/README.md) 0.2.0: its disposition review on
the platform's retention module, its audit export and its access logging. All its data is
fictional: no real organisation, office, person or record.

**Installed nowhere.** The package passes the pipeline, and the add-on's behaviour is proven by its
Java tests in Nuxeo's own test framework. No server has the retention module, the add-on or this
kit, so its pages have not been drawn on records of a server, and its seed has run only against
its controls' stand-in.

## The short version

- **A queue of runs awaiting approval,** the oldest first: each run's number, its starter, when it
  started and how many records it holds.
- **A run's record page:** its state, under a banner that says what it means (awaiting two
  approvals; halted, nothing disposed of; disposed of, permanently); who started it and when; the
  records it holds, each with its type, where it was, its retention rule, the day its retention
  ended, its status and, if it was refused at disposal, why; its approvals, who and when; and the
  requests filed on it, a related list.
- **A certificate's page:** the run, when its records were disposed of and how, who started the
  run and who approved it, and every record disposed of, with its identifiers, its rule and the day
  its retention ended. Its CSV, the attachment, says the same, a row per record, and its SHA-256 is
  on the page.
- **The audit exports,** a queue of the exports a person has filed, the latest first, and an
  export's record page: the folder and the period asked for, who filed it and when, its state under
  a banner that says what it means, how many entries it holds and how many were left out, each
  file's SHA-256, the JSON file, and the export's own history. Its CSV is the export's file. An
  export is filed over the REST API, as a request is (below, "The demo", step 5), and each person
  sees only their own.
- **A records file's page, for a records manager:** the file, and its history, newest first, from
  the platform's audit with the add-on's entries: its rule applied, its retention, its holds placed
  and lifted, each disposition run that held it and each decision, with a filter by kind; and, for
  records managers, its views and file reads. Showing reads to them alone is not a control: the
  platform's audit gives a record's entries to whoever may read it.
- **No button.** A run is started, approved or rejected, and an export filed, by filing a document
  in the disposition runs folder, which the add-on checks on the server (below, "The demo").
  Decision 3 is open, so the app runs no operation, and the add-on registers none. An export has no
  create form: the app's create dialog asks a file of any type with the `file` schema, and an
  export's CSV is that file, which the add-on writes.
- **A stand-in model:** one fictional type, `RecordsFile`, for the seed's records. The run, the
  request and the certificate are the add-on's types, not the kit's.
- **A seed** that writes the records under a retention rule of the module's, one of them under a
  legal hold, and the disposition runs folder, at the repository's root, with the kit's groups'
  permissions: `StartDisposition` and `ExportRecordsAudit` for records managers, `ApproveDisposition`
  for approvers. It starts no run and files no export.

## What is in it

| File                                                                       | What it is                                                                                    | Written by                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `bundle/agentic-ui-config/app.json`                                        | The app: id and address `records`, two groups, `records-managers` and `records-approvers`     | `app-package`                 |
| `bundle/agentic-ui-config/layouts/DispositionRun/view.layout.json`         | A run's record page: three banners, the run, its outcome, its records, approvals and requests | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/layouts/DispositionCertificate/view.layout.json` | A certificate's page: the certificate, who started and approved, the records disposed of      | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/queues/awaiting-approval.json`                   | The runs awaiting approval                                                                    | `app-queue`, then by hand     |
| `bundle/agentic-ui-config/queues/certificates.json`                        | The certificates, the latest disposal first                                                   | `app-queue`, then by hand     |
| `bundle/agentic-ui-config/layouts/RecordsAuditExport/view.layout.json`     | An export's record page: three banners, the request, the export, the JSON file, its history   | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/layouts/RecordsFile/view.layout.json`            | A records file's page: the file, and its history from the audit                               | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/queues/audit-exports.json`                       | The audit exports the reader filed, the latest first                                          | `app-queue`                   |
| `bundle/agentic-ui-config/navigation.json`                                 | The menu: the three queues                                                                    | By hand                       |
| `bundle/agentic-ui-config/labels/en.json`                                  | Every label key the files name, and the fields' names                                         | The generators, then by hand  |
| `bundle/OSGI-INF/records-demo-config.xml`                                  | The component: the two layouts, and the app with the files the registry serves                | The generators                |
| `bundle/OSGI-INF/records-demo-model.xml`, `bundle/schemas/recordsfile.xsd` | **The stand-in model:** `RecordsFile`                                                         | `app-model`                   |
| `bundle/OSGI-INF/records-demo-queues.xml`                                  | The four page providers over the add-on's types. Not the stand-in's: they stay when it goes   | By hand                       |
| `content-model.json`                                                       | The stand-in, and the add-on's five types, as a server with both installed is to answer       | `app-model`, then by a script |
| `demo/seed.mjs`, `demo/data.mjs`                                           | The seed and its fictional records. Not packaged                                              | By hand                       |
| `demo/seed.selftest.mjs`                                                   | The seed's controls, against a stand-in for the REST API it calls. Not packaged               | By hand                       |
| `package/package.xml`                                                      | The Marketplace package; it depends on `nuxeo-agentic-ui` and `nuxeo-agentic-records`         | `app-package`, then by hand   |
| `build.mjs`                                                                | Version 1's builder: the generator's, byte for byte                                           | `app-package`                 |

- **The add-on's types in `content-model.json`** were added from the add-on's XSDs, since
  `app-model` writes the stand-in's own types only and the package must not register the add-on's.
  The pipeline holds the layouts to them, so a field of a run or a certificate that the add-on
  does not have is refused.
- **The page providers** read the repository with the reader's permissions: a person who may not
  read the disposition runs folder sees no run and no certificate. The queues have no facets: a
  facet needs a page provider the search index answers, and these do not.
- **One version in three places:** `package.xml`'s, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`.

## Building it

```bash
npm run app-package -- business-apps/packages/records-demo --platform 0.2.0
```

It writes `dist/records-demo-0.1.1.zip` and its checksum. Held to the kit as it was, as CI holds
it, with `--previous`:

```bash
mkdir -p /tmp/base
git archive origin/staging/enterprise-grade-app business-apps/packages/records-demo | tar -x -C /tmp/base
npm run app-package -- business-apps/packages/records-demo --platform 0.2.0 \
  --previous /tmp/base/business-apps/packages/records-demo
```

0.1.1 adds two layouts, a queue, a menu entry and their labels, and depends on the add-on's 0.2.0:
nothing a customer may override is removed or renamed, so a patch. Seen failing on 26 November
2026: with its version left at 0.1.0, step 3 refused it, "the content changed since 0.1.0 (52
changes)". The pipeline holds the kit to its own
`content-model.json`, since it ships a stand-in model.

## Installing it, on a server of your own

Not done on any server. In this order:

1. **The retention module,** `nuxeo-retention`, from Nuxeo's Marketplace: Nuxeo supported, with no
   subscription of its own, and available to Nuxeo Online Services customers. Its version for LTS
   2025 must match the server's: its newest builds need LTS 2025.18 or later.
2. **The records add-on,** `nuxeo-agentic-records` 0.2.0, built by Maven
   ([its README](../../../nuxeo-agentic-records/README.md)), and **this kit**, with
   `nuxeoctl mp-install`, then a restart.
3. **The groups** `records-managers` and `records-approvers`, and the people in them, in the server's
   directory. A run needs three people: one who starts it, and two others who approve it.
4. **The seed,** as an administrator: `node business-apps/packages/records-demo/demo/seed.mjs`, with
   `NUXEO_USER` and `NUXEO_PASS` exported. Add `--end-retention-now` to have the platform end the
   records' retention once their minute has passed, rather than at its next hourly check.

## The demo

Phase 9's demo step 2, by three people of the server's groups: a records manager, and two
approvers. Each step is a document filed in the disposition runs folder, over the REST API, with the
person's own credentials; the add-on checks it on the server and answers 403 or 409 when it refuses.
The folder is `/disposition-runs`, at the repository's root, where the add-on takes requests only.

1. **The records due.** A records manager starts a run:

   ```bash
   curl -sS --fail-with-body -u "$MANAGER" -H 'Content-Type: application/json' \
     -X POST "$NUXEO_URL/nuxeo/api/v1/path/disposition-runs" \
     -d '{"entity-type":"document","type":"DispositionRequest","name":"start","properties":{"dreq:action":"start"}}'
   ```

   The answer's `dreq:run` is the new run. Its page lists the four records whose retention has
   ended, and not the held one. It is in the queue of runs awaiting approval.

2. **Refused on the server.** The same manager approving the run is refused, 403, `self-approval`.

3. **Two approvals.** An approver files `{"dreq:action":"approve","dreq:run":"<the run's id>"}`;
   the run still awaits one more, and the same approver filing again is refused, 409. A second
   approver files the same: the run's four records are deleted, and its page says so.

4. **The certificate.** The run's page links its certificate: the four records, their rule and the
   day their retention ended, who started the run and who approved it, and when. Its CSV is the
   certificate's file, for the records specialist's review.

5. **The audit export.** The records manager files an export of the records folder over the period
   of the demo:

   ```bash
   curl -sS --fail-with-body -u "$MANAGER" -H 'Content-Type: application/json' \
     -X POST "$NUXEO_URL/nuxeo/api/v1/path/disposition-runs" \
     -d '{"entity-type":"document","type":"RecordsAuditExport","name":"export","properties":{
          "rexp:path":"/default-domain/workspaces/records-demo/files",
          "rexp:from":"<the demo day>T00:00:00Z","rexp:to":"<the next day>T00:00:00Z"}}'
   ```

   An approver filing the same is refused, 403, `permission`. A period that ends after the
   filing ends when it is filed. The export is written in the background, 30 seconds after its
   period's end, once the audit's last entries are in: it is in the queue of audit exports, `done`. Its page gives the
   number of entries and each file's SHA-256; the CSV, its file, has a row per entry of the audit,
   and the JSON file the same. For each record disposed of: its rule applied, the run that held it,
   both approvals, its disposal with the certificate's id and SHA-256, and the platform's deletion;
   for the held record, its hold. The records specialist checks it as the add-on's README says
   ("What a records specialist checks in the export").

6. **A record's history.** The held record's page shows its history: its rule applied, its hold,
   and the views of it, each with who and when.

A hold put on one of the run's records between the start and the second approval halts the run at
the second approval, with nothing disposed of and the held record named: the add-on's README
describes each refusal.
