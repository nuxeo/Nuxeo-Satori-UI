# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests or
discussions.** This repository is public, and anything posted there is visible to everyone before
a fix exists.

Report privately through Hyland's official channels instead:

| You are                                   | Report through                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A security researcher or community member | Hyland's Vulnerability Disclosure Program on [HackerOne](https://hackerone.com/hyland_software) |
| A Hyland customer or partner              | The [Hyland Community](https://community.hyland.com/) portal, or your Hyland representative     |

Both routes reach Hyland's application security team. Hyland's certifications, compliance reports
and security documentation are on the [Hyland Trust Center](https://security.hyland.com/).

### What to include

A report we can reproduce gets fixed fastest. Please include:

- the affected component (see [Scope](#scope)) and the commit, branch or package version you tested
- the Nuxeo Server version it was running against, if the issue involves the server
- step-by-step reproduction, with the HTTP requests and responses, screenshots or proof-of-concept
  code that demonstrate it
- the impact as you understand it — what an attacker gains, and what access they need first

Redact credentials and personal data before sending anything.

## Supported versions

Nuxeo Satori UI is in **Beta**. There are no release or maintenance branches yet: fixes land on
`main` and ship from there.

| Version                                                         | Supported |
| --------------------------------------------------------------- | --------- |
| `main` (and the `@nuxeo/satori-platform` package built from it) | Yes       |
| Anything older                                                  | No        |

## Scope

This repository contains:

- the Angular web application and its libraries (`apps/`, `libs/`)
- the `@nuxeo/satori-platform` npm package (`libs/platform`)
- the `nuxeo-agentic-core` Java add-on and the `nuxeo-agentic-ui` marketplace package that deploys
  the UI to a Nuxeo Server

Report issues in these through the channels above. Two things are **out of scope for this
repository**, though the same channels still accept them:

- **Nuxeo Server itself.** Authentication, permissions and every document operation are enforced by
  the server. Hiding an action or route in this UI is not a security control, so a server-side
  permission bypass is a Nuxeo Platform issue, not a UI one.
- **The AI operations** (`AI.*` Automation operations). They are served by a separate marketplace
  package that does not live in this repository.

## How we handle dependency vulnerabilities

**npm dependencies** — the web application, its libraries and `@nuxeo/satori-platform` — are
tracked through Dependabot, and the `supply-chain` gate in `npm run beta:gate` fails on any high or
critical advisory in a production npm dependency. A lower-severity advisory with no available fix
may be accepted for a limited time, with its reason and mitigations recorded in
`.ai/state/supply-chain-allowlist.json`. Each acceptance carries an expiry date, and the gate fails
once that date passes.

**Maven dependencies** of the `nuxeo-agentic-core` add-on are **not** covered by either check. Apart
from test-only JUnit, every one is declared `provided`: Nuxeo Server supplies them at runtime and
the marketplace package does not bundle them, so their advisories are fixed by upgrading Nuxeo Server, not this repository. If
you find a vulnerability in one of them that this add-on makes reachable, report it through the
channels above.
