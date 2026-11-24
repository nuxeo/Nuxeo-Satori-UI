# Notifications

The notification centre: a bell in the shell's header with the number of unread items, which opens
a panel listing the signed-in user's open tasks and the recent changes other people made to the
records they follow. Phase 2 of the business apps
[development plan](../../../docs/business-apps/development-plan.md) asks for "a first notification
centre"; [architecture.md](../../../docs/business-apps/architecture.md), section 4, lists
notifications among the engines every module shares.

It is an engine (tier 3): tagged `scope:shared` and `scope:engine`, importing shared code only.

**In the app only.** Nuxeo has no notification API (`/api/v1/notification`,
`/api/v1/me/notifications` and `/api/v1/me/subscriptions` answer 404 on Nuxeo 2025), so the bell
reads what the platform has: workflow tasks, document subscriptions and the audit. It writes
nothing. A server-side notification service, which would also give a shared read state, waits on
decision B.

## What the panel lists

- **Your open tasks**: the 20 newest, each opening its task at `/tasks/<id>`. The same read the
  tasks page makes (`TaskService.getUserTasks`). Nuxeo answers the task list oldest first and
  ignores `sortBy`, so the bell reads 100 and keeps the newest 20: with more than 100 open tasks,
  the newest of them are not seen. Each says when the task was created.
- **Changes to records you follow**: over the last seven days, up to 50, newest first, each opening
  its record at `/doc/<uid>`. Each says who made it, what it was, "Modified" or "State changed to
  …", and when.

Every time is an instant shown in the reader's own zone (AGENTS/08-bug-patterns.md, pattern 29).

**A record you follow** is one whose `notif:notifications` lists you as `user:<id>`: what Browse's
and the document page's "Subscribe" (`Document.Subscribe`) writes. Commenting follows a record
too: on the local server, Nuxeo had subscribed each record's commenters to its comment events.

**What counts as a change**: an edit (a comment is one: Nuxeo audits it as `documentModified` on its
record) and a lifecycle transition. These move the record's `dc:modified`, which is how the bell
finds the records that changed. A lock, an unlock, a check-in and a permission change leave
`dc:modified` alone (measured), so the bell does not list them; moves and publishing were not
measured, and are not listed either. Your own changes are not listed. Changes Nuxeo makes as
`system`, such as a transition an automation runs, are listed, as they are changes to the record.

## How it checks

- **At an interval**, every 60 seconds unless a configuration package says otherwise:

  ```json
  { "notifications": { "pollIntervalMs": 120000 } }
  ```

  a Layer 0 key of the bootstrap configuration. `null` keeps the default; the bell holds a value to
  between 15 seconds and an hour. A check reads the open tasks and the 20 followed records modified
  most recently in the window, and reads the audit only for the records whose `dc:modified` moved
  since the bell last read them: none, most of the time. When all 20 were modified after the newest
  record the last check saw, which is a change to many records at once, it reads the next 20 as
  well, up to 100.

- **Not while the tab is hidden.** A check that falls due while it is hidden runs when it is shown
  again.
- **Backing off on errors.** After a failed check the wait doubles, up to 15 minutes or the interval
  if that is longer; a successful check brings it back. The panel says when the latest check failed
  and keeps what the last good one found.
- **When the panel opens**, unless a check ran in the last 15 seconds.
- **Never keeping a session alive.** Every read carries `backgroundRequestContext()`
  (`@nuxeo/satori-platform/nuxeo-client`), and the auth interceptor does not count a response to one
  as activity for the idle timer, which counts every other successful Nuxeo response and the
  reader's mouse, keyboard, touch and scroll. A tab left open on the bell signs out at the idle
  timeout as one without it does. A background read still carries the credentials, and a 401 still
  ends the session.
- **Outside Angular's zone**, so that its timer does not keep the application unstable.
- **In each tab.** Two tabs of the app check separately; what one has seen is seen in the other at
  once.

The audit is read in one request for an administrator (`Audit.QueryWithPageProvider`, which Nuxeo
allows to administrators only) and one `@audit` request per changed record for anyone else, four
at a time; each 50 entries to a page, up to four pages, so that your own entries cannot crowd other
people's out. A task whose record comes back without its title costs a read of the record: Nuxeo
sends the titles with the task list (`X-NXfetch.task`), so this is rare. See
[api-integrations.md](../../../docs/api-integrations.md), section 35.

## Read state: in this browser only

- **The count** is the items the panel has not shown you yet.
- **Opening the panel** marks what it shows as seen: the count clears, and what was new keeps a
  "New" tag until the panel closes.
- **Closing the panel**, or **"Mark all as read"** while it is open, marks as seen what arrived
  while it was open too.

What you have seen is kept per user in this browser's `localStorage`, under
`nuxeo-satori.notifications.seen:<user>`: the items the panel showed (`task:<id>`,
`change:<audit id>`), the 500 most recent. The items, not a time: a time would mark as seen a
change made just before you opened the panel and read by the bell just after, which then never
counts. **It is not shared across devices or browsers**, and clearing the browser's storage clears
it: an item read on one computer is unread on another until the panel is opened there. The panel
says so in its footnote. A shared read state needs the server service that waits on decision B.

## What it does not do

These need a server service, which waits on decision B:

- **@mentions** in comments;
- **email when a task is assigned**, or any other email (Nuxeo's own email notifications are sent by
  the server, with SMTP configured, for the subscriptions the bell reads);
- a read state shared across devices, and digests.

Also not done in this first version:

- changes **inside** a followed folder: only the followed records themselves are read;
- subscriptions held by a **group** you are in;
- people's full names: the audit's user name is shown.

## Turning it off

A manifest fragment's feature toggle removes the bell from the header:

```json
{ "version": 1, "featureToggles": { "notifications.bell": false } }
```

The header has no extension slot, so the bell is not addressed by ID; the toggle is its only switch.
Hiding it is not a security control: tasks and the audit are read with the user's own permissions.

## What is in it

| File                                     | What it does                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `notification-bell/notification-bell.ts` | `NotificationBellComponent`, `lib-notification-bell`: the button, its count and the panel |
| `notification-center.ts`                 | `NotificationCenter`: the items, the unread count and the checks, for the signed-in user  |
| `notification-sources.ts`                | `NotificationSources`: the three reads                                                    |
| `notification-poller.ts`                 | `NotificationPoller`: the interval, the hidden-tab pause and the backoff                  |
| `notification-read-state.ts`             | `NotificationReadState`: what each user has seen, by item, in `localStorage`              |
| `notification-settings.ts`               | The limits, the events listed, the interval's range and the feature toggle's name         |
