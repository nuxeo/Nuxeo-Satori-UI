# Telemetry: a design, for a decision

Phase 10 of the [development plan](development-plan.md) builds "telemetry and the diagnostics page".
The diagnostics page is built ([administrator-guide.md](administrator-guide.md), "The diagnostics
page"). This page is the telemetry half, and it is **a design only: no code in this repository
sends anything anywhere.** It proposes what telemetry would be, if it is wanted, and lists what has
to be decided first. It is open decision T in the [decision log](decisions.md).

Status, 27 November 2026: proposed, not decided, not built.

## The short version

- **Off by default, and opt-in.** Nothing is sent until a customer's administrator switches it on,
  on the server, and names where it goes. A server that has set nothing sends nothing, ever.
- **To the customer's own collector.** An OpenTelemetry collector the customer runs, at an address
  the customer sets. Never to Hyland's, unless a contract says so, and then only to the address
  that contract names.
- **No personal data and no document content.** No name, address, group, record, title, path,
  search, query, property value or file. What would be sent is a closed list of fields, below, and
  the server drops anything that is not on it.
- **Sent by the server, not the browser.** The browser would report to its own server, which checks
  each report against the list, aggregates it and forwards it. The browser talks to no other host.
- **What needs deciding** is listed at the end: whether at all, the field list, the protocol, who
  may switch it on, and the privacy and security reviews before anything is built.

## Why a customer might want it

Support today reads what an administrator copies from the diagnostics page. That answers "what is
installed and what is wrong now". It does not answer "since when", "on how many servers" or "is it
slower than last month". A customer who runs many servers, or a partner who runs them for
customers, would see that from their own collector, in their own monitoring, next to the server's
other metrics, and could share it with support when they choose.

## What it would collect

Three kinds of fact, each a field of a closed list. Anything not on the list is dropped by the
server before it is forwarded, and the drop is counted.

**1. The installation, once a day.** The facts of the diagnostics page's "copy for support" text,
without its free text:

| Field                              | Example                         | Why                                         |
| ---------------------------------- | ------------------------------- | ------------------------------------------- |
| `installation.id`                  | a random UUID                   | To tell one server's reports from another's |
| `platform.version`                 | `2025.10.18`                    | Upgrades, and what to test against          |
| `app.version`, `app.core`          | `2026.0.2`                      | The same                                    |
| `package.<name>.version`           | `payers-claims-demo` at `0.7.0` | Which kits and add-ons are in use           |
| `check.<id>`                       | `retention: absent`             | Which server checks fail where              |
| `configuration.diagnostics.<code>` | `invalid-json: 2`               | Which configuration errors are common       |

The installation id is made by the server when telemetry is first switched on, kept in its data
directory, and replaced whenever the administrator asks. It is not the server's name, address or
license, and is derived from none of them. The messages of the configuration's errors are not sent,
only their codes and how many: a message may name a file a customer wrote.

**2. Performance, aggregated each hour.** The same measures as the
[CI budgets](performance-budgets-ci.md), from real browsers:

| Field                                    | Example                    | Why                                      |
| ---------------------------------------- | -------------------------- | ---------------------------------------- |
| `page.<kind>.firstRender` as a histogram | `queue`: p50 1.7 s, p75 …  | Whether the app is fast where it is used |
| `chunk.loadFailures`                     | `3`                        | A deployment whose proxy breaks the app  |
| `client.errors.<code>`                   | `NG0201: 1`                | Errors that reach the console            |
| `client.browser`, by family and major    | `Chromium 153`             | What to support and test                 |
| `client.viewport`, in three buckets      | `narrow`, `medium`, `wide` | Whether phones are used                  |

A page's kind is one of a fixed few: `home`, `queue`, `record`, `search`, `browse`, `admin`. Never
the queue's id, the record's type or the address: a queue's id may name a customer's process. The
histogram's buckets are fixed, so no single person's time can be read from it.

**3. Use of each feature, counted each hour.** How many times each route kind was opened and each
registered action run, by its registered id (`app.rowActions.download`), not by a customer's own
ids, which may name their business. No count below five is sent: it is rounded to zero, so that a
rare action cannot point at a person.

**Never collected**, whatever a future field might want: a user's name, id, email, group or role;
an IP address (the collector is told not to log it, and the server forwards without it); a
document's id, title, path, type name, property value, file or rendition; a search's text, an NXQL
query, a page provider's parameter; a layout's, queue's or home's content; the server's host name
or URL; a token, a key, a cookie or a header.

## Where it would go

```text
browser ──(same origin, after sign-in)──▶ nuxeo-agentic-core ──(OTLP over HTTPS)──▶ the customer's collector
```

- **The browser reports to its own server**, at an address below the app registry's, after
  sign-in, with no third-party host in its content security policy. It sends only the
  performance and use fields, and only while the server says telemetry is on.
- **The server checks each report against the closed list**, drops the rest, aggregates it with
  the others for the hour, adds the installation's facts once a day, and forwards it as
  OpenTelemetry metrics, OTLP over HTTPS, to the collector the administrator set. One report a
  browser sends cannot reach the collector alone: it is always aggregated first.
- **The collector is the customer's,** an OpenTelemetry collector they run, or a vendor's they
  already use for their monitoring, at an `https` address with no user, query or fragment, and a
  credential of its own in the server's properties, as the connectors' are
  ([administrator-guide.md](administrator-guide.md), "The properties").
- **Hyland's collector, never without a contract.** No address of Hyland's is in any default, any
  package or any code. A customer who wants Hyland to see their telemetry, for a support contract,
  sets Hyland's address themselves, under that contract and its data processing agreement.

What the switches would be, all unset and so off by default:

| Property                                | Default | What it would do                                                                 |
| --------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `nuxeo.agentic.ui.telemetry.enabled`    | Off     | On only when `true` and an address is set                                        |
| `nuxeo.agentic.ui.telemetry.endpoint`   | Unset   | The collector's OTLP over HTTPS address                                          |
| `nuxeo.agentic.ui.telemetry.credential` | Unset   | Sent in one header the collector names; never logged                             |
| `nuxeo.agentic.ui.telemetry.browser`    | Off     | Whether browsers report performance and use, or only the server's facts are sent |

The diagnostics page would show whether telemetry is on, where it goes by host only, and when it
last sent, so an administrator can see it without reading the properties.

## What it would not do

- It would not change what the app does: a collector that is down, slow or refusing costs the
  person nothing, and the server keeps at most a day of aggregates before it drops them.
- It would not be a way to switch features on or off, or to update anything.
- It would not be needed for support: the diagnostics page's text stays the way to send support
  what it needs, by hand, when the administrator chooses.

## What needs a decision

Before anything is built, by the owners decision T names:

1. **Whether the app has telemetry at all.** The recommendation is yes, opt-in and off by default,
   as above, because a customer or partner running many servers has no other way to watch them;
   "no" is a coherent answer, and the diagnostics page stands without it.
2. **The closed list of fields.** The three tables above are a proposal. Each field added later is
   a change to the list, reviewed as this one would be.
3. **The protocol.** OTLP, so that any customer's monitoring reads it, against a JSON report of our
   own, which would be simpler to check and that no tool reads.
4. **The browser's part.** Whether browsers report at all (`telemetry.browser`), or only the
   server's own facts are sent, which removes the performance and use fields.
5. **Who may switch it on.** The recommendation is the server's properties only, so an
   administrator of the server and not of the app, with no switch in the app's own screens.
6. **The privacy review.** Whether the installation id, the hourly counts and the rounding of small
   counts are enough for data protection law where customers run, with legal.
7. **The security review,** with the others ([security-reviews.md](security-reviews.md)): the
   relay's address, its checking against the list, and the credential.
8. **Hyland's own collector,** if Hyland wants one for support contracts: its contract, its data
   processing agreement and where it runs.
