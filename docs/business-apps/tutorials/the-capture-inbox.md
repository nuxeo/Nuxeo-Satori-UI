# Tutorial: the capture inbox

For a presales engineer showing mail captured onto claims, and for the administrator who sets it
up: letters uploaded into an inbox, classified, their fields read, matched to the claim they are
about and filed on it by themselves, or queued for a person to confirm or correct; and why the AI
path stays off until the data terms are approved. The server side is
[`nuxeo-agentic-capture`](../../../nuxeo-agentic-capture/README.md) 0.1.0; the app is the P&C
claims kit, [`pc-claims-demo`](../../../business-apps/packages/pc-claims-demo/README.md) 0.2.0, its
"Capture: the mail inbox".

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5`, on macOS with Node 24.22.1 and JDK 21: the add-on's Java tests, the kit's pipeline
build, and the controls of its seed and its intake script. The outputs quoted are that run's,
trimmed. The build and the controls ran again after the branch's merge of `3c1c4c51d`, which added the letters add-on, with the same outputs. No Nuxeo server was read or written. Each step that needs one is marked **Server step**,
and was not run.

## What is built, and what is not

From the add-on's README, "Not done, and not checked":

- **Installed nowhere,** and nothing checked on a server. It is proven by its tests, in Nuxeo's own
  test framework.
- **The AI provider calls nothing real.** It calls two of the AI package's operations,
  `AI.CaptureClassify` and `AI.CaptureExtract`, which **do not exist yet**, so until they do it
  answers "unavailable" and every item waits for a person. The AI data terms are not approved.
- **Intake is an upload** through the REST API, as a scanner or a mail gateway would send one. No
  mail server, drop folder or scanner connector, and no upload from the app: its Create form has no
  file input for a kit's own type.
- **No capture again:** an item that waited for a provider that was down is not read again by
  itself; a person confirms or rejects it.
- **The stand-in's confidence is not a measure.** It is for demonstration servers only.

## 1. Why the AI path is off

The add-on's real provider sends nothing itself: it calls the AI package's operations, and the AI
package sends the item's content to its model provider. The development plan's phase 7 is done only
when "the AI data terms are approved before any real data is sent". So the provider is off by
default, behind two server settings:

| Setting                            | Default                   | What it does                                                                                                                  |
| ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `nuxeo.agentic.capture.provider`   | Unset: nothing classified | `standin` or `ai`. Unset, or not configured, and every item waits, `noProvider`                                               |
| `nuxeo.agentic.capture.ai.enabled` | Off; on only when `true`  | Lets the `ai` provider run. **Set only once the AI data terms are approved** for that server's data, by whoever approves them |

Each is read at each use, from the server's properties only, never from a document, a contribution
or a request. Until the terms are approved, a server uses the stand-in, which reads the file on the
server and sends it nowhere, or no provider at all. `AiProviderTest` holds that the AI provider is
not called while it is switched off, however else the server is set, and that it calls only
operations named `AI.`, sending the item's id and the profile's own definitions, none of the
letter.

## 2. What is filed by itself, and what waits

**The kit's profile,** `pc-claims-mail`, in `bundle/OSGI-INF/pc-claims-demo-capture.xml`: mail in a
`PropertyClaimInbox` is filed on a `PropertyClaim` under the kit's workspace, at a threshold of 0.85.
One class, a claim letter, known by three phrases, "claim number", "policy number" and "date of
loss"; its key, the claim number, of the form `PC-` and five digits, matched to `pclaim:number`.

**The confidence rule,** a function of the profile and the provider's answer alone. An item is filed
with no person only when all four hold, and the first that does not is why it waits:

| #   | The rule                                                                                 | Otherwise                |
| --- | ---------------------------------------------------------------------------------------- | ------------------------ |
| 1   | The class is one of the profile's                                                        | `unknownClass`           |
| 2   | The class has keys, and every key has a value                                            | `missingKey`             |
| 3   | Every key is of its form, and the class's and every key's confidence reach the threshold | `lowConfidence`          |
| 4   | Exactly one record matches                                                               | `unmatched`, `ambiguous` |

At the threshold files, below it waits: 0.85 is filed, 0.8499 is not. A key not of its form counts
as 0, and no record is looked for with it. The threshold is never below 0.5.

**The kit's two fictional letters, as the stand-in reads them,** in the add-on's `KitLetterTest`,
which reads the kit's own profile from its component and the kit's own PDFs:

| Letter                      | The stand-in reads                                                                                                         | So                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `claim-letter-pc-24003.pdf` | A claim letter at 1.0, three phrases of three; claim number `PC-24003`, policy `POL-PC-1002`, from Calder and Finch Bakery | May be filed by itself, on the one claim numbered `PC-24003`  |
| `claim-letter-unclear.pdf`  | A claim letter at 0.33, one phrase of three; claim number `PC-24O08`, with a letter O, so no key                           | Waits, `lowConfidence`, its confidence 0, no claim looked for |

```bash
mvn -B -pl nuxeo-agentic-capture -am verify
```

```text
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, … in org.nuxeo.agentic.capture.KitLetterTest
[INFO] Tests run: 73, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

