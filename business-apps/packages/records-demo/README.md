# Records (demo)

The records kit, version 0.1.0 ([development plan](../../../docs/business-apps/development-plan.md),
phase 9, "Media rights, records at scale", demo step 2: "A disposition run: the records due,
approved by two people, with a certificate"). It is the app of the records add-on's disposition
review, [`nuxeo-agentic-records`](../../../nuxeo-agentic-records/README.md), on the platform's
retention module. All its data is fictional: no real organisation, office, person or record.

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
- **No button.** A run is started, approved or rejected by filing a request document in the
  disposition runs folder, which the add-on checks on the server (below, "The demo"). Decision 3
  is open, so the app runs no operation, and the add-on registers none.
- **A stand-in model:** one fictional type, `RecordsFile`, for the seed's records. The run, the
  request and the certificate are the add-on's types, not the kit's.
- **A seed** that writes the records under a retention rule of the module's, one of them under a
  legal hold, and the disposition runs folder, at the repository's root, with the kit's groups'
  permissions. It starts no run.

## What is in it

| File                                                                       | What it is                                                                                    | Written by                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `bundle/agentic-ui-config/app.json`                                        | The app: id and address `records`, two groups, `records-managers` and `records-approvers`     | `app-package`                 |
| `bundle/agentic-ui-config/layouts/DispositionRun/view.layout.json`         | A run's record page: three banners, the run, its outcome, its records, approvals and requests | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/layouts/DispositionCertificate/view.layout.json` | A certificate's page: the certificate, who started and approved, the records disposed of      | `app-layout`, then by hand    |
| `bundle/agentic-ui-config/queues/awaiting-approval.json`                   | The runs awaiting approval                                                                    | `app-queue`, then by hand     |
| `bundle/agentic-ui-config/queues/certificates.json`                        | The certificates, the latest disposal first                                                   | `app-queue`, then by hand     |
| `bundle/agentic-ui-config/navigation.json`                                 | The menu: the two queues                                                                      | By hand                       |
| `bundle/agentic-ui-config/labels/en.json`                                  | Every label key the files name, and the fields' names                                         | The generators, then by hand  |
| `bundle/OSGI-INF/records-demo-config.xml`                                  | The component: the two layouts, and the app with the files the registry serves                | The generators                |
| `bundle/OSGI-INF/records-demo-model.xml`, `bundle/schemas/recordsfile.xsd` | **The stand-in model:** `RecordsFile`                                                         | `app-model`                   |
| `bundle/OSGI-INF/records-demo-queues.xml`                                  | The three page providers over the add-on's types. Not the stand-in's: they stay when it goes  | By hand                       |
| `content-model.json`                                                       | The stand-in, and the add-on's four types, as a server with both installed is to answer       | `app-model`, then by a script |
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

It writes `dist/records-demo-0.1.0.zip` and its checksum. The pipeline holds the kit to its own
`content-model.json`, since it ships a stand-in model.

## Installing it, on a server of your own

Not done on any server. In this order:

1. **The retention module,** `nuxeo-retention`, from Nuxeo's Marketplace: Nuxeo supported, with no
   subscription of its own, and available to Nuxeo Online Services customers. Its version for LTS
   2025 must match the server's: its newest builds need LTS 2025.18 or later.
2. **The records add-on,** `nuxeo-agentic-records` 0.1.0, built by Maven
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

A hold put on one of the run's records between the start and the second approval halts the run at
the second approval, with nothing disposed of and the held record named: the add-on's README
describes each refusal.
