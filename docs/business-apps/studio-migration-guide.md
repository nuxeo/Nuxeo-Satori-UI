# Migrating your Studio package: a guide

This guide is for someone who looks after a Nuxeo application whose Web UI screens are configured
in Nuxeo Studio, and who wants to see how those screens move to the new Nuxeo app. You run one
command on your own Studio package. It tells you what your package holds, converts what it can,
checks the result, and writes a report with a list of the decisions only a person can make.

You need no Nuxeo server for it, and nothing leaves your computer. The tool behind it is
[`tools/studio-migration`](../../tools/studio-migration/README.md); the
[migration document](studio-migration.md) explains the approach.

**Where it stands.** The command is the first piece of phase 10's self-service migration
([development plan](development-plan.md)). Its report tells you what still stands in the way, and
for every package today the verdict is "not ready": some checks need a server that is not built
yet (section 7), and some parts of a package wait for a later version of the tool. Read the
report as a picture of your migration, not as a go-ahead to switch.

## 1. Before you start

You need:

- **Your Studio package.** The `.zip` file Studio builds for a release of your project, the one
  you install on a server. It holds a `package.xml` that declares a `studio` package, an
  `install.xml`, a `studio-registries.json` and your project's bundle, a `.jar`. Give it to the
  tool exactly as Studio built it: do not unzip it and zip it again.
- **A computer with Node.js 24 and git.** The repository names the Node.js version it is tested
  with in its `.nvmrc` file. The commands in this guide are for a macOS or Linux terminal.
- **A copy of this repository, with its dependencies installed:**

  ```bash
  git clone https://github.com/nuxeo/Nuxeo-Satori-UI.git
  cd Nuxeo-Satori-UI
  export SATORI_GH_READONLY_TOKEN=<your token>
  npm ci
  ```

  Some of the repository's dependencies are Hyland packages on GitHub Packages, and `npm ci`
  reads them with a read-only token in `SATORI_GH_READONLY_TOKEN`. Ask your Nuxeo contact for
  one. Without it `npm ci` stops with an authentication error (401 or 403), and the tool cannot
  run. Use `npm ci`, not `npm install`: `npm ci` installs exactly the versions the repository was
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
file, and runs nothing in it. Scripts in your layouts stay text. It has no code that talks to a
network, and writes only into the folder you give it.

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
full paths, as above, if your package is elsewhere.

It runs five steps, in order, and prints each as it ends:

| Step                              | What it does                                                                      | What it writes, in `--out`                                   |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. The inventory                  | Reads every file of the package, and says what each part becomes                  | `inventory.txt`                                              |
| 2. The conversion                 | Converts what it can into the new app's configuration                             | `conversion/`, and what the step printed in `conversion.txt` |
| 3. The checks that need no server | Holds the conversion to your package: the checks of section 7                     | `check.txt`                                                  |
| 4. The report                     | The report a reviewer reads (section 4)                                           | `report.txt`                                                 |
| 5. The decisions to fill in       | A file with an entry for every reported item, for a person's decision (section 5) | `conversion/decisions.json`, and `decisions.txt`             |

`conversion/` holds:

- `app/`, the new app's configuration: its layouts, lists, home page, menu, actions and labels;
- `themes/`, your theme's colours and files;
- `report.json`, every part of your package with what became of it, as data;
- `decisions.json`, from step 5.

