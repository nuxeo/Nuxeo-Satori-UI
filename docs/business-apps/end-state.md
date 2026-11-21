# The end of phase 9: what we have, and how companies use it

What the [development plan](development-plan.md) delivers by the end of phase 9, and what the app
looks like to each kind of company and to each person in it.

Written on 21 November 2026, before development starts. Use cases are inferred from each group's
industry and are to be confirmed with presales in phase 0. This repository is public, so groups
are named here and accounts are not.

## At the end of phase 9

**The whole product works, and every use-case group can be shown a demo of its own.** It is not
released to customers yet: phase 10 makes it ready for production and publishes it.

- **Five experiences:**
  - the business app shell for staff;
  - the portal for people outside the company, with share links;
  - panels embedded inside other systems;
  - the phone capture app;
  - the Builder: the agent kit and the designer.
- **Eight starter kits:** payers and claims, property and casualty claims, onboarding and
  disputes, brand assets, media assets and rights, controlled documents, case management, and
  records management.
- **The domain modules:** cases, capture and classification, letters, e-signature, assets, media
  rights, document control, records, outside users, integration with systems of record, and AI on
  the record.
- **The server add-ons** behind them, and tenancy for providers that serve many client
  organisations.
- **Studio migration:** both tracks, for the screens and for custom code.
- **Languages:** English, plus Spanish, the Nordic languages and French.

## How a company gets its app

The accounts do not share one app. Each runs the product on its own Nuxeo server.

1. **Its data model stays where it is.** Studio or code defines its types, workflows and
   lifecycles, and nothing is rebuilt.
2. **It installs** the Satori package, the add-ons its apps use, and the starter kit closest to its
   business.
3. **It makes the app its own** with the Builder: its labels, fields, queues, rules, logo and
   colours, kept as its own configuration package. A company already on Web UI migrates its Studio
   screens instead ([migration](studio-migration.md)), and runs both UIs side by side while people
   move.
4. **People sign in to their company's branded app,** and each sees only the apps their groups
   are given. A claims adjuster and a member-services agent in the same company see different
   apps.

## What people see every day

The same shape for every company:

1. **A home** that answers "what do I need to do today?": tasks, deadlines and the queues of their
   group.
2. **A queue.**
3. **A record page** for the business record itself, not a folder of files. For brand and media
   teams, the asset is the record.
4. **A task form**, and buttons that do the real work.
5. **A timeline** of everything that happened to the record.

## By use-case group

| Group                               | What they do in the app                                                                                                                                                                                                                                                                                                                                                            | Where they see it                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Health payers and public health (3) | Adjusters determine claims, supervisors approve the large ones, and appeals specialists work cases against their deadlines. Member services sees protected fields masked. Faxed prior authorisations arrive in an inbox, are classified and matched to the member, and become tasks. Public agencies send notices in several languages and handle public records requests as cases | The shell                             |
| Property and casualty insurance (4) | Claim handlers mostly stay in their core claims system, with a panel inside it showing the claim's documents, photos and actions. In the shell, the claim page shows live policy and payment data beside the documents. Field adjusters photograph damage on a phone. Incoming mail files itself. One insurer works in the Nordic languages                                        | Embedded panels, the shell, the phone |
| Banking (2)                         | An onboarding case with a KYC checklist, documents extracted automatically, an e-signature step, and retention and legal hold enforced by the server. A queue for disputes. One bank works in Spanish                                                                                                                                                                              | The shell, embedded panels            |
| Brand and product DAM (4)           | Brand asset managers see rights about to end and products missing shots. They work a library of assets with renditions, run creative reviews with pins on the picture, share with agencies through watermarked links, and publish to e-commerce. Licensors approve licensed artwork in the portal, and wholesale partners receive share links                                      | The shell, the portal, share links    |
| Media and entertainment (1)         | Everything the brand teams have, plus rights by territory and release window, localised versions, timed notes on film cuts, and deliveries to distributors that are refused outside their window                                                                                                                                                                                   | The shell, the portal                 |
| Engineering document control (2)    | Document controllers keep numbered registers with revisions and supersession. They run review cycles with comment resolution and send transmittals to contractors and suppliers, who answer in the portal. Drawings open in a CAD and BIM viewer, export-control marks are enforced, and the app is in French                                                                      | The shell, the portal                 |
| Operations with outside parties (2) | Vehicle deal jackets with titles, dealers as outside users, and e-signature. Moves with their inventories: drivers photograph damage on a phone, agents work in the portal, and damage claims run as cases                                                                                                                                                                         | The shell, the portal, the phone      |
| Records management (1)              | Records specialists run retention schedules and holds, and disposition runs that need two approvals and produce a certificate. They track physical boxes by barcode and location, run mailroom capture, and keep every client organisation apart on one system                                                                                                                     | The shell, as a multi-tenant provider |
| Not known yet (1)                   | To be confirmed by presales in phase 0                                                                                                                                                                                                                                                                                                                                             | —                                     |

## Who sees what

| Person                                                  | Sees                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Staff                                                   | The shell: their apps, homes, queues and records                             |
| Managers                                                | KPIs and reports, with drill-down                                            |
| Administrators                                          | The designer, the app registry, and the management of outside users          |
| Outside people: licensors, contractors, dealers, agents | Only the portal, and only what was shared with them, until their access ends |
| Anyone given a share link                               | The shared files, watermarked, with no account                               |
| Field staff                                             | The phone app                                                                |
| Presales and IT                                         | The Builder                                                                  |

The classic document functions (browse, collections, trash) stay available as a "Documents" app
for companies that still want them.

## What waits for phase 10

By the end of phase 9, everything above has been proven in demos, on demo servers with fictional
data. Phase 10 is what lets a company run it in production:

- the security reviews of every new surface, closed;
- the accessibility conformance report;
- performance budgets in CI;
- upgrades that keep each company's configuration;
- self-service Studio migration;
- documentation and support playbooks;
- the published packages.

Related: the [development plan](development-plan.md), the [architecture](architecture.md), the
[migration](studio-migration.md), and the [plan's section 13](plan.md).
