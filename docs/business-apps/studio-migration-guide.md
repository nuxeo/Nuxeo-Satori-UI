# Migrating your Studio package: a guide

This guide is for someone who looks after a Nuxeo application whose Web UI screens are configured
in Nuxeo Studio, and who wants to see how those screens move to the new Nuxeo app. You run one
command on your own Studio package. It tells you what your package holds, converts what it can,
checks the result, and writes a report with a list of the decisions only a person can make.

You need no Nuxeo server for it, and nothing leaves your computer. The tool behind it is
[`tools/studio-migration`](../../tools/studio-migration/README.md); the
[migration document](studio-migration.md) explains the approach. If you have several Studio
packages, one run can take them all (section 9). Your Nuxeo contact helps with what a run finds
following the [support playbook](studio-migration-support.md).

**Where it stands.** The command is the first piece of phase 10's self-service migration
([development plan](development-plan.md)). Its report tells you what still stands in the way, and
for every package today the verdict is "not ready": some checks need a server that is not built
yet (section 8), and some parts of a package wait for a later version of the tool. Read the
report as a picture of your migration, not as a go-ahead to switch.

## 1. Before you start

You need:

- **Your Studio package.** The `.zip` file Studio builds for a release of your project, the one
  you install on a server. It holds a `package.xml` that declares a `studio` package, an
  `install.xml`, a `studio-registries.json` and your project's bundle, a `.jar`. Give it to the
  tool exactly as Studio built it: do not unzip it and zip it again.
- **A computer with Node.js 24.15 or a later 24 release, and git.** `node --version` says which
  Node.js you have. The repository is tested with Node.js 24 (its `.nvmrc` file and the `engines`
  of its `package.json`); with another version `npm ci` warns about it, and nothing else is
  promised. The commands in this guide are for a macOS or Linux terminal.
- **A copy of this repository, with its dependencies installed:**

  ```bash
  git clone https://github.com/nuxeo/Nuxeo-Satori-UI.git
  cd Nuxeo-Satori-UI
  export SATORI_GH_READONLY_TOKEN=<your token>
  npm ci
  ```

  Some of the repository's dependencies are Hyland packages on GitHub Packages, and `npm ci`
  reads them with a read-only token in `SATORI_GH_READONLY_TOKEN`. Ask your Nuxeo contact for
  one. Without it `npm ci` stops with an authentication error, and the tool cannot run. Use `npm ci`, not `npm install`: `npm ci` installs exactly the versions the repository was
  tested with.

- **Optionally, your deployment's allow-list.** If buttons of your Web UI run Automation
  operations, the new app runs only the operations a deployment allows. Write the ones yours
  allows in a file, and give it to the command with `--allow-list`:

  ```json
  { "operations": ["Document.Update", "Claim.Approve"] }
  ```

  Without it, no button becomes an action of the new app: each is reported, with the reason, for
  you to decide.

**Keep your package private.** This repository is public. Keep your package, and everything the
command writes, in a folder outside your copy of the repository, and never commit them to it.

**What the tool does with your package.** It reads it, and only reads it: it never changes the
file, and runs nothing in it. Scripts in your layouts stay text. The command talks to no network,
and writes what it finds only into the folder you give it; only the tool's lab mode, run by the
team on a server (section 8), talks to one.

## 2. The one command

Run it from the folder you cloned the repository into:

```bash
npm run studio-migration -- migrate <your-package.zip> --out <a-new-folder>
```

For example, with the package in your home folder:

```bash
npm run studio-migration -- migrate ~/studio/my-project-1.0.0.zip --out ~/studio/migration-1
```

- **`--out`** is a folder that does not exist yet, or is empty. The command writes everything
  there, and refuses a folder that already holds anything, so that it never writes over an
  earlier run.
- **`--allow-list <file>`** gives your deployment's operations (section 1).
- **`--from <earlier run>`** carries the decisions you made in an earlier run (section 6).

`npm run` reads relative paths from the repository's folder, whichever folder you run it from. Give
full paths, as above, if your package is elsewhere. What the command prints names every file by its
full path, so you can open it from any folder.

It runs five steps, in order, and prints each as it ends:

