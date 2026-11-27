# Nuxeo Agentic Capture

Capture and classification: mail into an inbox, then classified, its fields extracted into the
inbox's schema, matched to the record it is about, and filed on it. The first slice of phase 7's
"capture and classification … through the AI package's Claude provider" in the business apps
[development plan](../docs/business-apps/development-plan.md), for its demo step 3, "A scanned claim
letter classified, its fields extracted, and filed on the claim", with the
[P&C claims kit](../business-apps/packages/pc-claims-demo/README.md#capture-the-mail-inbox).

Built on decision B's recommendation, one add-on per domain module
([decision log](../docs/business-apps/decisions.md)): a Maven module of its own with its own
Marketplace package, `nuxeo-agentic-capture`, which the P&C claims kit depends on.

**Nothing here is installed on any server yet.** It is proven by its tests, in Nuxeo's own test
framework. The install and the demo below are for the reviewer.

## Before the AI provider is switched on

The add-on's real provider sends nothing of an item itself: it calls the AI package's operations,
and the AI package then sends the item's content to its model provider, Claude among them once the
AI package has it. **Phase 7 is done only when "the AI data terms are approved before any real data
is sent"** ([plan](../docs/business-apps/development-plan.md#phase-7-records-that-live-elsewhere-8-weeks)).
So the provider is off by default, and stays off until a server sets both
`nuxeo.agentic.capture.provider=ai` and `nuxeo.agentic.capture.ai.enabled=true`. **Set the second
only once the AI data terms are approved for that server's data**, by whoever approves them.
Until then a server uses the stand-in, which reads the file on the server and sends it nowhere, or
no provider at all, and every item waits for a person.

## The short version

- **Intake: an upload into an inbox.** An inbox is a folder of the type a kit's capture profile
  names; an item is a document of the profile's item type, which carries the add-on's
  `CaptureItem` facet and the platform's `file` schema, created in the inbox with its file. A
  scanner, a mail gateway or a script creates it through the REST API, as the kit's
  `demo/mail-in.mjs` does. No mail server, and no drop folder ([below](#intake)).
- **In the background, once the upload has committed,** as the system: the server's provider
  classifies the item into one of the profile's classes, and extracts that class's fields, each with
  a confidence from 0 to 1. The upload is never held up by a provider, or refused by one.
- **Matched** to an existing record by the class's keys: each key field names the record's
  property its value must equal, such as a claim's number, `pclaim:number`. Exactly one live record
  of the profile's type, under its folder, must match.
- **The confidence rule:** an item is filed with no person only when its class is one of the
  profile's, every key has a value of its form, the class's confidence and every key's are at least
  the profile's threshold (0.85 unless it says otherwise, never below 0.5), and exactly one record
  matches. Anything else waits for a person, with its reason ([below](#the-confidence-rule)).
- **Filed:** the item's file added to the record's attachments, `files:files`; the item kept,
  linked to its record, with its class, its confidence and the provider's reading as they were;
  and an audit entry on the record and on the item.
- **The person's part:** an item that waits is in its kit's queue. A person who may write it
  confirms it as proposed, corrects its class, a field or its record, or rejects it, through its
  Edit form. Confirming files it on the record, and only on one the person may write, checked and
  written as them.
- **Two providers.** `standin`, deterministic, which reads the file's own text and calls nothing;
  and `ai`, which calls the AI package's `AI.*` operations, off until the server turns it on. A
  provider is one class of the add-on's interface ([below](#the-provider-interface)).
- **No secret in a log, and no content:** the add-on logs ids, reasons and kinds of failure, never
  a value, a file or a provider's message, which a test holds to. It has no credential of its own.

## What is in it

| File                                                        | What it is                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/capture/`                  | The bundle: the provider interface, the profiles, the rule, matching, filing, the listeners |
| `src/main/java/org/nuxeo/agentic/capture/standin/`          | The stand-in provider, `StandInProvider`                                                    |
| `src/main/java/org/nuxeo/agentic/capture/ai/`               | The AI package's provider, `AiPackageProvider`                                              |
| `src/main/resources/OSGI-INF/capture-schema-contrib.xml`    | The `CaptureItem` facet and its schema, `capture_item` (`capt:`)                            |
| `src/main/resources/OSGI-INF/capture-service.xml`           | The component `org.nuxeo.agentic.capture`: its `providers` and `profiles` extension points  |
| `src/main/resources/OSGI-INF/capture-providers-contrib.xml` | Registers `standin` and `ai`                                                                |
| `src/main/resources/OSGI-INF/capture-listener-contrib.xml`  | The listeners: receiving and the guards, the background capture, the audit's writer         |
| `src/main/package/`                                         | The Marketplace package, `nuxeo-agentic-capture` 0.1.0                                      |
| `src/test/java/`                                            | 73 tests: 54 in Nuxeo's test framework, 19 with no runtime                                  |

## Intake

**Chosen: an upload into an inbox document,** since no mail server is needed for the demo. A
configured drop folder, a directory on the server that the add-on would read, was not built: it
needs a scheduler, a file system the server writes, and a decision on who an item from it is
created by, none of which an upload does.

- An item is created in its inbox, with its file, by anyone the inbox's permissions let add to it,
  `AddChildren`: a scanner's account, a mail gateway's, or a person. Nuxeo's own permissions decide
  who uploads; the add-on adds none of its own.
- **Through the REST API,** a batch upload then a document created with it, as the kit's
  `demo/mail-in.mjs` does. Not yet through the app: its Create form has no file input for a kit's
  own type, and its import picks Nuxeo's own file types only (the kit's README, "Where the tools
  fell short").
- An item of a profile's type created anywhere but in a folder of its inbox type is refused, and so
  is one with no file, one larger than the server takes (20 MiB unless it says otherwise), and one
  given any `capt:` property.

## The model

**`CaptureItem`, on a kit's item type,** schema `capture_item`, prefix `capt`. The server writes
every property but five, a person's, which they may set while the item waits.

| Property                                     | Who    | What it holds                                                                                                                     |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `capt:status`                                | Server | `received`, then `filed` or `review`; from `review`, `filed` or `rejected`                                                        |
| `capt:reason`                                | Server | Why it waits: `lowConfidence`, `unknownClass`, `missingKey`, `unmatched`, `ambiguous`, `noProvider`, `providerFailed`, `notFiled` |
| `capt:profile`, `capt:provider`              | Server | The profile it was received under, and the provider that read it, by id                                                           |
| `capt:receivedAt`, `capt:classifiedAt`       | Server | When it came in, and when it was read                                                                                             |
| `capt:digest`                                | Server | The platform's digest of its file                                                                                                 |
| `capt:proposedClass`, `capt:classConfidence` | Server | The provider's class and its confidence, kept as they were                                                                        |
| `capt:extracted`                             | Server | The provider's reading: each field's `name`, `value` and `confidence`, kept as it was                                             |
| `capt:confidence`                            | Server | The item's: the least of the class's and its keys'                                                                                |
| `capt:proposedRecord`                        | Server | The one record its keys matched, by id                                                                                            |
| `capt:class`, `capt:fields`, `capt:record`   | Person | Set from the proposal when it is read; a person corrects them while it waits                                                      |
| `capt:note`, `capt:decision`                 | Person | A note; and `confirm` or `reject`, which the server acts on and empties                                                           |
| `capt:outcome`                               | Server | `automatic`, `confirmed`, `corrected` or `rejected`                                                                               |
| `capt:decidedBy`, `capt:decidedAt`           | Server | Who decided, `system` for an automatic filing, and when                                                                           |
| `capt:attachment`                            | Server | The file's name on the record                                                                                                     |

**A profile, in a kit's contribution,** at `org.nuxeo.agentic.capture`'s `profiles`:

```xml
<profile id="pc-claims-mail">
  <inboxType>PropertyClaimInbox</inboxType>
  <itemType>PropertyClaimMail</itemType>
  <recordType>PropertyClaim</recordType>
  <recordPath>/default-domain/workspaces/pc-claims-demo</recordPath>
  <threshold>0.85</threshold>
  <class name="claimLetter" label="Claim letter">
    <description>A letter about an existing property claim</description>
    <keyword>claim number</keyword>
    <field name="claimNumber" label="Claim number" match="pclaim:number" format="PC-[0-9]{5}" />
    <field name="sender" label="From" />
  </class>
</profile>
```

- **Checked when it is registered:** an id of lower-case letters, digits and `-`; three distinct
  type names; a `recordPath` from the root with no quote or backslash; a threshold from 0.5 to 1;
  1 to 20 classes and 1 to 30 fields each, every name once; a `match` that is a property,
  `prefix:name`; a `format` that is a pattern. A profile that breaks a rule is not registered, and
  an earlier one of the same id is removed with it, so a broken change never leaves the old one
  capturing; the server's log says which rule. Two profiles may not capture the same item type in
  the same inbox type.
- **The record type must keep attachments,** the `files` schema: an item matched to a record that
  keeps none waits for a person, `notFiled`.
- **A class with no key** is never filed by itself: its items wait, `missingKey`, for a person to
  name the record.

## How a capture goes

`CaptureIntakeListener`, in the background once the creation has committed, then `Capture.run`, as
the system, in a transaction of its own:

1. **Only an item still received** is taken, and only under a claim of its capture in the
   key/value store, so a capture run again, or run twice at once by a redelivery, files nothing
   twice and writes nothing over the other's.
2. **The provider** the server names, registered and configured: none, and the item waits,
   `noProvider`.
3. **Classified,** then, for a class of the profile's, **its fields extracted.** A provider that
   fails, or throws, leaves the item waiting, `providerFailed`, and the log names its kind only.
4. **What it answered is checked** ([below](#the-confidence-rule)), and kept as the proposal; the
   person's fields are set from it.
5. **Matched,** when every key has a value of its form, as the system, with each value quoted and
   escaped by the platform's NXQL escaping: live records of the profile's type, under its
   `recordPath`, two at most asked for.
6. **Filed or queued.** Filed: the item's filing claimed in the key/value store, the file added to
   the record's attachments (not twice, by its digest), the item marked filed, and the audit's two
   entries. Queued: the item set to wait, with its reason, and an audit entry.

Then, whatever happened, in a transaction of its own: an item still received, whose capture this
run holds or no one does, is set to wait, `notFiled`. So a capture that threw, or whose
transaction was rolled back without a word, as one a provider or another listener marks for
rollback is, leaves no item received. A capture lost before it ran at all, as a background job
lost with its node, does: the item stays received, and is not seen by the queue.

## The confidence rule

`ConfidenceRule`, a function of the profile and the provider's answer alone. An item is filed with
no person only when all of these hold, and the first that does not is its reason:

| #   | The rule                                                                                                    | Otherwise                |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | The class is one of the profile's                                                                           | `unknownClass`           |
| 2   | The class has keys, and every key has a value                                                               | `missingKey`             |
| 3   | Every key's value is of its `format`, and the class's confidence and every key's are at least the threshold | `lowConfidence`          |
| 4   | Exactly one record matches                                                                                  | `unmatched`, `ambiguous` |

- **At the threshold files, below it waits:** 0.85 is filed, 0.8499 is not.
- **A key not of its form counts as 0,** and no record is looked for with it: a claim number read
  `PC-24O08`, or a value with a quote in it.
- **A confidence that is not a number from 0 to 1** (none, `NaN`, negative, over 1) counts as 0.
- **A value** has its control characters dropped and is at most 1,000 characters; only the class's
  fields are kept, each once, the first given.
- **A field that is no key decides nothing,** whatever its confidence: it is kept, with its own.
- **The item's confidence** is the least of the class's and its keys'.

## The person's part

An item that waits is in its kit's queue. Its Edit form shows the class, the fields, the record, a
note and the decision; each is the person's to change while it waits, and only then.

- **Checked whatever they decide:** a class of the profile's; fields of that class, each once, each
  value at most 1,000 characters with no control character; a record's id; a note of at most 1,000
  characters. 400 otherwise.
- **Confirm** files it:
  - **the record** is the one the person names; or, when they corrected a key and left the record
    as it was, or name none, the one record the keys match, as the system: none is 400, two 409;
  - **read as the person:** one they may not read is 403, one not there 400; it must be of the
    profile's type, live, under its folder, and keep attachments (400);
  - **its keys are the item's:** a key the person gave that is not the record's is 400, and a key
    they left empty is filled from the record;
  - **the person may write it,** `Write`: 403 otherwise. The file is then added as them, through
    their session, so the platform checks the same again, and the record's history names them;
  - **claimed** in the key/value store: an item being filed at this moment is 409;
  - **the outcome** is `confirmed` when the class, the fields and the record are the proposal's,
    and `corrected` otherwise.
- **Reject** sets it aside, `rejected`, with who and when; nothing is filed.
- **An item filed or rejected,** or still received, is not decided on: 409. Nor is one whose
  profile is no longer on the server: an administrator deletes it, or restores the profile.
- **A class changed:** the fields are the new class's, so a field of the old one is cleared first
  (400 otherwise).

## The guards

| What                                                         | Who may                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Create an item                                               | Whoever may add to its inbox; only there, with its file, and nothing of `capt:`                              |
| Change the server's `capt:` properties                       | The server only, an administrator included: a mark on its own writes, taken off by the write it lets through |
| Change an item's file                                        | No one: it is what came in                                                                                   |
| Change the person's `capt:` properties                       | Whoever may write the item, while it waits                                                                   |
| File an item on a record                                     | The system, by the rule; or a person who may write the item and the record                                   |
| Add or remove the `CaptureItem` facet                        | No one: it comes with the type                                                                               |
| Copy an item, or a folder holding one                        | No one                                                                                                       |
| Restore an item of a type that keeps versions to one of them | No one: it would put a filed or rejected item back to waiting                                                |
| Trash or delete an item                                      | Whoever the platform lets: a filed item's file stays on its record, and the audit                            |

## The provider interface

`org.nuxeo.agentic.capture.CaptureProvider`, registered by a contribution:

```xml
<extension target="org.nuxeo.agentic.capture" point="providers">
  <provider id="standin" class="org.nuxeo.agentic.capture.standin.StandInProvider" />
</extension>
```

| Method                       | What a provider does                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `init(id, settings)`         | Keeps its id and where its settings are read, `CaptureSettings`: the server's properties |
| `configured()`               | Whether the server has given it all it needs, and lets it run                            |
| `classify(submission)`       | The item's class, one of the profile's or none, and a confidence from 0 to 1             |
| `extract(submission, class)` | The class's fields read from the item, each with a confidence from 0 to 1                |

A submission is the system's session, the item, its file and its profile. A provider throws
`CaptureProviderException` with a kind, `UNAVAILABLE`, `FAILED` or `UNREADABLE`, whose message is
the kind's one sentence. The add-on keeps everything that does not depend on the provider: the
profile, the rule, matching, filing, the person's part and the guards. Whatever a provider answers
is checked again, and a value it gives is never a query, a path or an id.

## The stand-in

`StandInProvider`, `standin`, for development and demonstration servers. No service, no setting.

- It reads the item's file as text, its first MiB, one byte a character: a text file, or a PDF
  whose text is not compressed, as the kit's letters are. A scanned image gives it nothing, so its
  item waits for a person.
- **Its class** is the profile's class with the largest share of its keywords in the text, in any
  letter case, the first declared on a tie; its confidence is that share, to two places: three of
  three is 1.0, two of three 0.67. No keyword, no class.
- **A field** is read where the text says its label, a colon, and the value, to the line's end or a
  parenthesis, 200 characters at most; its confidence is 0.97, or 0.4 when its value is not of the
  field's form. A label inside another word is not the label.

## The AI package's provider

`AiPackageProvider`, `ai`: classification and extraction through two of the AI package's
Automation operations, in the server's process, as the app's AI features reach theirs
([AGENTS/10-ai-features.md](../AGENTS/10-ai-features.md)). The AI package holds the model provider,
its credentials and its prompts; the add-on holds none, adds no HTTP client, no SDK and no address,
and needs no dependency beyond the platform's Automation service.

**What the add-on asks of the AI package.** Two operations, which the AI package is to provide with
its Claude provider; neither is in it yet, so until then the provider answers `UNAVAILABLE` and
every item waits for a person:

| Setting, and its default                                           | Given                                                                               | Answers                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `nuxeo.agentic.capture.ai.classifyOperation`, `AI.CaptureClassify` | `docId`; `classesJson`, the classes' names, labels and descriptions                 | `{"class": "<name>" or null, "confidence": <0 to 1>}`                          |
| `nuxeo.agentic.capture.ai.extractOperation`, `AI.CaptureExtract`   | `docId`; `class`; `fieldsJson`, its fields' names, labels, descriptions and formats | `{"fields": [{"name": "<field>", "value": "<text>", "confidence": <0 to 1>}]}` |

- **Sent:** the item's id, from which the AI package reads the item, and the profile's own
  definitions. No value of the item's, no setting and no credential.
- **Run as the system, in a transaction of its own,** so that an operation's failure, which
  Automation answers by marking its transaction for rollback, leaves the capture's own able to set
  the item waiting.
- **Read back:** a text or a file, at most 256 KiB, parsed as a JSON object; anything else is
  `UNREADABLE`. An operation not on the server, as when the AI package is not installed, is
  `UNAVAILABLE`; one that fails is `FAILED`. Each leaves the item waiting, `providerFailed`.
- **Only the AI package's:** an operation's id must be `AI.` and letters and digits. A setting that
  names any other is not used, and the provider is not configured, so it can call nothing else.

## Settings

| Setting                                      | Default                   | What it does                                                                                                                                                   |
| -------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nuxeo.agentic.capture.provider`             | Unset: nothing classified | The provider items are read through, by id: `standin` or `ai`. Unset, or one not registered or not configured, and every item waits for a person, `noProvider` |
| `nuxeo.agentic.capture.ai.enabled`           | Off; on only when `true`  | Lets the `ai` provider run. **Only once the AI data terms are approved** ([above](#before-the-ai-provider-is-switched-on))                                     |
| `nuxeo.agentic.capture.ai.classifyOperation` | `AI.CaptureClassify`      | The AI package's classification operation; one not `AI.` leaves the provider unconfigured                                                                      |
| `nuxeo.agentic.capture.ai.extractOperation`  | `AI.CaptureExtract`       | The AI package's extraction operation; the same                                                                                                                |
| `nuxeo.agentic.capture.maxBytes`             | 20971520 (20 MiB)         | The largest file an inbox takes, 1,024 to 104,857,600 bytes; anything else is the default                                                                      |

Each is read at each use, from the server's properties only: never from a document, a contribution
or a request.

## Building it

Java 21 and Maven, with the Nuxeo public repository the parent POM names.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-capture/pom.xml verify
# target/nuxeo-agentic-capture-0.1.0.zip, the Marketplace package, after 73 tests
```

The root `pom.xml` lists the module, and the Marketplace workflow (`build-marketplace.yml`) builds
and tests it on the pull requests it sees; it does not publish it. No test calls an AI service: the
AI provider's tests call stand-ins for the AI package's two operations, `TestAiOperations`.

| Test                     | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CaptureTest`, 19        | Classified, extracted, matched and filed with the stand-in, audited on the item and the claim with the class and confidence; the threshold's edge; each way an item waits: low confidence, no key or one not of its form, no class, a class with no key, no record, two, one outside the profile's folder, a record with no attachments, no provider, a provider that fails or throws, an answer out of bounds; the same file once; a capture run again, on an item filed or waiting; a capture rolled back without a word, or refused after its claim, leaving the item waiting and the claim released; a capture another run holds |
| `ReviewTest`, 11         | Confirmed as proposed, as the person, audited; a claim number corrected and matched again, with the record cleared or left; a record named, its number filled in; a key not the record's, no match, two, out of the folder; a class given; corrections saved and checked; rejected; an item filed or received not decided on; an item being filed at this moment                                                                                                                                                                                                                                                                     |
| `GuardTest`, 7           | Created only in an inbox, with its file, no larger than the server takes, with nothing of `capt:`; the server's properties, an administrator's write included; the file; the facet; no copy of an item, or of a folder holding one; no restore of an item to a version                                                                                                                                                                                                                                                                                                                                                               |
| `PermissionTest`, 5      | Uploading is the inbox's to allow; the scanner's account uploads and the system files; deciding needs the item's write; filing the record's write, checked as the person; a record they may not read refused, by its id or its number                                                                                                                                                                                                                                                                                                                                                                                                |
| `AiProviderTest`, 5      | Not called while it is switched off, however else the server is set, and called once on; only the AI package's operations; what it sends: the id and the profile's definitions, none of the letter; its answer through the same rule; an answer it cannot read, an operation that fails or is absent                                                                                                                                                                                                                                                                                                                                 |
| `BundleTest`, 6          | The components, the facet and every property, both providers and the AI one off by default, the profiles found by their types, no Automation operation, the version                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `LogTest`, 1             | Every line the add-on logs, at every level, through filings, waits, refusals and failures whose messages quote the letter: no field's value, no text of the letter, no setting                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ConfidenceRuleTest`, 7  | The rule alone, with no runtime: each condition, its order, the threshold's edge, values out of bounds, what is kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ProfileTest`, 3         | A profile's rules, each broken once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ProfileRegistryTest`, 2 | A profile refused, for a rule or for another's types, takes the earlier one of its id with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `StandInProviderTest`, 4 | The stand-in alone: keywords' share, fields after their labels, a PDF's own text, the same answer each time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `KitLetterTest`, 3       | The P&C claims kit's own profile, read from its component, and its two fictional letters: the one about PC-24003 may be filed by itself, the unclear one waits                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Stand-ins**            | `ScriptedProvider`, a provider the tests answer for; `TestAiOperations`, the AI package's two operations, counting their calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Each guard was seen failing.** Forty mutations of the code, one at a time, each turned at
least one of these tests red ([below](#how-the-guards-were-seen-failing)).

## How the guards were seen failing

Each mutation below was made to the code, one at a time, the named tests run, and the code put
back. Three stayed green at first, each because another guard held what it broke, and each test was
made to hold its own guard, then went red: the person's `Write` check (the platform refused the
write anyway, so the test now asks for the add-on's own refusal), reading the record as the person
(refused instead for want of `Write`), and a capture run twice (the filing claim and the digest
held it, so the test now runs it again on an item that waits for a person). One did not compile as
first written, and was written again.

| #     | The guard broken                                                                                                                                                                | Went red                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1-4   | The threshold lowered by 0.2; a key not of its form trusted; a missing key no reason; a confidence outside 0 to 1 kept                                                          | `ConfidenceRuleTest`, `CaptureTest`                         |
| 5-7   | Filed whatever the rule says; two records taken as one; the profile's folder ignored                                                                                            | `CaptureTest`                                               |
| 8-10  | The AI provider's switch ignored; an operation not the AI package's called; the AI call in the capture's own transaction                                                        | `AiProviderTest`, `BundleTest`                              |
| 11-13 | The server's properties writable; the item's file changeable; an item decided on while it does not wait                                                                         | `GuardTest`, `ReviewTest`                                   |
| 14-18 | No `Write` check on the record; the record read as the system, not the person; a key not the record's accepted; a corrected key not matched again; no filing claim for a person | `PermissionTest`, `ReviewTest`                              |
| 19-24 | An item copied; a folder holding items copied; an item created outside its inbox; `capt:` given at creation; no size bound; the facet added to another document                 | `GuardTest`                                                 |
| 25-26 | A person's value with a control character taken; a field of another class taken                                                                                                 | `ReviewTest`                                                |
| 27-28 | No audit of an automatic filing; the same file attached twice                                                                                                                   | `CaptureTest`                                               |
| 29-30 | A field's value logged; a provider's message logged                                                                                                                             | `LogTest`                                                   |
| 31-32 | A profile with a threshold below a half registered; one with a quote in its path                                                                                                | `ProfileTest`                                               |
| 33    | A capture run on an item that is no longer received                                                                                                                             | `CaptureTest`                                               |
| 34-37 | No fallback once a capture's transaction rolled back; the fallback ignoring another capture's claim; no capture claim; a claim kept when its transaction rolls back             | `CaptureTest`                                               |
| 38-40 | An item restored to a version; a field's name not checked before it is named in a refusal; a refused replacement keeping the profile it replaced                                | `GuardTest`, `ReviewTest`, `LogTest`, `ProfileRegistryTest` |

Mutations 34 to 40 came with the independent review's findings: the fallback, the capture claim,
a version's restore, a field's name in a refusal, and a refused replacement profile, each built,
tested and broken on purpose. The mutations are a script kept outside this repository; each is the
replacement of one line or condition named above. **Not held by a mutation:** the server's mark on
its own writes being taken off by the write it lets through (`ServerWrite.consumes`), which no
client can reach, since it holds an object a client cannot send. What was found and fixed while building, the independent review among it,
is kept outside this public repository, with the review pack
([security-reviews.md](../docs/business-apps/security-reviews.md)).

## Installing it on the local Docker Nuxeo, for the demo

For the reviewer, after review. Each step changes the server; none was run here.

```bash
# 1. The add-on's package, then the P&C claims kit's (its README).
docker cp nuxeo-agentic-capture/target/nuxeo-agentic-capture-0.1.0.zip nuxeo:/tmp/
docker exec nuxeo nuxeoctl mp-install /tmp/nuxeo-agentic-capture-0.1.0.zip --accept=true

# 2. The stand-in, appended to nuxeo.conf. Not the AI provider: see "Before the AI provider is
#    switched on".
docker exec nuxeo sh -c 'echo nuxeo.agentic.capture.provider=standin >> /etc/nuxeo/nuxeo.conf'

# 3. Restart.
docker restart nuxeo
```

Not `/etc/nuxeo/conf.d/` on a container that has started before: it is read at the first start
only ([`nuxeo-conf/README.md`](../nuxeo-conf/README.md)). To remove it: delete the kit's items
first, uninstall the package, delete the setting's line, and restart.

## The demo

Demo step 3, in the [P&C claims kit's README](../business-apps/packages/pc-claims-demo/README.md#demo-step-3-a-scanned-claim-letter-filed-on-its-claim):
the letter about PC-24003 classified and filed on its claim by itself; the unclear one waiting in
"Mail to confirm", its claim number corrected by an adjuster, and filed.

## For the security review

What the review must check. The add-on's own tests hold each point below; they are not the review,
which is deferred until the app is finished, as every security review is
([security-reviews.md](../docs/business-apps/security-reviews.md)). No finding is recorded here.

- **Filing as the system.** An automatic filing writes the record as the system, whoever uploaded:
  that is what lets a mailroom account file letters on claims it may not read. Check that each
  inbox's `AddChildren` is held by the accounts and people who should file mail, that a profile's
  `recordPath` keeps its matching to the records it should, and that an uploader learning from an
  item whether a key matched is acceptable for each kit's records.
- **The threshold.** Nothing is filed with no person below it; it is never below 0.5. Check each
  kit's threshold, and its keys: a class whose keys a forged letter could quote files that letter
  on a real record by itself. A key should be one the sender has, and a filing is an attachment
  added, not a record changed.
- **A person's filing.** Read and write of the record are checked as the person before anything is
  written, and the file is written through their session. Check the inbox's `Write`, which decides
  who confirms, and that a person who corrects a key learning whether a record with it exists in
  the profile's folder, one they may not read included (400 when none matches, 403 when it is not
  theirs to read), is acceptable for each kit's records.
- **The provider's answer.** Untrusted: checked by the rule, its values cleaned and bounded, a key
  used in a query only when it is of its form, and then quoted by the platform's escaping. Check
  each kit's `format` patterns, which are the server's configuration.
- **The AI package's provider and data.** Off by default, behind two settings; only operations named
  `AI.`; the item's id and the profile's definitions sent, and the AI package reads the item. Check
  the AI package's operations when they exist: what each sends to its model provider, where, under
  which terms, and what it keeps. The data terms are approved before the second setting is set.
- **What is kept.** The provider's reading, the person's corrections, who decided and when, on the
  item; the file, on the record; the audit's entries, which name ids, the class, the confidence and
  the outcome, never a field's value; the record's entry also names the file as it was uploaded,
  which the record's readers see on its attachments anyway. Check the retention each kit's items need: a letter is
  personal data.
- **Logs.** Ids, reasons and kinds only (`LogTest`); a field's name a person gives is checked
  before any refusal names it. Check the server's own logging of a refused request, which is the
  platform's.
- **The claims.** An item's capture and its filing are each claimed in the key/value store
  `agentic-capture`, the server's default store unless it configures one of that name. On a
  cluster, that store must be one for every node, or two nodes could each capture one item. Check
  each server's store.
- **The stand-in's confidence is not a measure.** It gives 0.97 to any labelled value of the right
  form, so on a server that names it, a text that quotes a class's phrases and a key of its form is
  filed by itself on the record with that key. It is for demonstration servers only, as the
  settings say; nothing but the setting stops a server naming it.

## Data notes

- **What an item holds:** the letter as it came in, which may be personal data; what was read of
  it, the provider's and the person's; and who decided. Its readers are its inbox's.
- **Where it goes:** with the stand-in, nowhere: it is read on the server. With the AI provider, the
  AI package reads it and sends it to its model provider: hence the setting, and the terms first.
- **On the record:** the file, as an attachment, which the record's readers then read. A record's
  readers do not see the item unless the inbox lets them; the kit's claim page lists the filed
  items its reader may read.
- **Fictional data only** in this repository: the tests' letters and the kit's two PDFs name no
  real person, business, policy or claim, as each says.

## Not done, and not checked

- **On a server:** nothing. That a batch upload's file reaches `aboutToCreate` with its length, that
  the platform's audit on LTS 2025 takes the entries as the 11.5 tests' does, and that a kit's
  profile registers after the add-on's component are as the tests and the other add-ons found, not
  run here.
- **The AI package's two operations,** and so the real provider against a model: neither exists yet,
  and the data terms are not approved.
- **A drop folder, a mail server, or a scanner's own connector.**
- **Upload from the app,** and a one-click confirm: the app's Create form has no file input for a
  kit's type, and the decision is typed in the Edit form (the kit's README).
- **Capture again:** an item that waited for a provider that was down is not read again by itself;
  a person confirms or rejects it.
- **Retention of items,** and what becomes of a rejected one: the platform's.
- **Linked documents beyond the item:** the item itself is the linked document, by `capt:record`;
  the file is copied to the record's attachments. A record type with no attachments is not filed on.