The 73 include `CaptureTest` (19), each way an item waits and the threshold's edge; `ReviewTest`
(11), the person's part; `ConfidenceRuleTest` (7); `StandInProviderTest` (4); and `AiProviderTest`
(5). The add-on's README lists forty mutations of the code, each of which turned at least one of
them red.

## 3. What waits for a person, and what the person does

An item that waits is in the kit's **Mail to confirm** queue, oldest first, with why it waits, the
class proposed, the confidence and the claim proposed; the home counts them. A person who may write
the item opens it, reads the letter, and in its Edit form:

- **confirms** it as proposed, or **corrects** its class, a field or its claim first, then types
  `confirm` in Decision and saves. A corrected claim number is matched again. The server files the
  letter only on a claim the person may read and write, checked and written as them, and records
  the outcome, `confirmed` or `corrected`, with who and when;
- or **rejects** it: set aside, nothing filed.

An item filed by itself is recorded `automatic`, decided by `system`. Either way the claim's page
lists, under "Mail filed on this claim", each item filed on it, its class, its confidence, how it was
filed, by whom and when, and the letter is among the claim's attachments. **Seeing the queue is not
the control:** the inbox's permissions decide who uploads and who decides, and the claim's who may
have a letter filed on it.

## 4. The kit, built, and its scripts' controls

```bash
npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0
```

```text
4 layouts were held to the content model in business-apps/packages/pc-claims-demo/content-model.json.
11 files: 11 passed, 0 refused.
Compared with the 10 other kits in business-apps/packages: no name of the package's is another's.
pc-claims-demo 0.2.0: checked, built and verified: business-apps/packages/pc-claims-demo/dist/pc-claims-demo-0.2.0.zip, sha256 057ea6aa…62a2fd
```

Its `package.xml` depends on `nuxeo-agentic-capture` 0.1.0. The intake script, `demo/mail-in.mjs`,
and the seed have controls of their own, against a stand-in for the REST API: they prove the
scripts, not a server.

```bash
node business-apps/packages/pc-claims-demo/demo/mail-in.selftest.mjs
node business-apps/packages/pc-claims-demo/demo/seed.selftest.mjs
```

```text
25 of 25 controls passed.
38 of 38 controls passed.
```

## 5. On a server

**Server step, all of it,** from the add-on's README, "Installing it on the local Docker Nuxeo, for
the demo", and the kit's, "Demo step 3". None was run, and each changes the server.

1. **The add-on's package,** `nuxeo-agentic-capture/target/nuxeo-agentic-capture-0.1.0.zip`, which
   the Maven run in step 2 wrote, then the kit's, with `nuxeoctl mp-install`.
2. **The stand-in provider, and not the AI one,** in `nuxeo.conf` itself on a container that has
   started before, since `conf.d` is read at the first start only:

   ```bash
   docker exec nuxeo sh -c 'echo nuxeo.agentic.capture.provider=standin >> /etc/nuxeo/nuxeo.conf'
   docker restart nuxeo
   ```

   Never `nuxeo.agentic.capture.ai.enabled=true` before the data terms are approved for the server's
   data.

3. **The seed,** as an administrator, then **the inbox's permissions,** which the seed does not set:
   `ReadWrite` on the inbox and the claims for the adjusters, and `AddChildren` on the inbox for a
   scanner's account.
4. **The letters come in,** as a scanner sends them, with the credentials of a user who may add to
   the inbox, exported as `NUXEO_USER` and `NUXEO_PASS`:

   ```bash
   node business-apps/packages/pc-claims-demo/demo/mail-in.mjs
   ```

   It creates the inbox when it is not there, uploads each letter, and says what the capture made of
   each. The letter about `PC-24003` is filed on its claim, automatic; the unclear one waits in Mail
   to confirm, "low confidence", with no claim proposed.

5. **An adjuster corrects it:** the claim number `PC-24008`, `confirm`, saved. It is filed on
   `PC-24008`, corrected, by the adjuster, and leaves the queue.

**Before a real provider,** the add-on's security notes list what the review checks for each kit:
who may add to each inbox, since an automatic filing writes the record as the system; the threshold
and the keys, since a forged letter quoting a class's phrases and a real key would be filed by
itself; the retention a letter needs, since a letter is personal data; and, once the AI package's
operations exist, what each sends to its model provider, where, under which terms, and what it
keeps.

## Cleaning up

Nothing here was written outside the kit's `dist/` and Maven's `target/`, which git ignores. On a
server, delete the kit's items first, then uninstall the package, delete the setting's line, and
restart.