| Step                              | What it does                                                                                         | What it writes, in `--out`                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. The inventory                  | Reads every file of the package, and says what each part becomes                                     | `inventory.txt`                                              |
| 2. The conversion                 | Converts what it can into the new app's configuration                                                | `conversion/`, and what the step printed in `conversion.txt` |
| 3. The checks that need no server | Holds the conversion to your package: the checks of section 8                                        | `check.txt`                                                  |
| 4. The report                     | The report a reviewer reads (section 4)                                                              | `report.txt`                                                 |
| 5. The decisions to fill in       | A file with an entry for every reported item and every proposal, for a person's decision (section 5) | `conversion/decisions.json`, and `decisions.txt`             |

`conversion/` holds:

- `app/`, the new app's configuration: its layouts, lists, home page, menu, actions and labels;
- `themes/`, your theme's colours and files;
- `report.json`, every part of your package with what became of it, as data;
- `decisions.json`, from step 5.

Each file holds exactly what that step prints when it is run on its own, given the full path of
`--out`. If you ever want to run a step by hand, the
[tool's README](../../tools/studio-migration/README.md) lists the commands.

At the end it prints the verdict, the checks that still need a server, and what to do next. On
the made-up package the repository tests with, it ends like this (shortened):

```text
3. The checks that need no server: done, and no check failed; in /home/me/studio/migration-1/check.txt
4. The report: done, in /home/me/studio/migration-1/report.txt
5. The decisions to fill in: done; what it printed is in /home/me/studio/migration-1/decisions.txt
   Wrote /home/me/studio/migration-1/conversion/decisions.json: 15 reported items and 1 proposal, 16 of them still to fill in

Verdict: not ready. What stands in the way:
  - check 3 ran only in part
  - check 5 ran only in part
  - check 6 ran only in part
  - check 7 ran only in part
  - 3 constructs are pending a later phase
  - 2 proposals wait for a person to accept or reject them
  - 15 reported items have no owner
  - no one has approved the report and its decisions: a person does, with the approve command, once every decision is made

Checks that still need the migration lab server:
  ...
What to do next:
  1. Read the report, /home/me/studio/migration-1/report.txt: ...
```

**When it ends.** The command exits with:

- **0** when every step ran and no check failed. The verdict can still be "not ready": it usually
  is.
- **1** when a step refused, or a check failed. It says which, and why.
- **2** when the command itself was wrong, such as a missing `--out`. It prints how to use it.

## 3. When it stops

Before it writes anything, the command checks what you gave it. A message that starts with
`migrate:` and says "Nothing was written" is one of these, and you can run again with the same
`--out` once it is fixed:

- **"… already holds files, perhaps an earlier run".** The `--out` folder is not new. Give a new
  folder; to keep the decisions of the earlier run, add `--from <that folder>`.
- **"the package … cannot be read".** The path to your package is wrong. Remember that `npm run`
  reads a relative path from the repository's folder.
- **"the allow-list … is not one it can use".** The file cannot be read, or is not of the form
  `{ "operations": [ ... ] }`.
- **"… holds no decisions.json migrate can read".** `--from` names no earlier run.

Then the command stops at the first step that refuses, says why and what to do, and runs nothing
after it. What it wrote before then stays in `--out`.

- **"1. The inventory: refused".** The file is not a Studio package the tool can read: it is not a
  zip, or holds no `package.xml`, or its `package.xml` declares another kind of package, such as
  an `addon`. Check that you gave it the package Studio builds for your project, as it was built.
  Nothing was written, so you can use the same `--out` again.
- **A later step refused.** The message gives the reason and says what to do. One that names a
  limit of the tool, such as a file name in your package it cannot write on every system, is not
  a mistake of yours: send the message, and the files it names, to your Nuxeo contact. As
  something was written, run again with a new `--out`, or delete the old one first.
- **A check failed.** This is not a refusal: the run carries on to the report and the decisions,
  and exits 1. A failed check means the conversion does not show something as Web UI does. What
  the check found is in `check.txt`, and in the report. Where it is about your package's own
  content, such as a theme colour below the contrast WCAG 2.1 AA asks for, change it in Studio,
  build the package again, and migrate it into a new folder. Do this before you fill in the
  decisions: they are for one build of the package, and a new build carries only those whose part
  of the package is unchanged (section 6).
  Send any other failure to your Nuxeo contact.

## 4. Reading the report

`report.txt` is in six parts.

**The header** names the package, its version and the platform it is for; the Studio branch,
commit and build time recorded in its bundle; the app it became; the version of the converter;
and the allow-list the actions were held to.

**The summary** counts every part of your package, by kind, with what became of it:

| Outcome     | Means                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `converted` | Done. The report says where it went.                                                                   |
| `proposed`  | An agent proposes how to convert it, and a person accepts or rejects that.                             |
| `reported`  | It does not migrate, or not exactly as Web UI shows it. The report says why. A person decides          |
| `generated` | Studio's own packaging, records and templates, which need nothing.                                     |
| `server`    | It stays on the server in your Studio package, and the new app reads it there, such as your data model |
| `pending`   | A later version of the tool converts it, such as a field under a condition in a form.                  |
| `missing`   | Not in the report at all. It must be 0.                                                                |

`decided` counts the reported items with an owner and a decision (section 5). **Coverage** is the
share of your package's parts the report accounts for. It must be 100%.

**What the harness found** lists the ten checks of section 8, each `pass`, `FAIL`, `partial` (the
part that needs no server found nothing, and the rest did not run) or `not run`, then the verdict.
A migration is **ready** only when every check passes, nothing is pending, every proposal is
accepted or rejected and the run was made with those decisions, every reported item has an owner
and a decision, and a reviewer has approved the report (section 7). Each line under the verdict says
what stands in the way:

| Line                                                                    | What to do                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `check N failed`                                                        | Read what it found: section 3, "A check failed"                                                                       |
| `check 10 ran only in part`                                             | Only when `check` or `report` is run by hand without the run's `--allow-list`: give it the same one                   |
| `check N ran only in part`, `check N did not run`                       | For any other check, nothing for now: section 8 says what each needs                                                  |
| `N constructs are pending a later phase`                                | Nothing, for now: a later version of the tool converts them                                                           |
| `N proposals wait for a person to accept or reject them`                | Read them under "Proposals", accept or reject each in `decisions.json`, and run again with `--from`: sections 5 and 6 |
| `N proposal(s) … accepted or rejected with no one's name, or no reason` | Write who decided it, in `owner`, and why, in `reason`: section 5                                                     |
| `the conversion was made with N of its proposals decided otherwise …`   | Run again with `--from`, so that what you accepted is written: section 6                                              |
| `N reported items have no owner`                                        | Fill in `decisions.json`: section 5                                                                                   |
| `N reported items have an owner but no decision`                        | Write what was decided: section 5                                                                                     |
| A line naming `decisions.json`                                          | A decision the tool could not take, with the reason: section 6                                                        |
| `no one has approved the report …`, or `the approval … is void`         | The reviewer approves the report, once every decision is made: section 7                                              |

**Decisions needed** lists every reported item: its name, its file in your package, its id, why
it is reported, where it was written if it was, and its owner and decision, or "none" and
"nothing yet". Then come the **proposals**, each with who accepted or rejected it and why, or
"nothing yet"; for a run that carried decisions from another build of your package, what was
carried, what is offered for you to confirm again, and what was dropped; **what the harness found,
file by file**, each finding under the file of `conversion/` it is about; and **each file** of your
package with what its parts became and what was found in them.

`inventory.txt` is a shorter view of what the package holds, and `check.txt` is the checks alone.
The inventory has a "Decisions needed" list of its own, which is shorter than the report's: it
names what the tool's catalogue does not know or cannot map, by kind, such as a theme's colours
that set nothing. The report's list is every reported item, one by one, and is the one
`decisions.json` follows.

## 5. Filling in the decisions

`conversion/decisions.json` has an entry for every reported item and every proposal, in the
report's order. A reported item's looks like this:

```json
{
  "id": "search:web/nuxeo.war/ui/search/claims/nuxeo-claims-search-form.html#search",
  "label": "the search form of claims",
  "outcome": "reported",
  "note": "A queue has no search form yet: it lists what its page provider returns with these predicates left empty, as Web UI does before anyone searches",
  "owner": "",
  "decision": ""
}
```

Every entry also has an `identity`, which says which part of your package it is about, and a
`property`, a `to` or a `rule` when the report gives its item one. For each reported item, write:

- **`owner`:** who decides it, a person or a team;
- **`decision`:** what they decided, in their own words, such as "Keep the search in Web UI until
  the new app has search forms" or "Not needed: nobody uses this screen".

**A proposal** is something the tool can convert only once a person agrees: a condition written as
JavaScript in a pattern the tool knows, such as `[[hasFacet(document, 'Versionable')]]`, for which it
proposes the new app's rule, given in the entry's `rule`. Read its `note`, check that the rule
shows what Web UI shows, and write:

- **`owner`:** your name;
- **`decision`:** `accept` or `reject`, exactly so;
- **`reason`:** why, in your own words, such as "The layout's host has hasFacet, as Web UI's stock
  layouts do".

What you accept is written into the new app's configuration on the next run with `--from`
(section 6), and the checks hold it to Web UI's condition. What you reject is written nowhere, and
what it shows, such as a field under the condition, becomes a reported item for a decision of its
own. A field under a proposed condition has no entry: it follows the condition's decision. A
dashboard card fed by an operation, such as the favourites card, proposes nothing the tool can write
yet: you can reject it, with your reason, and not accept it.

A custom element of your custom bundle is proposed as a Layer 2 plugin, a library in your copy of
this repository at the entry's `to`, which an agent or a developer writes and check 9 holds to the
element. Accept it once check 9 passes and you have read the plugin: the conversion writes nothing
for it, and your acceptance is what readiness waits for. Reject it, and it must not be built into
your app. The approval covers each plugin you accepted, file by file, so changing one afterwards
means approving again. A changed element in a new build of your package is another element: its
earlier decision is not carried, and you decide its plugin again.

Change nothing else. The other keys are copied from the report, so that a decision is taken only
while the report still says the same about its item: if the next run gives the item another
reason, the decision is not taken, and the item is decided again. Do not add entries or keys, and
keep the top of the file as it is: it names the build of the package the decisions are for.

**Make your changes in Studio first.** Decisions are for one build of your package, and a new build
carries only those whose part is unchanged, and asks you to confirm the others again (section 6). If you mean to fix something in Studio, such as a check that failed,
build the package again and migrate it before you fill in the decisions.

## 6. Running it again

The command never writes over a run, so a run that counts your decisions goes into a new folder.
`--from` carries them:

```bash
npm run studio-migration -- migrate ~/studio/my-project-1.0.0.zip --out ~/studio/migration-2 --from ~/studio/migration-1
```

A run that gets to its end with decisions still to fill in prints this command for you, with the
next free folder name.

- **What is carried:** each decision of the earlier run that still holds. `decisions.txt` says
  how many were carried, and lists each one that was not, with why. The earlier run is only read:
  its files are never changed.
- **The order changes.** With `--from`, the decisions step runs third, before the checks, so that
  the checks and the report count your decisions: inventory, conversion, decisions, checks,
  report.
- **Use the same `--allow-list`** as the earlier run, or none if it had none.
- **What you accepted is written.** With `--from`, the conversion is made with your decisions on
  the proposals, so this run's `conversion/` holds what you accepted, and nothing you did not.
- **Another build of your package.** Give `--from` the run of an earlier build, after you changed
  something in Studio and built the package again. Each decision is carried to the same part of
  your package in the new build, found by its `identity`, wherever it moved in its file:
  - **carried** when the part is unchanged;
  - **offered for you to confirm again** when the part changed, such as a field with a new label:
    its entry is blank, with the earlier decision beside it in `earlier`, and you fill it in again,
    the same or otherwise;
  - **dropped** when the part is gone, or the new build holds two parts alike that the tool cannot
    tell apart.

  `decisions.txt` and the report list each. A decision is never carried by its place in a file,
  which another build can give another part. `--from` the run of another package is refused before
  anything is written.

- **A newer version of the tool.** After updating your copy of the repository (`git pull`, then
  `npm ci`), run again with `--from` on the same package. The tool may convert more than before;
  a decision on an item that is no longer reported, or whose reason changed, is listed as not
  carried.

You can also look at a run without running it again: these print the verdict and the report with
the decisions as they are in its `decisions.json` now, and write nothing. Add the run's
`--allow-list`, if it had one.

```bash
npm run studio-migration -- check <your-package.zip> ~/studio/migration-1/conversion
npm run studio-migration -- report <your-package.zip> ~/studio/migration-1/conversion
```

## 7. Approving the report

When every decision is made and the run made with them, the person who reviews the migration
approves its report, themselves, at a terminal:

```bash
npm run studio-migration -- approve ~/studio/my-project-1.0.0.zip ~/studio/migration-2/conversion --by "Your Name"
```

It shows the SHA-256 of `report.json`, of `decisions.json` and of the conversion's other files,
asks you to type the first 8 characters of the digest it shows, and writes `approval.json` into
the conversion: who approved, when, and those digests. It refuses while a decision is still to
make, and where it is not run at a terminal, as in a script: no run of the tool approves itself,
and `migrate` never does.

Any change after that, a decision changed, a file edited, voids the approval, and the verdict says
so: read the report again, and approve again. A new run is a new report, approved on its own.

## 8. What a server-side check adds

The harness has ten checks. The command runs every check, or the half of a check, that needs only
your package and its conversion:

| #   | Check                    | Without a server                                                                                                                                                     | Its server half, on the migration lab server                                                                     |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Nothing dropped          | Every part of the package is in the report once, counted two independent ways                                                                                        | None                                                                                                             |
| 2   | Fields                   | Each layout shows the same fields, modes, required flags and widgets                                                                                                 | None                                                                                                             |
| 3   | Model                    | Every field, type, vocabulary and page provider your package defines exists                                                                                          | Confirms those the platform defines, from the server's own definitions                                           |
| 4   | Labels                   | Every translation survives, in every language                                                                                                                        | None                                                                                                             |
| 5   | Conditions               | Each rule decides as the original condition, read from both apps' code                                                                                               | Evaluates each original condition in Web UI itself, for test users and documents                                 |
| 6   | What people see          | Labels and the order of buttons, menu entries and tabs                                                                                                               | Opens the same documents in both apps as the same user, compares every value, and takes screenshots side by side |
| 7   | What the server is asked | Each list and button asks for the same page provider, operation and parameters                                                                                       | Records the requests both apps really send, and compares them and their result counts                            |
| 8   | Theme                    | Colours mapped, files kept byte for byte, text contrast checked against WCAG 2.1 AA                                                                                  | None                                                                                                             |
| 9   | Plugins                  | Each custom element's plugin is the element's, safe, and built in. Run with `--run-plugins --observed`, its tests and gates pass and it shows what the element shows | Reading what each element shows in Web UI, for `--observed`                                                      |
| 10  | Package                  | The new app's configuration passes the package pipeline's validator. Run by hand without the run's `--allow-list`, it runs in part                                   | None                                                                                                             |

**The migration lab server** is a Nuxeo server with your Studio package installed, Web UI running,
and the new app installed beside it on the same documents, with fictional test users and groups.
The server halves compare the new app with Web UI as it actually runs your package, which the
package alone cannot show: a condition can depend on what the server returns, a value on how a
widget formats it, a list on what search finds.

Until those halves run, each of checks 3, 5, 6 and 7 that has something to settle on the server
stays `partial`, and the verdict stays "not ready", however complete your decisions are. Check 5,
for example, has nothing to settle in a package with no conditions. The command lists each check
still waiting at the end of a run, with what its server half would add and what this run could
not settle. **The command does not run them: it talks to no server.** The tool's lab mode, run by
the team on a server, runs check 3's server half and part of 6 and 7; checks 5, 6 and 7 need your
package installed there, and the lab server that would have it is not built. Keep your run, and
ask your Nuxeo contact about having them run.

## 9. Several packages in one run

If you look after several Studio projects, give `migrate` all their packages at once, or the folder
that holds them, or both:

```bash
npm run studio-migration -- migrate ~/studio/packages --out ~/studio/migration-1
npm run studio-migration -- migrate ~/studio/claims-1.0.0.zip ~/studio/policies-2.1.0.zip --out ~/studio/migration-1
```

Each package runs exactly as it would alone, with the same `--allow-list`, into a folder of its
own. One package that cannot be read, stops at a step, or fails a check changes nothing for the
others: each runs as it would have without it. `--out` holds:

- `packages/<name>/`, one folder for each package, holding what sections 2 to 6 describe for one
  run: its report, its checks and its `conversion/decisions.json` to fill in. `<name>` is the
  package's file name less `.zip`, with each character but a letter, a digit, `.`, `_` and `-`
  written `-`, dots at its end dropped, and a name Windows keeps for a device, such as `CON`,
  written `_CON`, so that every system can hold it;
- `printed/<name>.txt`, what that package's run printed: its steps and its verdict, or why it
  stopped and what to do;
- `summary.txt`, what the command printed: a line for each package with its result, its constructs
  by outcome, as its report counts them, and where its report is; then how many ended each way,
  and what to do next;
- `summary.json`, the same as data.

**A folder** gives the `.zip` files directly in it, in the order of their names. The summary lists
anything else it holds as left out, but for files whose name starts with a dot, which your system
keeps. **The same package twice**, the same file or a copy of it under another name, runs once:
the summary says the second is the same package as the first. **Two files of one name**, from two
folders, get two folders, `claims` and `claims-2`. Two packages that **declare the same name and
version** but are not the same file, most often two builds of one version, both run, and the
summary says so: each has its own decisions.

**When it ends,** it exits as the worst of its packages would alone:

- **0** when every package ran every step and no check failed in any of them. Their verdicts can
  still be "not ready": they usually are.
- **1** when a package stopped, or a check failed in one, or the command refused before writing
  anything, as section 3 says for one package. A folder with no `.zip` file in it is refused too.
- **2** when the command itself was wrong, such as a missing `--out`.

**Running them again.** Fill in each package's `conversion/decisions.json`, then give `--from` the
earlier run's `--out`: each package carries the decisions of its own earlier folder, found by the
package's bytes, whatever its file is called now, or else by its build, as section 6 says. A
package the earlier run did not have, or a new build of one, starts its decisions again, and its
line says "Nothing carried".
The summary prints the command, with the next free folder. To carry the decisions of a run of one
package, run that package on its own with `--from` that run.

## 10. Words the output uses

- **Construct:** one part of your package the tool counts and accounts for, such as a layout, a
  field, a column, a button, a translation, a theme colour or a file.
- **The harness:** the ten checks of section 8.
- **Truth table:** for a condition, every combination of what it tests, such as each group a user
  may be in and each type a document may have. A converted rule passes when it decides as the
  original does on every row.
- **The migration server, the migration lab server:** the same server, of section 8.
- **Phases M1 to M4:** the stages of the migration work, in the
  [migration document](studio-migration.md), section 10. M3 turns custom elements into plugins; M4
  is this command and what comes after it.
- **Layer 0, Layer 2:** levels of the new app's configuration: Layer 0 is what it reads as it
  starts, such as your theme's colours; Layer 2 is plugins, code a person reviews.
- **A reference in a note,** such as "(layout-v2.md, section 10)" or "(app-definition-v2.md,
  section 6)": a section of the team's design documents, in this folder of the repository,
  `docs/business-apps/`. `extension-reference.md` is in `docs/`. A bare "(section 3)" is a section
  of the [migration document](studio-migration.md), and "(decision 3)" is in the
  [decision log](decisions.md).

## 11. Not done yet

- **The server halves** of checks 5, 6 and 7 on your package, and the lab server they run on.
  Check 3's runs in the tool's lab mode, on a server.
- **A target for a card an operation feeds,** such as the favourites card: it can be rejected,
  not accepted, until the tool proposes something to write for it.
- **Your custom elements as plugins, unattended.** Each custom element of your custom bundle is
  proposed as a Layer 2 plugin, which an agent or a developer writes in your copy of this
  repository with `npm run studio-migration -- plugin` and the studio-plugin skill, check 9 holds
  to the element, and a person accepts or rejects in `decisions.json`, as any proposal. It has been
  tried on made-up elements only, and what each element shows in Web UI, which check 9's values
  need, is not read from Web UI yet.
- **Installing the migrated app.** `conversion/app/` is the new app's configuration; installing it
  beside Web UI is not part of this guide.
- **An upload service.** You run the command yourself, on a copy of this repository; uploading a
  package and getting its report back comes later in phase 10.
