# Supporting a Studio migration: the playbook

For a support engineer helping a customer whose Studio migration reports findings. The customer
ran `migrate` on their own Studio package, or on several, following the
[customer's guide](studio-migration-guide.md), and has a report, a verdict and a decisions file in
front of them. This playbook says how to read what they have, what each finding means and who acts
on it, when to escalate to engineering and with what, how to reproduce their run safely, and when
lab mode helps.

The tool is [`tools/studio-migration`](../../tools/studio-migration/README.md); the
[migration document](studio-migration.md) explains the approach. Section 9 lists every finding the
tool can print, taken from its source: a test fails when the tool gains one this playbook does not
cover, in any of the ways section 10 lists.

**Where it stands.** Today every migration's verdict is "not ready": some checks need a server
that is not built yet, and some parts of a package wait for a later version of the tool (the
guide, section 10). A support case is about what a run found, not about switching a customer over.
No one outside the team has followed this playbook yet.

## 1. What the customer has

`migrate` needs no server and talks to no network. It reads the package, and only reads it, and
writes everything into the folder its `--out` names, which must be new or empty.

**One package,** `migrate <package.zip> --out <folder>`, writes:

| File                        | What it holds                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `inventory.txt`             | What the package holds, by kind, ending with the inventory's own "Decisions needed" (section 9)           |
| `conversion.txt`            | The conversion's counts: constructs by outcome, the files of `conversion/app/`, the labels and the themes |
| `conversion/`               | The new app's configuration (`app/`, `themes/`), `report.json`, every part of the package as data         |
| `check.txt`                 | The ten checks, each `pass`, `FAIL`, `partial` or `not run`, with what each found, and the verdict        |
| `report.txt`                | The report a reviewer reads (section 2)                                                                   |
| `conversion/decisions.json` | An entry for each reported item, for its owner and their decision (section 2)                             |
| `decisions.txt`             | What the decisions step printed: how many items, how many still blank, and with `--from` what was carried |

What `migrate` prints on the terminal, its steps, the verdict and what to do next, is not kept in
a file for one package: ask the customer to copy it. Each step's file is what that step's command
prints when run by hand, byte for byte, so the files are the run.

**Several packages, or a folder of them,** `migrate <package.zip or folder>... --out <folder>`, run
each package as above into a folder of its own (section 6), and write:

| File or folder       | What it holds                                                                           |
| -------------------- | --------------------------------------------------------------------------------------- |
| `summary.txt`        | What the run printed: each package's result, its counts and its report, then the totals |
| `summary.json`       | The same as data, paths under the run's folder                                          |
| `packages/<name>/`   | One package's run, exactly the files above                                              |
| `printed/<name>.txt` | What that package's run printed, its steps, its verdict, or why it stopped              |

**The exit code** says how it ended: 0 every step ran and no check failed, whatever the verdict; 1
it was refused before its first step, a step refused, or a check failed (in any package, for
several); 2 the command itself was wrong. For several packages it is the worst of theirs.

## 2. Reading the report and the decisions file

Read in this order: did it stop, did a check fail, what stands in the way, what needs a decision.

1. **Did it stop?** A run that stopped printed `<step>: refused`, why, and what to do; for several
   packages, the package's line says `stopped`, and `printed/<name>.txt` has the message. Section
   7 says what each stop means.
2. **Did a check fail?** `check.txt`, and the report's "What the harness found", give each check's
   status. Under each `FAIL` is one line per finding. Find the line in section 9, under that
   check: the table says what it means and who acts.
3. **What stands in the way.** The verdict's lines, under "Verdict: not ready", each name one
   thing; section 9, "The verdict", says each. Most are waits: checks whose server half has not
   run, constructs pending a later version of the tool, proposals no one can accept yet.
4. **What needs a decision.** The report's "Decisions needed" lists every reported item: its
   label, its file in the package, its id, why it is reported (`why:`), where it was written if it
   was (`written to:`), and its owner and decision, or `none` and `nothing yet`. Reported is not
   wrong: it means the part does not migrate, or not exactly as Web UI shows it, and a person
   decides what to do about it. The tool never decides for them.

**`report.txt`, part by part:**

- **The header:** the package's name and version, the platform it targets, its bundle; Studio's
  branch, commit and build time from the bundle's manifest; the app it became; the converter's
  name, version and phase; and the allow-list the actions were held to, the deployment's or "as
  the conversion recorded it". The converter's version does not say which commit of the
  repository ran: ask for that (section 5).
- **The summary:** every construct of the package by kind and outcome. `converted` is done;
  `proposed` waits for a person to accept or reject it, which is not built yet; `reported` is for a
  decision, and `decided` counts those with an owner and a decision; `generated` is Studio's own
  packaging; `server` stays on the server, such as the data model; `pending` waits for a later
  version of the tool, such as custom code. `missing` must be 0, and **Coverage** 100%: anything
  else is a check 1 finding.
- **What the harness found:** the ten checks and the verdict, as in `check.txt`.
- **Decisions needed** and **Proposals:** as above. "Not taken from decisions.json" lists the
  decisions file's findings (section 9, "decisions.json").
- **Files:** each file of the package, with what its constructs became.

`inventory.txt` ends with a shorter "Decisions needed" of its own, by kind: what the tool's
catalogue does not know or cannot map. The report's list, item by item, is the one
`decisions.json` follows.

**`conversion/decisions.json`** has a `format` (`studio-migration-decisions/1`), a `package`
naming the build it is for (name, version, Studio commit, build time and the bundle's SHA-256), and
an entry for every reported item, in the report's order: its `id`, and copied from the report its
`label`, `outcome`, `note`, and where there is one its `property`, `to` or `rule`; then `owner`
and `decision`, blank. The customer writes `owner` and `decision`, and nothing else:

- a decision counts only while the copied keys say what the report says, so an item whose reason
  changes is decided again;
- the file counts only for the build it names, so a new build of the package starts again;
- `--from` an earlier run carries each decision that still holds into a new run, which counts it;
  `decisions.txt` says how many were carried, and lists each that was not, with why.

An item counts as decided when both `owner` and `decision` say something other than spaces. What
the file holds that the tool does not take is a finding of section 9, "decisions.json".

## 3. Who acts on a finding

Every row of section 9 names who acts, with one of these words:

- **Package:** the finding is about the customer's own package. They change it in Studio, build
  the package again, and migrate the new build into a new folder, before they fill in decisions,
  which are for one build. Escalate only if they cannot change it in Studio, or believe Studio's
  output is right; attach what section 4 lists.
- **Tool:** the conversion the tool wrote disagrees with the package as an independent check reads
  it, or the tool met something it cannot handle: a defect or a limit of the tool. The customer
  can do nothing about it, and it stays in the way of readiness. Escalate, with what section 4
  lists.
- **Inputs:** the finding can only come from inputs that do not belong together, not from a run
  `migrate` wrote from the package as built: files under `conversion/` edited by hand, `check` or
  `report` run by hand against another package, build or allow-list, or a conversion written by
  another version of the tool. Ask the customer to run `migrate` again from the package as Studio
  built it, into a new folder, and to change nothing under `conversion/` but `owner` and `decision`.
  If the finding is still there on that run, treat it as **Tool**.
- **Decisions:** the customer's `decisions.json` holds something the tool does not take. They
  correct that entry as the line says, or leave the file as `migrate` wrote it and fill in
  `owner` and `decision` again. Escalate if they changed nothing but `owner` and `decision`.
- **Decide:** nothing is wrong. A person decides, writing an owner and a decision in
  `decisions.json`, or the line records a fact of the package for the reviewer.
- **Wait:** it waits for a part of the tool, or a server, that is not built yet. Nothing to do
  now. If the customer needs it settled, ask the team about a lab run (section 8).
- **Lab:** lab mode's own finding, from a run the team made on its server (section 8). Settle
  first that the server was set up for the run: the customer's package installed, its conversion
  served to the new app, the add-ons the customer's own servers have, and a user who may read the
  documents. If it was, a difference is the new app's or the conversion's: treat it as **Tool**,
  and escalate with `lab.txt`, `lab.json` and the screenshots. If it was not, set the server up and
  run lab mode again.

Where a row names two, the first is what it usually is, and the second says when it is the other.

## 4. Escalating to engineering

Escalate a **Tool** finding, a stop the playbook says is the tool's, and anything this playbook
does not explain, through the escalation channel your support process names: **never a public
issue, pull request or discussion on this repository, which is public**, and never a commit to it.
A report names the customer's types, fields, labels and screens.

Attach:

- the finding's line as printed, and which check or list it is under;
- the run's folder, its `--out`, whole: for several packages, the whole folder, or the one
  package's `packages/<name>/` with its `printed/<name>.txt` and `summary.json`;
- what `migrate` printed on the terminal, for one package;
- the command line as the customer typed it, and the `--allow-list` file if they gave one;
- with `--from`, the earlier run's `conversion/decisions.json`;
- the commit of their copy of the repository, `git rev-parse HEAD`, and whether `git status`
  shows it changed; `node --version`; and their operating system;
- the package itself, only through the channel your support process uses for customer files,
  and with the customer's agreement. Most **Tool** findings cannot be reproduced without it.

Never attach a password, a token or production data, whether or not the customer sent one. The
`owner` of each decision, which `report.txt` prints too, names people of the customer's: the run's
files are the customer's confidential data, as their package is. To escalate one package of
several, its `summary.json` entry is enough: the others name the customer's other packages. A
Studio package can hold anything its Studio project holds, an XML extension's settings among
them: handle it as the customer's confidential file, and delete your copies as your support process
says.

## 5. Reproducing a customer's run safely

`migrate` needs no server and no credentials, so a customer's run can be reproduced exactly from
the same inputs, on your own computer, and nothing of theirs is needed beyond them.

**What to ask for:** the package as Studio built it (through the channel of section 4); the
command line; the `--allow-list` file, if any; with `--from`, the earlier run's
`conversion/decisions.json`; the commit of their copy of the repository; and what it printed.

**What never to ask for:**

- a password or a token of any kind: their Nuxeo or Studio account, a `NUXEO_USER` or
  `NUXEO_PASS`, a server address with a password in it, or their `SATORI_GH_READONLY_TOKEN`. If
  theirs is refused, they ask their Nuxeo contact for a new one; you use your own;
- access to their servers, or to their Studio project;
- production documents, exports of their repository, or screenshots of screens holding people's
  data;
- to run lab mode, or anything else, against their server;
- to send the package any other way than the channel of section 4.

**Then,** on the same kind of system as the customer's: the files name their folders in full, and
a Windows path's separators and quoting differ from a Mac's or Linux's. The commands below are for
macOS and Linux.

1. Keep the case in a folder of its own outside any copy of the repository, such as
   `~/cases/<case>/`, so that nothing of the customer's can be committed to this public repository.
   Put the package there as it came, and do not unzip it: the tool reads it as Studio built it, and
   only reads it. Do not open its files in a browser: Web UI layouts hold scripts.
2. Use a copy of the repository at the customer's commit, with its dependencies installed by
   `npm ci`, never `npm install`, and your own `SATORI_GH_READONLY_TOKEN`. A newer commit can
   convert more, and its report differ.
3. Run the same command, with full paths, into a new folder of the case:

   ```bash
   npm run studio-migration -- migrate ~/cases/<case>/<package>.zip --out ~/cases/<case>/run-1 \
     [--allow-list ~/cases/<case>/allow.json] [--from ~/cases/<case>/earlier]
   ```

4. Compare with theirs. The files name the run's folder in full, and `decisions.txt` the
   `--from` it was given, so replace each with the same word first. Two runs of the same package
   and allow-list, at the same commit and on Node.js 24, should differ in nothing else:

   ```bash
   diff <(sed "s#<their --out>#OUT#g" ~/cases/<case>/theirs/report.txt) \
        <(sed "s#$HOME/cases/<case>/run-1#OUT#g" ~/cases/<case>/run-1/report.txt)
   ```

   `inventory.txt`, `check.txt` and `conversion/report.json` compare the same way. A difference
   means the inputs, the commit, the Node.js version or the system differ: settle that before
   anything else.
   If none does, the difference is itself a **Tool** finding: escalate it with both runs.

5. To look again at their run without running it, `check` and `report` print the checks and the
   report with the decisions as they are in its `decisions.json` now, and write nothing. Give them
   the run's `--allow-list`, or check 10 runs only in part:

   ```bash
   npm run studio-migration -- report ~/cases/<case>/<package>.zip ~/cases/<case>/theirs/conversion
   ```

## 6. Many packages in one run

`migrate` takes several packages, or a folder of them, or both:

```bash
npm run studio-migration -- migrate ~/studio/packages --out ~/studio/migration-1
npm run studio-migration -- migrate ~/studio/claims-1.0.0.zip ~/studio/policies-2.1.0.zip --out ~/studio/migration-1
```

- **Each package runs as one does**, into `packages/<name>/`, `<name>` being its file's name less
  `.zip`, with each character but a letter, a digit, `.`, `_` and `-` written `-`, dots at its end
  dropped, and a name Windows keeps for a device, such as `CON`, written `_CON`. That folder holds
  exactly what `migrate` of that package alone writes there, so anything in sections 2 to 5 works
  on it: `report` on its `conversion/`, `--from` its folder.
- **Isolated:** a package that cannot be read, stops at a step, fails a check, or meets a defect of
  the tool ends that package's run alone. The others run as they would have without it, byte for
  byte.
- **A folder** gives the `.zip` files directly in it, in the order of their names. What else it
  holds is listed as left out, but for names that start with a dot, which the system keeps, such
  as the `._<name>.zip` a Mac leaves on a drive: those are passed over. A folder with no `.zip`
  file is refused before anything is written.
- **The same package twice,** the same bytes under any name, runs once: the summary lists the
  second as the same package as the first. **Two files of one name** from two folders get two
  folders, `claims` and `claims-2`, told apart as a file system that ignores case would. Packages
  that **declare the same name and version** from different bytes, most often two builds of one
  version, both run, and the summary says so: a build's decisions are its own.
- **`--from` an earlier run of several** carries each package's decisions from the earlier run's
  folder for the same bytes, whatever its file is called now; failing that, from the one folder of
  the same build: the same name, version, Studio commit, build time and bundle, which is what a run
  of one package holds its decisions to. When the earlier run held that build under two sets of
  bytes, neither is taken, and the line says so. A package the earlier run did not hold, or whose
  run there wrote no decisions, starts again, and its line says "Nothing carried"; one whose run
  stopped before its decisions step says "Not carried".
  `--from` a run of one package is refused: run that package on its own with `--from`. The other
  way round too: a run of one package given `--from` a run of several finds no decisions there;
  give it `--from <that run>/packages/<name>`.
- **The exit code** is the worst of the packages': 0 when every package ran every step and no
  check failed in any; 1 when one stopped or failed a check, or the run of them all was refused
  before it wrote anything; 2 when the command was wrong.

**For a case,** start from `summary.txt`: each package's line gives its result (section 9, "Many
packages: each package's result"), its counts, and where its report and what it printed are. Then
treat each package as a run of its own. Escalate one package with its `packages/<name>/`, its
`printed/<name>.txt` and its entry in `summary.json`.

## 7. When a run stops

A run that stops says why and what to do. What each stop means for support:

- **`migrate: … Nothing was written.`** Before any step: the `--out` folder is not new, the package
  or the allow-list or the `--from` cannot be read or used, or, for several, a folder holds no
  `.zip` file or `--from` is not a run of several. The command is the customer's to correct, as the
  message says. Never escalated.
- **`1. The inventory: refused`.** The file is not a Studio package the tool can read: not a zip,
  no `package.xml`, a `package.xml` declaring another kind of package, a damaged archive, or one
  past the tool's limits on its size and entries. Ask for the package exactly as Studio built it,
  not unzipped and zipped again. If it is, and it is still refused, it is **Tool**: escalate with
  the message.
- **`2. The conversion: refused`.** Usually a name in the package that cannot be a file name on
  every system: a limit of the tool, **Tool**. Escalate with the message and `inventory.txt`.
- **The checks or the report refused,** "could not be read back": **Tool**, a defect.
- **`The decisions, carried: refused`.** `--from` holds the decisions of another build, or a file
  `migrate` did not write. **Decisions:** run without `--from` and fill them in again, copying
  `owner` and `decision` by hand where an item is the same.
- **"… cannot be written: …"** The disk, or the folder's permissions: run again into a new folder
  the customer can write to.
- **A stack trace, then "This is a defect in this tool"**: **Tool**. Escalate with all of it. In a
  run of several, that package's line reads "stopped by a defect of the tool", and the others ran.
- **"migrate: the summary cannot be written"**, for several packages: every package ran, into
  `packages/`, and what each printed is in `printed/`, but `summary.txt` and `summary.json` could
  not be written, usually for the disk. Run them again into a new folder.
- **"the catalogue in … is wrong"**: the tool's own catalogue, in the repository, did not load.
  Ask whether `git status` shows the customer's copy changed: a fresh copy at the same commit
  settles it. Otherwise **Tool**.

## 8. Lab mode

`studio-migration lab` is the only part of the tool that talks to a server. It opens documents in
Web UI and in the new app on a real Nuxeo, compares the requests each sends to it, and runs the
server halves of the checks it can. The [tool's README](../../tools/studio-migration/README.md),
"Lab mode", is its reference.

**When to use it.** Not for a customer to run, and never against a customer's server: the team
runs it on a server it controls, the local Docker Nuxeo or, once it exists, the migration lab
server, with fictional documents and test users. Use it when a case needs what only a server
settles:

- check 3's server half: the names a conversion rests on the platform for, listed under check 3's
  `partial`, confirmed against the server's own model, with `--package` and `--conversion`;
- what a document's page asks the server for in Web UI and in the new app, side by side: check 7's
  server half on one page, held to the request-log rule below.

Checks 5, 6 and 7 stand on a package's documents only once the package is installed on that server
and its conversion is served to the new app, and check 5's server half does not run in lab mode at
all: it needs test users in and out of each group, which lab mode never creates. Installing a
customer's package on the team's server needs the customer's agreement.

**Read only.** Lab mode refuses, before it leaves the browser, every request either app sends but
`GET`, `HEAD` and `OPTIONS`, and the operations that only read: Web UI's sign-in (`login`),
`Repository.Query`, `Repository.PageProvider`, `Directory.SuggestEntries`,
`Audit.QueryWithPageProvider` and `NuxeoDrive.GetRoots`. It refuses downloads, which the server may
write to its audit log, and the new app's sign-out as it starts, which ends a session on the
server. From Node it only sends `GET`s, each to the origin it is for, following no redirect. What
it refused is listed in its report. It creates nothing, so it never creates the test users check 5
needs.

**As the same user.** It signs both apps in as the user `NUXEO_USER` and `NUXEO_PASS` name, which
have no default. On a local Docker Nuxeo that is the server's documented default administrator,
set in your shell for the run only: never written to a file, never printed, never the customer's.
Before anything opens, `/me` must answer as that user, and every `/me` and sign-in either app reads
must name them; a document where one does not is not compared, and the run exits 2. Its record of
each request never holds a credential, and of a document's answer only the names of its
properties.

**The request-log rule,** for each document, check 7's server half on its page:

1. **The document.** Web UI's page asks for it, by id or by path; the new app's must too, and be
   answered as Web UI was: both read it, or neither.
2. **Its schemas.** Every schema Web UI asks for it with, `*` being every one, the new app asks for
   too, as each browser sent the request.
3. **Its properties.** Every property Web UI fetches and shows, the new app fetches and can show:
   a field of its page, a layout file it loaded for the type, or a row the page draws itself, such
   as the Properties panel.

Listed side by side, and held to nothing yet: the enrichers each asks for, the page providers with
their parameters and result counts, the other endpoints, and what lab mode refused. A property Web
UI shows only under a condition is listed, not held: whether it shows is check 5's.

**Not compared is never a pass.** A document is not compared when Web UI never asked for it, when
either page was still sending at the end of the wait, or when a layout, the document's answer or
the new app's page could not be read. Its checks say why, and the run exits 1.

**What it writes,** into a new `--out`: `lab.txt`, what it prints; `lab.json`, the same with the
recordings, as data; and a screenshot of each app on each document. **Exits** 0 when every document
was compared and none differs; 1 on a difference, a failed check or a document not compared; 2
when the command or its environment is wrong: the credentials, Playwright, or a server that does
not answer as the user.

## 9. Every finding, and who acts

Each table holds every kind of line the tool can print there, as the source builds it, with each
part filled in as it runs written `…`. Search for a fixed part of the line the customer sees: for
"the two counts disagree on web/…: the parser finds 3 layout-field, the text holds 4", search
"the two counts disagree".

### The verdict

The verdict follows the ten checks in `check.txt` and `report.txt`, and ends what `migrate` prints. A migration is ready only when every check passes, nothing is pending, no proposal waits, every reported item has an owner and a decision, and nothing is wrong in `decisions.json`; each line names one thing in the way, and every package is "not ready" today. On a run `migrate` wrote, the lines are mostly **Wait** and **Decide**. A line naming `decisions.json` is one of that file's findings, in the table that follows this one.

| The finding reads                                                                                                                                                                | What it means                                                                                                                                                                                                                                                                                                                                                                                                      | Who acts                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `check … failed`                                                                                                                                                                 | The check found something. Its findings are listed under it in `check.txt` and in the report, and each is in that check's table in this playbook.                                                                                                                                                                                                                                                                  | **Tool**, **Package** or **Inputs**, as each of its findings' rows says        |
| `check … ran only in part`                                                                                                                                                       | The part of the check that needs no server found nothing, and the rest did not run: for checks 3, 5, 6 and 7, the half that needs the migration lab server. Check 10 runs in part only when `check` or `report` is run by hand without the run's `--allow-list`, on a conversion with actions.                                                                                                                     | **Wait**; **Inputs** for check 10                                              |
| `check … did not run`                                                                                                                                                            | Only check 9, plugins, which tests the plugins that replace custom elements, which a later version of the tool brings (M3).                                                                                                                                                                                                                                                                                        | **Wait**                                                                       |
| `… constructs are pending a later phase`                                                                                                                                         | That many parts of the package have the outcome `pending` in the report: a later version of the tool converts them, such as customer code.                                                                                                                                                                                                                                                                         | **Wait**                                                                       |
| `… proposals wait for a person to accept or reject them`                                                                                                                         | That many parts have the outcome `proposed`, listed under "Proposals" in the report: each proposal with no `accept` or `reject` in its `decision`, and each part a condition's proposal guards, such as a field under it, which waits on that condition's decision and on a run made with it.                                                                                                                      | **Decide**; accept or reject each (guide section 5), then run `migrate --from` |
| `… … accepted or rejected with no one's name, or no reason`                                                                                                                      | That many proposals have `accept` or `reject` in `decision`, and an `owner` or a `reason` that is empty or only spaces. A proposal is decided by someone named, for a reason, so these are not taken.                                                                                                                                                                                                              | **Decide**; write who decided and why (guide section 5)                        |
| `the conversion was made with … of its proposals decided otherwise than decisions.json decides them now, such as …: convert it again with the decisions, as migrate --from does` | `report.json` records, for each proposal, what was decided of it when the conversion was made, and `decisions.json` now decides that many otherwise: accepted or rejected since, or changed. What the conversion wrote is not what was decided. A run `migrate --from` made agrees with its decisions, so this follows a `decisions.json` filled in after its run, or `convert` run by hand without `--decisions`. | **Inputs**; run `migrate --from` that run into a new folder                    |
| `… reported … no owner`                                                                                                                                                          | That many reported items have no decision taken from `decisions.json`, or one whose `owner` is empty or only spaces. On a first run the checks run before `decisions.json` is written, so this counts every reported item.                                                                                                                                                                                         | **Decide**; fill in `decisions.json` (guide section 5)                         |
| `… reported … an owner but no decision`                                                                                                                                          | That many reported items have an `owner` and an empty `decision`, or one of spaces alone.                                                                                                                                                                                                                                                                                                                          | **Decide**; write what was decided (guide section 5)                           |
| `the conversion was made with the allow-list …, not the deployment's, …: convert it again with the deployment's`                                                                 | `check` or `report` was given an `--allow-list` whose operations differ from those the conversion recorded, "none" standing for an empty list. `migrate` gives every step the same list, so this comes from a step run by hand with another.                                                                                                                                                                       | **Inputs**                                                                     |

### Check 1: Nothing dropped

Check 1 holds `conversion/report.json` to the package: the report is of the package given, by its name, version and Studio build; every construct of the package is in it once, with an outcome, and with a reason where the outcome needs one; nothing in it is invented; and the inventory's count of the package agrees with a second count made from the raw text. The converter writes one entry for every construct the inventory reads, so on a run `migrate` wrote only the two counts can disagree, and that is **Tool**. Every other finding means the report and the package do not belong together: **Inputs**.

| The finding reads                                                      | What it means                                                                                                                                                                                                                                                                                | Who acts   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `the report is of … …, not of the package given, … …`                  | `report.json` names another package name or version, the first two `…`, than the package `check` or `report` was given, the last two. The conversion was made from another package, or another version of it.                                                                                | **Inputs** |
| `the report records Studio's …, and the package's manifest …`          | The report records another Studio commit or build time than the bundle's manifest holds, so the conversion was made from another build. Each `…` reads `commit … and build time …`, with `no commit` or `no build time` where there is none.                                                 | **Inputs** |
| `the two counts disagree on …: the parser finds … …, the text holds …` | For one file of the package, the parser behind the inventory and a second count made from the raw text with patterns find a different number of one kind of construct, such as `layout-field`. The tool reads that file two ways that disagree, and the finding does not say which is wrong. | **Tool**   |
| `dropped: …, in … (…)`                                                 | A construct of the package, given by its label, its file and its id, has no entry in `report.json`.                                                                                                                                                                                          | **Inputs** |
| `listed … times: …`                                                    | `report.json` lists the construct of that id more than once. The rest of the tool reads its first entry.                                                                                                                                                                                     | **Inputs** |
| `…: the report places it as … in …`                                    | The report's entry for this id gives another construct kind, or another file, than the package's construct of that id.                                                                                                                                                                       | **Inputs** |
| `the report lists …, which the package does not hold`                  | `report.json` has an entry whose id is no construct of the package.                                                                                                                                                                                                                          | **Inputs** |
| `…: "…" is not an outcome`                                             | An entry's `outcome` is none of `converted`, `proposed`, `reported`, `generated`, `server` and `pending`.                                                                                                                                                                                    | **Inputs** |
| `…: it is … without a reason`                                          | An entry that is `proposed`, `reported` or `pending` has no `note`, or one of spaces only.                                                                                                                                                                                                   | **Inputs** |
| `coverage is …%, not 100%`                                             | Some constructs of the package have no entry in the report; each also has a `dropped:` line of its own. The share is rounded down to a tenth.                                                                                                                                                | **Inputs** |

### Check 2: Fields

Check 2 holds each converted layout file, each tab of a view file and each task form to the fields Web UI's layout, tab or task layout shows, read from the package: each once, in the same mode, with the same required flag and the expected widget. It holds each queue to its list's columns, in order, with their widgets; a field under a condition is check 5's, and one the report reports or leaves pending, with its reason, is excused. It reads the package with the same planning the converter uses, so on a run `migrate` wrote it is meant to find nothing: most findings mean `conversion/app/` was edited by hand, or written by another version of the tool (**Inputs**), and one that appears on a fresh run is **Tool**.

| The finding reads                                                                                                   | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                  | Who acts                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `…: it is not version …, which the app reads in … mode`                                                             | The layout file or task form is not an object of the version the app reads for its mode: 2 for `view` and for task forms, 1 for `metadata`, `edit` and `create`. The converter writes each mode in that version.                                                                                                                                                                                                                               | **Inputs**                                                                                                       |
| `…: it lists …, which the Properties panel already shows`                                                           | A `metadata` file lists `dc:title`, `dc:description`, `dc:nature`, `dc:subjects` or `dc:coverage`, which the Properties panel always shows above it, so the app would show it twice. The converter leaves these out.                                                                                                                                                                                                                           | **Inputs**                                                                                                       |
| `…: … is missing, though … shows it`                                                                                | A property Web UI's layout, tab or task layout shows to everyone, the last `…`, is not in that file or tab, and the report neither reports it nor leaves it pending with a reason. A known defect makes it appear on a fresh run, with a `tab`, when a tab shows on several types and the view layout of one of them shows only the document's preview: the converter writes the tab for the others, and the check still holds that one to it. | **Tool**: escalate it once, as that known defect where it is; **Inputs** if `conversion/app/` was edited by hand |
| `…: it shows … … times, not once`                                                                                   | The file or tab holds one property in more than one entry. The converter keeps the first field that binds a property, and reports the others.                                                                                                                                                                                                                                                                                                  | **Inputs**                                                                                                       |
| `…: … names a widget, which version 1 cannot do and ignores`                                                        | An entry of a version 1 file (`metadata`, `edit` or `create`), at the place the second `…` gives, has a `widget`. Version 1 cannot name one, so the app ignores it; the converter never writes one there.                                                                                                                                                                                                                                      | **Inputs**                                                                                                       |
| `…: … shows as its schema type picks, not as …, and the report does not say so`                                     | In a version 1 file, a property Web UI shows with a widget version 1 cannot name, any but `date` and `chips`, shows as its schema type picks, and the report gives no reason. The converter reports each such field, with that reason.                                                                                                                                                                                                         | **Inputs**                                                                                                       |
| `…: … shows as …, not as …`                                                                                         | In a version 2 file (a `view` layout, a tab or a task form), the property's `widget` is not the one the tool's catalogue gives Web UI's element. "its schema type picks" stands for no widget named.                                                                                                                                                                                                                                           | **Inputs**                                                                                                       |
| `…: …'s … widget has the parameters …, not …`                                                                       | The widget is the expected one, but its `parameters` are not those read from the Web UI element's attributes: the line gives the file's, then the expected ones.                                                                                                                                                                                                                                                                               | **Inputs**                                                                                                       |
| `…: … is …, but Web UI's … … it`                                                                                    | In a task form, a variable is read-only (its `readOnlyWhen` always passes) where Web UI's element edits it, or editable where the element only shows it, binding it one way.                                                                                                                                                                                                                                                                   | **Inputs**                                                                                                       |
| `…: … is editable, though Web UI's … only shows it, and the report does not say so`                                 | In an `edit` or `create` file, written in version 1, which cannot make a field read-only, a property Web UI's element only shows is editable, and the report gives no reason. The converter reports each such field.                                                                                                                                                                                                                           | **Inputs**                                                                                                       |
| `…: … is required in Web UI, which a task form cannot say of the record's property, and the report does not say so` | Web UI's task layout requires a property of the document, which a task form cannot require, and the report gives no reason. The converter reports each such field.                                                                                                                                                                                                                                                                             | **Inputs**                                                                                                       |
| `…: … is …required, but Web UI's is …required`                                                                      | In an `edit`, `create` or task form, a property's `required` flag is not Web UI's. A task form's properties of the record are left to the row above.                                                                                                                                                                                                                                                                                           | **Inputs**                                                                                                       |
| `…: … shows no property`                                                                                            | An entry of the file, at the place the second `…` gives, such as `sections.0.fields.1`, is neither a property name nor an object with a `field`.                                                                                                                                                                                                                                                                                               | **Inputs**                                                                                                       |
| `…: it shows …, which … does not`                                                                                   | The file or tab shows a property that Web UI's layout, tab or task layout does not show, not even under a condition.                                                                                                                                                                                                                                                                                                                           | **Inputs**                                                                                                       |
| `…: it has a tab …, which no tab of the package gives`                                                              | A view file has a tab whose `id` is neither `view`, the record page's own, nor that of a tab the package's slot contributions show on that type.                                                                                                                                                                                                                                                                                               | **Inputs**                                                                                                       |
| `…: the package has no task layout of that workflow and step`                                                       | A file under `tasks/` matches no task layout of the package, by the workflow and step its name gives.                                                                                                                                                                                                                                                                                                                                          | **Inputs**                                                                                                       |
| `…: the package has no Web UI layout of that type and mode`                                                         | A file under `layouts/` matches no Web UI layout of the package, by the type and mode its path gives.                                                                                                                                                                                                                                                                                                                                          | **Inputs**                                                                                                       |
| `… is missing, though Web UI's results of … show a list`                                                            | The queue a search screen's results become, `queues/<id>.json` named after the screen's folder, is not in the conversion, and the report does not report the search with a reason. The second `…` is the page provider.                                                                                                                                                                                                                        | **Inputs**                                                                                                       |
| `…: the column … is missing`                                                                                        | A queue lacks a column that Web UI's search results or dashboard card shows to everyone. For a search screen, the report does not report that column either.                                                                                                                                                                                                                                                                                   | **Inputs**                                                                                                       |
| `…: it has a column …, which Web UI's list does not`                                                                | A queue has a column, or one with no property, that Web UI's list does not show.                                                                                                                                                                                                                                                                                                                                                               | **Inputs**                                                                                                       |
| `…: its columns are in the order …, not …`                                                                          | The queue has Web UI's columns in another order: the line gives the queue's order, then Web UI's.                                                                                                                                                                                                                                                                                                                                              | **Inputs**                                                                                                       |
| `…: the column … shows as …, not as …`                                                                              | A column's `widget` is not the one its Web UI template gives: `user`, `chips`, `date` or `relative-date`, or none, written "its schema type picks".                                                                                                                                                                                                                                                                                            | **Inputs**                                                                                                       |

### Check 3: Model

Check 3 holds every field, type, vocabulary and page provider the conversion names to the model, and every widget to its property's type; a task form's variable is held to its step's and its workflow's variables schemas. Without a server it reads the package's own model from its contributions and XSD files and checks that part in full, while the names that rest on the platform's model are listed and make the check `partial`, not a finding. Its findings usually mean that the package's layouts, lists or task layouts name something its own model does not define, or not as they use it: **Package**.

| The finding reads                                                    | What it means                                                                                                                                                                                                                                      | Who acts                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `…: … cannot be checked, because the schema …'s file cannot be read` | A converted field, at the file and place the first `…` gives, names a property of one of the package's own schemas, or a variable of `var_<step>` or `var_<workflow>`, whose XSD file the tool could not read. A `the model:` line names the file. | **Package**; **Tool** if the package holds that file and it is well-formed XML      |
| `…: the schema … has no field …, so … does not exist`                | A converted field, column, sort or button parameter names `<prefix>:<name>`; the package's own schema of that prefix was read, and it has no field of that name at its top level. The package names a property its own schema does not define.     | **Package**; **Inputs** if `conversion/app/` was edited by hand                     |
| `…: the type … has no … schema, so it has no …`                      | The file is the layout of a type the package defines, and it names a property of one of the package's schemas that the type has neither itself, nor through a package type it extends, nor through any facet the package declares.                 | **Package**                                                                         |
| `…: the … widget does not show …, which is a …`                      | The widget the converter chose for Web UI's element does not accept the property's or variable's type as the package's XSD gives it, such as the `date` widget on a `string`.                                                                      | **Package**; **Tool** if the package's Web UI element suits that type               |
| `…: neither var_… nor var_… has a variable …, so … does not exist`   | A task form names `var:<name>`; the package holds both its step's and its workflow's variables schemas, and neither has that variable. The task layout binds a variable its step and workflow do not define.                                       | **Package**; **Inputs** if `conversion/app/` was edited by hand                     |
| `the model: …`                                                       | A part of the package's model could not be read, so what it defines is unknown, and is not taken for the platform's. The rest of the line is one of the two rows below.                                                                            | **Package**; **Tool** if the file it names is in the package and is well-formed XML |
| `… is not well-formed XML, so its part of the model is unknown`      | A file of model contributions in the bundle, which declares types, schemas, page providers, directories or workflows, does not parse as XML. It is printed after `the model: `.                                                                    | **Package**; **Tool** if the file is well-formed XML                                |
| `the schema …'s file, …, cannot be read`                             | A schema the package contributes names, in its `src`, an XSD file the bundle does not hold, or one that does not parse as XML. It is printed after `the model: `.                                                                                  | **Package**; **Tool** if the bundle holds that file and it is well-formed XML       |

### Check 4: Labels

Check 4 holds every translation of the package to the labels file of its language, `conversion/app/labels/<language>.json`, word for word, with nothing else in that file. A translation the report reports, with its reason, is accounted for: a key the labels file refuses, an empty text, or a value that is not a text. The converter writes the labels files from the same reading of the package, so on a run `migrate` wrote check 4 finds nothing: its findings mean `conversion/app/labels/` was changed, or is not of this package (**Inputs**).

| The finding reads                                      | What it means                                                                                                                                                                         | Who acts   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `… is missing, with all … of its translations`         | The conversion has no labels file, `app/labels/<language>.json`, for a language the package translates into. The count is of that language's translations the report does not report. | **Inputs** |
| `…: … is missing`                                      | The labels file lacks a key that a translations file of the package gives a text, and the report does not report that translation.                                                    | **Inputs** |
| `…: … reads …, not …`                                  | The labels file gives the key other words than the package's translation: the line gives the file's text, then the package's.                                                         | **Inputs** |
| `…: … is not a translation of the package`             | The labels file holds a key that no translations file of that language gives, or one the report reports, and so leaves out.                                                           | **Inputs** |
| `app/labels/….json: the package has no … translations` | The conversion has a labels file for a language the package has no translations file of.                                                                                              | **Inputs** |

### Check 5: Conditions

Check 5 holds the conversion's rules to the package's conditions without a server. No rule is invented, each condition's own rule decides as Web UI does on every row of its truth table, and nothing Web UI shows only while a condition passes is shown to everyone; the tables run Web UI's reading of a condition against the app's reading of the rule, as both apps' code is written. On a run `migrate` wrote, every line is **Tool**: the converter wrote something that the check, reading the package on its own, does not accept. The same lines appear after `conversion/` is edited by hand or `check` is run against another package, and that is **Inputs**.

| The finding reads                                                                                                                  | What it means                                                                                                                                                                                                                                                                                                                                                                                 | Who acts                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `…: … reads a permission, which Web UI's task page does not fetch, so Web UI never shows what it guards there`                     | A rule in a task form, a file under `tasks/`, tests a permission of the document. Web UI's task page fetches the task's document without its permissions, so the test never passes there, and the converter reports such a condition rather than writing it.                                                                                                                                  | **Tool**                                                 |
| `…: … holds a rule that no condition of the package gives`                                                                         | A rule at the place named, such as `cards.0.fields.1.visibleWhen`, sits on a field, tab, card, action, home card, menu entry or queue that no condition of the package guards. It is a rule invented, or put on the wrong thing.                                                                                                                                                              | **Tool**                                                 |
| `…: … holds a rule the truth table cannot read, so it cannot be held to Web UI's condition`                                        | The rule at that place is one the check's reading of the app's rules does not know, is nested more than 256 levels deep, or would need a table of more than 200,000 rows with the conditions it sits under. So it was not held to the package's condition.                                                                                                                                    | **Tool**; **Inputs** if `conversion/` was edited by hand |
| `…: … decides otherwise than Web UI's condition on … of … rows, such as …`                                                         | The rule at that place decides differently from the conditions it sits under on some rows of their truth table, as an inverted or widened rule, or one on the wrong field, does. The line gives how many rows disagree, and the first of them.                                                                                                                                                | **Tool**                                                 |
| `condition … of …: the truth table cannot read its rule, so it cannot be held to Web UI's condition`                               | For a condition of the package, by its number in its file, the rule the converter decides for it is one the truth table cannot read. This line reads only the package and the converter's decision, not `conversion/`.                                                                                                                                                                        | **Tool**                                                 |
| `condition … of …: its rule decides otherwise than Web UI on … of … rows, such as …`                                               | The rule the converter decides for that condition disagrees with Web UI's reading of it on some rows of its truth table. It reads only the package, so it appears for this package however the run was made.                                                                                                                                                                                  | **Tool**                                                 |
| `…: it shows … to everyone, though Web UI shows it only while condition … passes`                                                  | A layout, tab or task form shows a field, named by its property and, if it comes from one, its layout block, with no `visibleWhen`, though in the package the field sits in a condition of its own.                                                                                                                                                                                           | **Tool**                                                 |
| `…: it shows … of the layout block … outside the card … and its rule, though Web UI shows the block only while a condition passes` | A field of a layout block that Web UI shows only while a condition passes is written in another card than the block's own, or in a card with no `visibleWhen`. So it shows to people Web UI does not show it to.                                                                                                                                                                              | **Tool**                                                 |
| `…: its tab … shows to everyone, though Web UI shows the tab … only while a condition passes`                                      | A tab of a converted view layout, by its id and then its Web UI name, has no `visibleWhen`, though Web UI shows that tab only while a condition passes.                                                                                                                                                                                                                                       | **Tool**                                                 |
| `actions.json: … shows to everyone, though Web UI shows "…" only while a condition passes`                                         | An action has no `visibleWhen`, though the package's button of that name sits in a condition.                                                                                                                                                                                                                                                                                                 | **Tool**                                                 |
| `…: it lists card …'s records for everyone, though Web UI shows the card only while a condition passes`                            | The queue written for a dashboard card has no `visibleWhen`, though in the package the card sits in a condition, or holds one, that tests something.                                                                                                                                                                                                                                          | **Tool**                                                 |
| `…: it shows the column … to everyone, though Web UI shows it only while a condition passes`                                       | A queue, of a dashboard card or of a search's results, shows a column that Web UI shows only while a condition passes, and the list has no column of that field outside a condition.                                                                                                                                                                                                          | **Tool**                                                 |
| `…: it lists … for everyone, though Web UI shows the table only while a condition passes`                                          | A queue was written for a search's results whose table sits in a condition. The converter writes no queue for such a table, so this one shows the page provider's records, or "its records" when it names none, to everyone.                                                                                                                                                                  | **Tool**                                                 |
| `home.json: … shows card … to everyone, though Web UI shows it only while a condition passes`                                      | A card of `home.json` has no `visibleWhen`, though the dashboard card it stands for sits in a condition that tests something.                                                                                                                                                                                                                                                                 | **Tool**                                                 |
| `navigation.json: … shows to everyone, though Web UI shows the menu entry "…" only while a condition passes`                       | An entry of `navigation.json` has no `visibleWhen`, though Web UI's menu entry, or the page it opens, sits in a condition.                                                                                                                                                                                                                                                                    | **Tool**                                                 |
| `…: … is missing, though … shows it while a condition passes, and its rule converts`                                               | A version 2 file, a tab or a task form lacks a field that Web UI shows under a condition whose rule converts, or a proposed rule a person accepted in `decisions.json`. The converter writes it under its rule. On a run `migrate` wrote, with `--from`, this is **Tool**; without, after `decisions.json` accepts a proposal, the run was made before the decision: run `migrate --from` it. | **Inputs**; **Tool** on a run made with the decisions    |

### Check 6: What people see

Check 6 compares what people see that the package and the conversion both give, without a server: each field, column, list, tab, action and menu entry is named as Web UI names it, with the app's label worked out as the app does, and each action and menu entry is at the order Web UI's slot gives it. A label whose text is in a catalogue the package does not hold is listed in the check's partial reason, not compared, and the values need the migration lab server. On a run `migrate` wrote, every line is **Tool**; after a hand edit of `conversion/`, or `check` run against another package, it is **Inputs**.

| The finding reads                                                           | What it means                                                                                                                                                                                                                                      | Who acts |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `…: the app shows …, where Web UI shows …`                                  | The label the new app works out for a field, a tab, a list's name, a column, a home card, a menu entry or an action differs from the one Web UI shows, both read from the package's own texts. The first part names the file and what is labelled. | **Tool** |
| `actions.json: … is at order …, where Web UI's slot places "…" at …`        | An action's `order` is not the one Web UI's slot gives its button, a later contribution of the same name included. Where Web UI's order is not a whole number, the action must carry none.                                                         | **Tool** |
| `navigation.json: … is at order …, where Web UI's slot places "…" at …`     | A menu entry's `order` is not the one Web UI's slot keeps for its menu item. Where Web UI gives no whole order, the entry must carry none, and the line ends "none".                                                                               | **Tool** |
| `…: … comes before …, where Web UI's slot shows "…" first, both at order …` | Two actions, or two menu entries, of one slot and one order are listed in the file the other way round from Web UI. The app keeps the file's order between equal orders, so they would show the other way round.                                   | **Tool** |

### Check 7: What the server is asked

Check 7 compares what each app is configured to ask the server, without a server: each list asks the same page provider with the same parameters, opening sort and page size; each action runs the same operation with the same parameters, on the record or a selection; the home and the menu open the same lists, each once, and ask for no KPI; and nothing is asked that the package does not ask. Actions are held to the buttons Web UI's slot keeps, under the allow-list the conversion recorded. On a run `migrate` wrote, every line is **Tool**; after a hand edit of `conversion/`, or `check` run against another package, it is **Inputs**.

| The finding reads                                                      | What it means                                                                                                                                                                                                         | Who acts |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `… is missing, though Web UI's card … lists …`                         | There is no queue file at the path the converter gives a dashboard card, though the card lists a page provider's records and the report does not report the card with a reason.                                       | **Tool** |
| `…: it asks the page provider …, where Web UI asks …`                  | A queue names another `pageProvider` than the search screen or dashboard card it was written for.                                                                                                                     | **Tool** |
| `…: it sends the parameters …, where Web UI sends …`                   | A queue's `parameters` differ from its dashboard card's. For a search's results Web UI sends none as the list opens, since a predicate's parameter is sent only once someone fills it in.                             | **Tool** |
| `…: it sorts by …, where Web UI opens sorted by …`                     | A queue's `sort` differs from the sort Web UI's results open with; a dashboard card's list opens with none.                                                                                                           | **Tool** |
| `…: it asks for pages of …, where Web UI asks for …`                   | A queue's `pageSize` differs from its card's page size, or is set where Web UI leaves the page provider's own size. A queue with no `pageSize` reads as 10 in the line.                                               | **Tool** |
| `…: it asks for a list that no screen or card of the package asks for` | A file under `queues/` that no search screen or dashboard card of the package owns.                                                                                                                                   | **Tool** |
| `actions.json: … is missing, though Web UI's "…" runs …`               | A button that becomes an action, as the converter decides it under the allow-list the conversion recorded, has no action of its id in `actions.json`.                                                                 | **Tool** |
| `actions.json: … runs …, where Web UI's "…" runs …`                    | An action's `operation` is not the one its button runs.                                                                                                                                                               | **Tool** |
| `actions.json: … sends …, where Web UI sends …`                        | An action's `parameters` differ from its button's.                                                                                                                                                                    | **Tool** |
| `actions.json: … runs on …, where Web UI's runs on …`                  | An action runs on a selection where its button acts on the open record, or the other way round: its `on` holds `bulk` exactly when the button is a selection's.                                                       | **Tool** |
| `actions.json: … runs something no button of the package runs`         | An action whose id no button of the package owns, or with no id: a disabled, replaced or outranked button made an action, or one invented.                                                                            | **Tool** |
| `…: … is missing, though … opens queues/….json`                        | `home.json` has no card, or `navigation.json` no entry, of the id the converter gives a dashboard card or a menu entry of the package.                                                                                | **Tool** |
| `…: … is there … times, not once`                                      | A card of `home.json` or an entry of `navigation.json` is listed more than once under one id.                                                                                                                         | **Tool** |
| `…: … asks for a KPI, which … does not show`                           | A home card or menu entry carries a `kpi`. Web UI's dashboard shows a list, never a figure, so a KPI asks a page provider for a count nothing in the package asks for.                                                | **Tool** |
| `…: … opens …, where … opens queues/….json`                            | A home card or menu entry opens another queue, or a page, than the one its dashboard card or menu entry opens.                                                                                                        | **Tool** |
| `…: … opens a list …`                                                  | A card of `home.json` or an entry of `navigation.json` whose id no dashboard card or menu entry of the package gives. The line ends "no dashboard card of the package shows" or "no menu entry of the package opens". | **Tool** |

### Check 8: Theme

Check 8 holds each theme of the package to its converted file, `conversion/themes/<name>.json`: each property the tool maps to a token sets that token to its own resolved value, nothing sets a token no property gives, text stays readable on the backgrounds the theme sets, and the theme's files come across byte for byte. The token and file findings compare the conversion with the package by the same mapping the converter uses, so they mean `conversion/themes/` was changed (**Inputs**). The contrast finding is about the package's own colours: **Package**, as section 3 of the customer's guide says.

| The finding reads                                                              | What it means                                                                                                                                                                                                                                                                                                            | Who acts    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `…: … sets … to a value that cannot be resolved, and is not reported`          | In the theme named first, a property the tool maps to a token has a value that cannot be worked out: it refers to a property the theme does not set, with no fallback, or its references go round in a circle. The converter reports each such property; here the report does not.                                       | **Inputs**  |
| `themes/….json is missing, with the … tokens its properties set`               | The conversion has no `themes/<name>.json` for a theme of the package whose properties set tokens.                                                                                                                                                                                                                       | **Inputs**  |
| `…: … is not set, though … sets it to …`                                       | The converted theme lacks a token that a property of the package's theme sets: the line gives the token, the property and its resolved value.                                                                                                                                                                            | **Inputs**  |
| `…: … is …, but … sets it to …`                                                | The converted theme gives the token another value than the property's resolved value.                                                                                                                                                                                                                                    | **Inputs**  |
| `…: … is set, but no property of the theme sets it`                            | The converted theme sets a token that no mapped property of the package's theme gives.                                                                                                                                                                                                                                   | **Inputs**  |
| `…: … (…) on … (…) has a contrast of …, below the … WCAG 2.1 AA asks for text` | Two of the theme's colours, as converted, put text below the 4.5 contrast WCAG 2.1 AA asks for: the line gives the text token and its value, the background token and its value, then the ratio. Six fixed pairs are checked, such as `--mat-sys-on-primary` on `--mat-sys-primary`, each only when the theme sets both. | **Package** |
| `…: … is missing`                                                              | A file of the theme's folder in the package was not copied to `themes/<name>/<file>` in the conversion, and the report does not report it.                                                                                                                                                                               | **Inputs**  |
| `…: … differs from …`                                                          | The copy under `conversion/themes/<name>/` is not byte for byte the package's file the line names.                                                                                                                                                                                                                       | **Inputs**  |

Check 9, plugins, finds nothing yet: it tests the plugins that replace custom elements, which a
later version of the tool brings (phase M3), and always reads `not run`: **Wait**.

### Check 10: Package

Check 10 places and validates every file under `conversion/app/` as the package pipeline does, with `libs/shared/app-definition`: its schema, the IDs it names against the registries, actions' operations against the allow-list, and `app.json`'s platform range against the platform's version. Version 1 layouts (`metadata`, `edit` and `create`), which that validator does not read, are held to version 1's documented contract instead. On a run `migrate` wrote, a validator message means the converter wrote something the pipeline refuses (**Tool**); the version 1 lines and the misplaced files appear only after `conversion/app/` was changed (**Inputs**).

| The finding reads                                                                   | What it means                                                                                                                                                                                                                                                                                        | Who acts                                                                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app/app.json is missing: an app definition needs one`                              | `conversion/app/` has no `app.json`. The converter always writes one.                                                                                                                                                                                                                                | **Inputs**                                                                                                                      |
| `app/…: a file that is not JSON belongs in assets/`                                 | A file under `conversion/app/` whose name does not end in `.json` sits outside `assets/`. The converter writes no such file, so it was added after the run.                                                                                                                                          | **Inputs**                                                                                                                      |
| `app/…: it is out of place, so the package would be refused`                        | A `.json` file under `conversion/app/` sits where an app definition has no file, such as `notes.json`, or a layout of a mode the app does not have.                                                                                                                                                  | **Inputs**                                                                                                                      |
| `app/…: …`                                                                          | The validator of `libs/shared/app-definition`, run as the package pipeline runs it, refuses something in this file: the first `…` is the file and, where there is one, the place in it, and the second is the validator's own message. For a version 1 layout, the message is one of the rows below. | **Tool**; **Inputs** if `conversion/app/` was edited, or `check` was run with another allow-list or another version of the tool |
| `sections must be a list`                                                           | A version 1 layout has no `sections`, or one that is not a list. It is printed after `app/<file>: `.                                                                                                                                                                                                 | **Inputs**                                                                                                                      |
| `… is not a key version 1 has, and the app ignores it`                              | A version 1 layout has a key version 1 does not know: at its top, any but `$schema`, `version`, `display` and `sections`; in a section, any but `id`, `label`, `labelKey` and `fields`; in a field, any but `field`, `label`, `labelKey` and `required`.                                             | **Inputs**                                                                                                                      |
| `display is "sections" or "tabs"`                                                   | A version 1 layout's `display` is neither. The converter writes no `display`.                                                                                                                                                                                                                        | **Inputs**                                                                                                                      |
| `… must be an object`                                                               | A section of a version 1 layout is not an object.                                                                                                                                                                                                                                                    | **Inputs**                                                                                                                      |
| `….id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit` | A section's `id` is missing, or not of that form.                                                                                                                                                                                                                                                    | **Inputs**                                                                                                                      |
| `….id "…" is used twice`                                                            | Two sections of one version 1 layout have the same `id`.                                                                                                                                                                                                                                             | **Inputs**                                                                                                                      |
| `….… must be a text`                                                                | A section's or a field's `label` or `labelKey` is not a text.                                                                                                                                                                                                                                        | **Inputs**                                                                                                                      |
| `….fields must be a list`                                                           | A section's `fields` is missing, or not a list.                                                                                                                                                                                                                                                      | **Inputs**                                                                                                                      |
| `… is not "<prefix>:<name>" or { "field": "<prefix>:<name>" }`                      | A field entry of a version 1 layout names no property of the form `<prefix>:<name>`.                                                                                                                                                                                                                 | **Inputs**                                                                                                                      |
| `… lists … again in its section`                                                    | A section lists the same property twice. The converter writes each property once in a layout.                                                                                                                                                                                                        | **Inputs**                                                                                                                      |
| `….required is true, or left out`                                                   | A field's `required` is something other than `true`.                                                                                                                                                                                                                                                 | **Inputs**                                                                                                                      |

### decisions.json

`decisions.ts` holds the customer's `decisions.json` to the report and to the build of the package: a decision is taken only while what it copied still matches the report, and a file of another format, of another build or with no list is not taken at all. Its lines show in the verdict of `check` or `report` run by hand once the file is filled in, naming `decisions.json`, and in `decisions.txt` on a run with `--from`, naming the earlier file, as decisions not carried; with `--from`, the first three below stop the run at its decisions step instead. They are **Decisions**: the customer corrects the file as the line says.

| The finding reads                                                                                                                                  | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Who acts                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `… is not a studio-migration-decisions/2 file, so none of it is taken`                                                                             | The file is not a JSON object, or its `format` is neither `studio-migration-decisions/2` nor the first format, `studio-migration-decisions/1`, so no decision in it counts. With `--from`, the run is refused before it writes anything.                                                                                                                                                                                                                                                                                               | **Decisions**; keep the top of the file as `migrate` wrote it                                                               |
| `… is for …, and the package given is …, so none of it is taken`                                                                                   | The file's `package` names another build than the package given: its name, version, Studio commit, build time or bundle's SHA-256, of which the first 12 characters are shown. `check` and `report` take a file only for its own build. With `--from`, a file of another build of the same package is carried, by each construct's identity, and this line comes only for another package, or a first-format file of another build, which ends "names each item by its place alone", and the run is refused before it writes anything. | **Decisions**; with `--from`, give an earlier run of this package, or leave it out and fill them in again (guide section 6) |
| `… holds no list of decisions, so none of it is taken`                                                                                             | The file's `decisions` is missing or is not a list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Decisions**                                                                                                               |
| `… holds …, which the file does not take`                                                                                                          | The file has a key at its top other than `format`, `package` and `decisions`, such as an approval. The decisions in it are still read.                                                                                                                                                                                                                                                                                                                                                                                                 | **Decisions**; remove the key                                                                                               |
| `…: decision … names no item`                                                                                                                      | The entry at that place in the list, counted from 1, is not an object, or has no `id`, or an empty one.                                                                                                                                                                                                                                                                                                                                                                                                                                | **Decisions**                                                                                                               |
| `…: … is decided … times`                                                                                                                          | The same `id` is in more than one entry. Which one is meant cannot be told, so none of them is taken.                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Decisions**                                                                                                               |
| `…: … holds …, which a decision does not take`                                                                                                     | An entry has a key other than `id`, `label`, `property`, `outcome`, `to`, `note`, `rule`, `owner` and `decision`, such as a verdict, so it is not taken.                                                                                                                                                                                                                                                                                                                                                                               | **Decisions**                                                                                                               |
| `…: … is not in the report`                                                                                                                        | An entry's `id` names nothing the report lists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Decisions**                                                                                                               |
| `…: … is proposed only because the condition it shows under is, and takes no decision of its own: decide the condition's proposal, and it follows` | An entry decides an item the report gives as `proposed` because the condition it sits in has a proposed rule, such as a field under a `dom-if`. Only the condition's proposal is decided; a run made with its decision writes the field under the rule, or reports it.                                                                                                                                                                                                                                                                 | **Decisions**; remove the entry, and decide the condition                                                                   |
| `…: … is … in the report, and only a reported item or a proposal takes a decision`                                                                 | An entry decides an item the report gives another outcome than `reported` or `proposed`, such as `converted` or `pending`. On a `--from` run after a newer version of the tool, the item may no longer be reported, and needs no decision.                                                                                                                                                                                                                                                                                             | **Decisions**; nothing to do after a newer version of the tool                                                              |
| `…: … was made on another construct than the package holds there now, whose identity is …, not …, so it is not taken: decide it again`             | An entry's `identity`, the fingerprint of the construct it was made on, is not that of the construct the package holds at its `id` now: the entry was moved to another item by hand, or copied from another build, where the same place in a file holds another construct. A decision is never taken for another construct.                                                                                                                                                                                                            | **Decisions**; decide it again, or with `--from` carry it, which finds each construct by its identity                       |
| `…: …: its decision is …, and a proposal is decided "accept" or "reject"`                                                                          | A proposal's `decision` holds something other than `accept` or `reject`, such as words of the customer's own. A proposal is accepted or rejected, and the words go into `reason`.                                                                                                                                                                                                                                                                                                                                                      | **Decisions**                                                                                                               |
| `…: … proposes nothing the converter can write yet, so it cannot be accepted: reject it, with your reason, or leave it for the mapping agent`      | An entry accepts a proposal that holds nothing to write, such as a dashboard card whose list an operation gives, for which no queue can be written. It can be rejected, with the reason, and so decided; accepting it would write nothing.                                                                                                                                                                                                                                                                                             | **Decisions**; reject it, or **Wait** for the mapping agent                                                                 |
| `…: … was made on another … than the report gives now, so it is not taken: decide it again`                                                        | What the entry copied from the report, its label, property, outcome, place it was written to, reason or rule, no longer matches the report; the line names which. The copy was edited, or, on a `--from` run after a newer version of the tool, the report now says something else of the item.                                                                                                                                                                                                                                        | **Decisions**; decide it again                                                                                              |
| `…: …: its … is not text`                                                                                                                          | An entry's `owner` or `decision`, or both, is a number, a list, `null` or another value that is not a string.                                                                                                                                                                                                                                                                                                                                                                                                                          | **Decisions**                                                                                                               |

### approval.json

`approval.ts` holds the conversion's `approval.json`, which only the `approve` command writes, for a person at a terminal, to the conversion as it is now and to the package given. Readiness needs an approval of the report and its decisions as they are: every package's verdict ends with one of these lines until a reviewer approves it, and again after anything the approval covers changes. The approval is the reviewer's, never support's: support never runs `approve` for a customer, and an agent's run cannot, as it has no terminal.

| The finding reads                                                                                                        | What it means                                                                                                                                                                                                                                                                        | Who acts                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `no one has approved the report and its decisions: a person does, with the approve command, once every decision is made` | The conversion holds no `approval.json`. `approve` refuses while a decision is still to make, so this comes first on every run, and stays until the reviewer approves.                                                                                                               | **Decide**: the customer's reviewer, at a terminal            |
| `approval.json is not a studio-migration-approval/1 file, so it approves nothing`                                        | The file is not a JSON object of that format: it was not written by `approve`, or was edited.                                                                                                                                                                                        | **Inputs**; move it aside, and the reviewer approves again    |
| `approval.json names no one who approved it, or no time, so it approves nothing`                                         | The file's `approvedBy` is empty, or its `approvedAt` is not a time. `approve` never writes such a file.                                                                                                                                                                             | **Inputs**; move it aside, and the reviewer approves again    |
| `approval.json approves a report of … …, bundle …, not of the package given, … …, bundle …`                              | The approval was made for another build of the package than the one `check` or `report` is given: another name, version, Studio commit, build time or bundle.                                                                                                                        | **Inputs**; give the package the conversion was made from     |
| `the approval by … at … is void: … … changed since, so a person approves again`                                          | The SHA-256 of `report.json`, of `decisions.json`, or of the conversion's other files is not the one approved: a decision was filled in or edited, the conversion was made again, or a file was edited by hand. Any change voids an approval, which is never carried to another run. | **Decide**: the reviewer reads the report again, and approves |

### The inventory's decisions

`account.ts` holds the inventory against the tool's catalogue, and lists at the end of `inventory.txt`, under "Decisions needed", everything a person has to settle: what the catalogue does not know, what it reports or leaves for an agent to propose, customer code, files it cannot place or read, and the mistakes real projects carry. The list is by kind, and shorter than the report's, which is item by item and is the one `decisions.json` follows. On a run `migrate` wrote, most lines are **Decide** or **Wait**; the last four rows are the reasons that can follow "could not be read:".

| The finding reads                                                               | What it means                                                                                                                                                                                                                               | Who acts                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `… is not in the catalogue`                                                     | A slot, where the line starts `slot … (contribution "…")`, or a custom element, where it starts `element … (used …)`, that the tool's catalogue does not know, so it cannot say what it becomes. A contribution to such a slot is reported. | **Decide**; **Tool** if it is a stock Web UI slot or element  |
| `… is …: …`                                                                     | The catalogue knows the slot or element, under the same two subjects, and marks it "reported" or "for an agent to propose". The text after the colon is the catalogue's reason, such as a slot the app has no place for yet.                | **Decide**; **Wait** where it reads "for an agent to propose" |
| `script … in … is not one Studio generates: review it as customer code`         | A `<script>`, by its number in its file, whose shape matches none of the scripts the catalogue records Studio or Web UI generating. The report gives it as pending, for a Layer 2 plugin in M3.                                             | **Wait**; **Tool** if Studio wrote the script                 |
| `… holds customer code, for an agent to propose as a Layer 2 plugin`            | The project's custom bundle, `nuxeo-…-custom-bundle.html`, holds more than the comments Studio generates it with. The report gives it as pending, for a Layer 2 plugin in M3.                                                               | **Wait**                                                      |
| `theme …: … of its … properties set no token and are reported`                  | That many of the theme's CSS properties have no token in the catalogue's token map, so they set nothing in the new app's theme, and the report reports each with the reason.                                                                | **Decide**                                                    |
| `file … is of no known kind`                                                    | A file of the package or its bundle whose path matches none of the kinds the inventory knows, or a second file defining a layout block another file already defines. The report reports it as "of no known kind".                           | **Decide**; **Tool** if Studio itself writes such a file      |
| `file … could not be read: …`                                                   | A model contribution under `OSGI-INF/` or a translation file `data/i18n/messages*.json` of the bundle could not be read as it must be; the reason follows, as in the last four rows. The inventory lists it rather than stopping.           | **Package**                                                   |
| `slot … (contribution "…") has a nuxeo-operation-button that runs no operation` | A contribution holds a `nuxeo-operation-button` with no `operation`, or an empty one, so in Web UI the button runs nothing. The report reports it rather than making an action of it.                                                       | **Package**; or **Decide** to leave it behind                 |
| `dashboard card … repeats card …, and is kept once`                             | A card of the dashboard, `nuxeo-home.html`, has the same markup as an earlier one, its heading in brackets where it has one. The conversion keeps one, and the report reports the repeat.                                                   | **Decide**                                                    |
| `layout … binds … … times, and keeps it once`                                   | A document layout binds the same property in more than one field. The conversion writes the field once, and the report reports the repeat.                                                                                                  | **Decide**                                                    |
| `not well-formed XML: …`                                                        | A model contribution file under `OSGI-INF/`, other than `deployment-fragment.xml`, is not well-formed XML; the parser's message follows. Its extensions are not counted.                                                                    | **Package**; **Tool** if the file is well-formed              |
| `a translation catalogue must be an object of keys and texts`                   | A translation file is valid JSON, but not an object of keys, such as a list. None of its translations are read.                                                                                                                             | **Package**                                                   |
| `… key(s) hold something other than text, first …`                              | In a translation file, that many keys hold a value that is not text, such as a number or a nested object; the first such key is named. The file's other translations are read.                                                              | **Package**                                                   |
| `not valid JSON: …`                                                             | A translation file is not valid JSON; the parser's message follows. None of its translations are read.                                                                                                                                      | **Package**                                                   |

### Lab mode: the request-log rule

Each line is a difference lab mode found on one document's page between what Web UI and the new
app asked the server for, under the rule of section 8. In `lab.txt` each is under check 7, after
`document <n>: `. They are **Lab**: the new app, its served configuration, or the conversion asks
for less than Web UI does.

| The finding reads                                                                                                                                          | What it means                                                                                                                                                                         | Who acts                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `document …: …`                                                                                                                                            | One document's finding, as `lab.txt` gives it under checks 6 and 7 of the server halves: the number is the document's place among those given, and the rest is one of the rows below. | **Lab**                                      |
| `the new app never asks for the document, which Web UI asks for with …`                                                                                    | Web UI's page read the document, by the id or path given, and no request of the new app's page did.                                                                                   | **Lab**                                      |
| `the document is answered … to Web UI and … to the new app`                                                                                                | Both apps asked for the document and got different answers: one read it, the other was refused or got another status.                                                                 | **Lab**; often the two signed in differently |
| `Web UI asks for the document with every schema (*), the new app only with …`                                                                              | Web UI asked for every schema, and the new app only for those named. Read from what each browser sent, not from what the development server's proxy added.                            | **Lab**                                      |
| `Web UI asks for the document with the schema …, the new app does not`                                                                                     | A schema Web UI asked for the document with is not among those the new app asked for.                                                                                                 | **Lab**                                      |
| `Web UI shows … (…); the new app does not fetch it`                                                                                                        | A property Web UI's layout, the one in brackets, shows outside every condition is in Web UI's answer for the document, and in no answer the new app received.                         | **Lab**                                      |
| `Web UI shows … (…); the new app fetches it, but its … does not show it: no field of the page, no layout file it loaded for …, and no row it draws itself` | The new app received the property Web UI shows, and its page has no field of it, no layout file it loaded for the type lists it, and its page does not draw it itself.                | **Lab**                                      |

### Lab mode: the server halves

Check 3's server half, given `--package` and `--conversion`: each name the conversion rests on the
platform for, check 3's `partial` list, held to the server's own model, read from
`/config/types`, `/config/facets` and `/config/schemas`, the directories, and the page providers'
definitions. A line here names something the package uses that the server does not have as the
package expects: **Package** when the package names it wrongly, **Lab** when the server lacks
what the customer's own servers have, such as an add-on.

| The finding reads                                                                | What it means                                                                                                                                             | Who acts                                                                 |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `the platform's model could not be read: …`                                      | Lab mode could not read the server's types, facets or schemas, so it confirmed nothing; the reason follows.                                               | **Lab**                                                                  |
| `…: the server has no schema of the prefix …, so … does not exist`               | A field the conversion shows, at the file and place first named, has a prefix no schema on the server has.                                                | **Lab**; **Package** if no server of the customer has that schema either |
| `…: the server's schema … has no field …, so … does not exist`                   | The server has the schema of that prefix, and it has no field of that name.                                                                               | **Package**; **Lab** if the customer's servers define the field          |
| `…: the … widget does not show …, which is a … on the server`                    | The widget the conversion chose does not accept the property's or the variable's type as the server defines it.                                           | **Package**; **Tool** if the package's Web UI element suits that type    |
| `…: the type … has no … schema on the server, so it has no …`                    | The layout is of a type whose schemas, the package's and those of the platform type it extends, do not include the property's schema, nor does any facet. | **Package**                                                              |
| `the server has no type …`                                                       | A layout of the conversion is of a type the package does not define and the server does not have.                                                         | **Lab**; **Package** if no server of the customer has it either          |
| `…: neither var_… nor var_… on the server has a variable …, so … does not exist` | A task form's variable is in neither its step's nor its workflow's variables schema on the server.                                                        | **Package**; **Lab** if the workflow is not installed on that server     |
| `the server has no vocabulary …`                                                 | A vocabulary the conversion names is not on the server: its directory answered 404.                                                                       | **Lab**; **Package** if no server of the customer has it either          |
| `the vocabulary … could not be confirmed: the server answered …`                 | The server answered the vocabulary's directory with another status than 200 or 404.                                                                       | **Lab**                                                                  |
| `the page provider … could not be confirmed: the server answered …`              | The server answered the page provider's definition with another status than 200.                                                                          | **Lab**                                                                  |
| `the server has no page provider …`                                              | The server answered, and has no page provider of that name.                                                                                               | **Lab**; **Package** if no server of the customer has it either          |

### Lab mode: as the same user

Before it compares a document, lab mode holds every request each app sent to that user (section
8). Each line names an app's page that did not run as the user; the document is not compared, and
the run exits 2. They are **Lab**: the server's sign-in, or the credentials in the shell, not the
package.

| The finding reads                                                                           | What it means                                                                                                                                  | Who acts |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `… … to Nuxeo went out without the user's credentials, such as … …`                         | That many requests of the app to Nuxeo, but the configuration service's own files, carried no credentials, the first named by method and path. | **Lab**  |
| `its sign-in answered …`                                                                    | Web UI's sign-in, `/automation/login`, answered another status than 200.                                                                       | **Lab**  |
| `its sign-in answered as …, not as …`                                                       | Web UI's sign-in answered as another user than `NUXEO_USER`.                                                                                   | **Lab**  |
| `<the Beta harness's identity guard on /me>`                                                | A `/me` the app read did not answer as the user, as the Beta harness's identity guard (`judgeMe`) judges it: its own message is printed.       | **Lab**  |
| `nothing … read said who its requests ran as: neither /me nor a sign-in was answered for …` | The app read no `/me` and no sign-in that answered 200 as the user.                                                                            | **Lab**  |

### Many packages: each package's result

Each package's line in `summary.txt` starts with its result, and `summary.json` gives it as
`result`. The run's exit code is the worst of them (section 6).

| The finding reads  | Printed as                                                        | What it means                                                                                               | Who acts                                            |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ready`            | `ready`                                                           | Every step ran, no check failed, and the verdict is ready.                                                  | **Decide**: the reviewer's approval is next         |
| `not ready`        | `not ready, and no check failed`                                  | Every step ran and no check failed; the verdict lists what stands in the way. Every package reads so today. | **Decide**; **Wait** for the lines that wait        |
| `check failed`     | `check <n> failed`, or `checks <n>, <n> failed`                   | Every step ran, and a check found something. Read its `check.txt`, and each finding's row above.            | **Tool** or **Package**, as each finding's row says |
| `stopped`          | `stopped at step <n>, <step>`, or `stopped before its first step` | The run of that package stopped: `printed/<name>.txt` says why and what to do, as section 7 does.           | As section 7 says                                   |
| `the same package` | `the same package as <n>, byte for byte, so it was not run again` | The same bytes as an earlier package of the run, which ran instead.                                         | **Decide**: nothing to do                           |

## 10. Keeping this playbook whole

`tools/studio-migration/src/playbook.spec.ts` holds section 9 to the tool's source. Its scanner,
`src/testing/finding-kinds.ts`, reads every source file of the tool, in every folder but the tests'
helpers, and every line it adds to a list of findings: to `findings` or `problems`, to the
verdict's `blockers` and to the inventory's `decisions`, by `push`, `unshift`, `splice`, an index
or making the list again, as the list starts, in a helper the list is given to, or through a list
of its own spread into one, a helper's that returns one, or another file's function whose list is
taken as findings. Each is written as above: a part that is a constant text is that text, and any
other part, filled in as it runs, `…`. The test fails:

- when the tool can print a line no row here holds, in its section: write the row;
- when a row holds a line the tool can no longer print: change or remove it;
- when a finding is built in a way the scanner cannot read as text, or added in a file with no
  section of this playbook: read it, or give it a section, in the scanner's `SOURCES`;
- when a row names no one to act, or a result of several packages has no row.

What the scanner cannot see, a reviewer of a change to the tool holds:

- new words inside a part that is not a constant, such as one of two words chosen as it runs, or
  a value worked out first: the row reads `…` there, so a change of those words changes no row;
- a finding that reaches none of those lists, such as a check that returns its findings under
  another name than `findings`, or a list given to a method of an object, rather than to a
  function of the tool, which adds to it.

The scanner's own tests hold each way above that it reads.