Each file holds exactly what that step prints when it is run on its own. If you ever want to run
a step by hand, the [tool's README](../../tools/studio-migration/README.md) lists the commands.

At the end it prints the verdict, the checks that still need a server, and what to do next. On
the made-up package the repository tests with, it ends like this (shortened):

```text
3. The checks that need no server: done, and no check failed; in /home/me/studio/migration-1/check.txt
4. The report: done, in /home/me/studio/migration-1/report.txt
5. The decisions to fill in: done; what it printed is in /home/me/studio/migration-1/decisions.txt
   Wrote /home/me/studio/migration-1/conversion/decisions.json: 15 reported items, 15 of them with an owner or a decision to fill in

Verdict: not ready. What stands in the way:
  - check 3 ran only in part
  - check 5 ran only in part
  - check 6 ran only in part
  - check 7 ran only in part
  - check 9 did not run
  - 3 constructs are pending a later phase
  - 2 proposals wait for a person to accept or reject them
  - 15 reported items have no owner

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

The command stops at the first step that refuses, says why and what to do, and runs nothing after
it. What it wrote before then stays in `--out`.

- **"migrate: … already holds files, perhaps an earlier run".** The `--out` folder is not new. The
  command wrote nothing. Give a new folder; to keep the decisions of the earlier run, add
  `--from <that folder>`.
- **"1. The inventory: refused".** The file is not a Studio package the tool can read: it is not a
  zip, or holds no `package.xml`, or its `package.xml` declares another kind of package, such as
  an `addon`. Check that you gave it the package Studio builds for your project, as it was built.
  Nothing was written, so you can use the same `--out` again.
- **A later step refused.** The message gives the reason and says what to do. One that names a
  limit of the tool, such as a file name in your package it cannot write on every system, is not
  a mistake of yours: send the message and the `--out` folder to your Nuxeo contact. As something
  was written, run again with a new `--out`, or delete the old one first.
- **A check failed.** This is not a refusal: the run carries on to the report and the decisions,
  and exits 1. A failed check means the conversion does not show something as Web UI does. What
  the check found is in `check.txt`, and in the report. Where it is about your package's own
  content, such as a theme colour below the contrast WCAG 2.1 AA asks for, change it in Studio,
  build the package again, and migrate it into a new folder. Send any other failure to your Nuxeo
  contact.

## 4. Reading the report

`report.txt` is in five parts.

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
| `pending`   | A later version of the tool converts it, such as custom code.                                          |
| `missing`   | Not in the report at all. It must be 0.                                                                |

`decided` counts the reported items with an owner and a decision (section 5). **Coverage** is the
share of your package's parts the report accounts for. It must be 100%.

**What the harness found** lists the ten checks of section 7, each `pass`, `FAIL`, `partial` (the
part that needs no server found nothing, and the rest did not run) or `not run`, then the verdict.
A migration is **ready** only when every check passes, nothing is pending, no proposal waits, and
every reported item has an owner and a decision. Each line under the verdict says what stands in
the way:

| Line                                                     | What to do                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `check N failed`                                         | Read what it found: section 3, "A check failed"                                                           |
| `check N ran only in part`, `check N did not run`        | Nothing, for now: section 7 says what each needs                                                          |
| `N constructs are pending a later phase`                 | Nothing, for now: a later version of the tool converts them                                               |
| `N proposals wait for a person to accept or reject them` | Read them under "Proposals". Accepting or rejecting one is not built yet, so they stay in the way for now |
| `N reported items have no owner`                         | Fill in `decisions.json`: section 5                                                                       |
| `N reported items have an owner but no decision`         | Write what was decided: section 5                                                                         |
| A line naming `decisions.json`                           | A decision the tool could not take, with the reason: section 6                                            |

**Decisions needed** lists every reported item: its name, its file in your package, its id, why
it is reported, where it was written if it was, and its owner and decision, or "none" and
"nothing yet". Then come the **proposals**, and **each file** of your package with what its parts
became.

`inventory.txt` is a shorter view of what the package holds, and `check.txt` is the checks alone.

## 5. Filling in the decisions

`conversion/decisions.json` has an entry for every reported item, in the report's order:

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

For each entry, write:

- **`owner`:** who decides it, a person or a team;
- **`decision`:** what they decided, in their own words, such as "Keep the search in Web UI until
  the new app has search forms" or "Not needed: nobody uses this screen".

Change nothing else. The other keys are copied from the report, so that a decision is taken only
while the report still says the same about its item: if the next run gives the item another
reason, the decision is not taken, and the item is decided again. Do not add entries or keys, and
keep the top of the file as it is: it names the build of the package the decisions are for.

## 6. Running it again

The command never writes over a run, so a run that counts your decisions goes into a new folder.
`--from` carries them:

```bash
npm run studio-migration -- migrate ~/studio/my-project-1.0.0.zip --out ~/studio/migration-2 --from ~/studio/migration-1
```

A run that gets to its end prints this command for you, with the next free folder name.

- **What is carried:** each decision of the earlier run that still holds. `decisions.txt` says
  how many were carried, and lists each one that was not, with why. The earlier run is only read:
  its files are never changed.
- **The order changes.** With `--from`, the decisions step runs third, before the checks, so that
  the checks and the report count your decisions: inventory, conversion, decisions, checks,
  report.
- **Use the same `--allow-list`** as the earlier run, or none if it had none.
- **Another build of your package.** Decisions are for one build: its name and version, the
  Studio commit and build time, and the exact bundle. An id names a place in a file, and another
  build can put something else there. So `--from` refuses the decisions of another build, and the
  run stops at its decisions step. Leave `--from` out and fill in the decisions again; you can
  copy each `owner` and `decision` across by hand where the item is the same. Carrying decisions
  to a new build is not built yet.
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

## 7. What a server-side check adds

The harness has ten checks. The command runs every check, or the half of a check, that needs only
your package and its conversion:

| #   | Check                    | Without a server                                                                                     | Its server half, on the migration lab server                                                                     |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Nothing dropped          | Every part of the package is in the report once, counted two independent ways                        | None                                                                                                             |
| 2   | Fields                   | Each layout shows the same fields, modes, required flags and widgets                                 | None                                                                                                             |
| 3   | Model                    | Every field, type, vocabulary and page provider your package defines exists                          | Confirms those the platform defines, from the server's own definitions                                           |
| 4   | Labels                   | Every translation survives, in every language                                                        | None                                                                                                             |
| 5   | Conditions               | Each rule decides as the original condition, read from both apps' code                               | Evaluates each original condition in Web UI itself, for test users and documents                                 |
| 6   | What people see          | Labels and the order of buttons, menu entries and tabs                                               | Opens the same documents in both apps as the same user, compares every value, and takes screenshots side by side |
| 7   | What the server is asked | Each list and button asks for the same page provider, operation and parameters                       | Records the requests both apps really send, and compares them and their result counts                            |
| 8   | Theme                    | Colours mapped, files kept byte for byte, text contrast checked against WCAG 2.1 AA                  | None                                                                                                             |
| 9   | Plugins                  | Not run: it tests the plugins that replace custom elements, which a later version of the tool brings | -                                                                                                                |
| 10  | Package                  | The new app's configuration passes the package pipeline's validator                                  | None                                                                                                             |

**The migration lab server** is a Nuxeo server with your Studio package installed, Web UI running,
and the new app installed beside it on the same documents, with fictional test users and groups.
The server halves compare the new app with Web UI as it actually runs your package, which the
package alone cannot show: a condition can depend on what the server returns, a value on how a
widget formats it, a list on what search finds.

Until those halves run, checks 3, 5, 6 and 7 stay `partial`, and the verdict stays "not ready",
however complete your decisions are. The command lists each of them at the end of a run, with
what it would add and what this run could not settle. **This tool does not run them yet: none of
it talks to a server, and the lab server is not built.** Keep your run, and ask your Nuxeo contact
about having them run.

## 8. Not done yet

- **The server halves** of checks 3, 5, 6 and 7, and the lab server they run on.
- **Accepting or rejecting a proposal.** A proposal waits, and stays in the way of readiness.
- **Carrying decisions to a new build** of your package.
- **Installing the migrated app.** `conversion/app/` is the new app's configuration; installing it
  beside Web UI is not part of this guide.
- **Recording a reviewer's approval** of the report.
- **An upload service.** You run the command yourself, on a copy of this repository; uploading a
  package and getting its report back, and many packages in one run, come later in phase 10.
