# SDLC Conformance Checklist — first pass (Nuxeo Satori UI)

Preparation notes for
[Nuxeo Satori UI - Conformance Checklist](https://hyland.atlassian.net/wiki/spaces/OCE/pages/4047252645)
(SDLC v5.0). **Nothing in Confluence has been changed.**

Contents: the recommended conformance status for each of the 22 "All Offerings" requirements, note
text that can be pasted into the Notes column, and the items that need an owner outside engineering.

The SaaS (13) and Hosted (4) sections are already complete — all Not Applicable. No action there.

## How these recommendations were calibrated

Conforming requires **both**:

- **Condition 1 — Defined Way of Working**: either an established higher-level process owned by
  another team, or a team-specific approach that is documented and accessible.
- **Condition 2 — Demonstrated Execution**: recent examples showing it is actually used in delivery.

Not Conforming explicitly includes _"the team is unable to demonstrate"_. A practice we follow but
cannot evidence is therefore Not Conforming, not Conforming. Exception is reserved for a genuine
structural or technical constraint, which does not apply to anything below.

Where the answer sits outside engineering, the recommendation is Not Conforming or blank rather than
an assumed Green. That is deliberate: an unsupported Green that has to be withdrawn later costs more
credibility than an honest gap with a named owner.

## Context that affects several rows

The requirements already marked Conforming (penetration testing, DAST, SCA, SAST) were assessed
against **existing Nuxeo product** evidence — LTS 2025, the current Web UI, and platform-wide
scanning. The new UI is a distinct deliverable, and for two of those four it is not in the assessed
scope. Rather than change a status the SDLC team has already set, the recommendation is to add a
scope note so the gap is visible and can be planned.

---

## Recommended status by requirement

| ID       | Requirement                                               | Recommended                     | Basis                                                                                         |
| -------- | --------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| SDLC.001 | Accessibility Requirements Definition and Risk Assessment | **Not Conforming**              | Risk Analysis Form, action plan and compliance timeline not completed                         |
| SDLC.002 | Accessibility Exceptions List and Remediation Plan        | **Not Conforming**              | No formal exceptions list; one known defect awaiting disposition                              |
| SDLC.003 | Accessibility Testing Integration                         | **Not Conforming**              | Automated testing established and evidenced; manual/assistive-technology pass not yet defined |
| SDLC.004 | Accessibility Rollback                                    | **Conforming**                  | Regressions are blocked at merge; revert path is standard and validated                       |
| SDLC.005 | Antivirus Scanning                                        | **Not Conforming**              | No scanning step owned by this team; inheritance from the release pipeline unconfirmed        |
| SDLC.006 | Application Penetration Testing                           | _Leave Conforming_ + scope note | New UI not yet penetration tested                                                             |
| SDLC.007 | Classify and Remediate All Security Findings (PD 6.1)     | **Conforming**                  | All identified findings remediated; severity-based acceptance process in place                |
| SDLC.008 | Dynamic Application Security Testing (DAST)               | _Leave Conforming_ + scope note | New UI not separately scanned; coverage needs AppSec confirmation                             |
| SDLC.009 | Software Composition Analysis (SCA)                       | _Leave Conforming_ + note       | Strengthened for the new UI; one configuration discrepancy to resolve                         |
| SDLC.010 | Static Application Security Testing (SAST)                | _Leave Conforming_ + note       | Enabled with no open findings; two scope bounds worth recording                               |
| SDLC.011 | Threat Modeling                                           | **Not Conforming**              | No threat model produced for the new UI                                                       |
| SDLC.016 | Code Reviews                                              | **Conforming**                  | Enforced at merge and additionally reviewed at each delivery milestone                        |
| SDLC.017 | Export Control and Encryption Design Alignment            | **Conforming**                  | No new cryptography introduced; existing assessment process applies                           |
| SDLC.018 | Privacy by Design                                         | **Not Conforming**              | New AI-assisted features introduce data flows outside the existing assessment                 |
| SDLC.019 | AI Use Requirements                                       | **Not Conforming**              | Model approval status not yet confirmed                                                       |
| SDLC.020 | Third Party Software (Including Open Source)              | **Not Conforming**              | New dependency set not yet through licence review                                             |
| SDLC.027 | Incident Response Enablement & Escalation                 | **Not Applicable**              | Not an independently operated service; ships into a customer-managed instance                 |
| SDLC.035 | Encryption Configuration                                  | **Conforming**                  | Transport encryption inherited; no application-managed data at rest                           |
| SDLC.037 | SGRC Engagement                                           | **Not Conforming**              | Reliance on a prior engagement is questionable for a new UI                                   |
| SDLC.038 | Test Planning and Scope Definition                        | **Conforming**                  | Scope, types and depth defined per delivery phase before build completion                     |
| SDLC.039 | Test Case Development and Traceability                    | **Conforming**                  | Per-phase evidence records each check and its result                                          |
| SDLC.040 | Test Execution and Verification Evidence                  | **Conforming**                  | Executed results retained per phase with an automated consistency check                       |

Totals: **8 Conforming**, **4 leave as Conforming with a note**, **9 Not Conforming**,
**1 Not Applicable**.

---

## Note text for the Conforming rows

### SDLC.038 / SDLC.039 / SDLC.040 — Test planning, traceability, execution evidence

These three are currently held at _"insufficient information to support selecting a conforming
status"_. The new UI can supply what is missing, so these are the highest-value rows in this pass.

> Testing for the new UI is governed by an automated verification pipeline of 17 checks, run before
> any delivery phase is signed off. It covers linting, type safety, build integrity, unit tests,
> dependency and vulnerability scanning, static analysis results, public API stability, package
> publishability, upgrade compatibility, and the customer extensibility contract.
>
> Scope and depth are defined per delivery phase in the programme plan before build completion, with
> documented criteria for what must be validated at each stage.
>
> Each phase produces a dated evidence record listing every individual check and its result — between
> 25 and 55 checks per phase across the six phases completed or in progress. An automated consistency
> check re-reads those records and **fails if any phase claims more than its retained evidence
> supports**, so conformance cannot drift from the record. All completed phases have additionally
> been re-verified against the current, larger check set rather than only the one in force when they
> were signed off.
>
> Unit-test coverage is ratcheted so it cannot regress, and is measured on absolute counts so a
> change in the measured surface is visible rather than concealed in a percentage. End-to-end
> coverage comprises 34 automated tests of the critical user journeys, executed across two browser
> engines.
>
> The team's standard is that an automated check is not accepted as evidence until it has been
> observed failing deliberately. Applying that standard has found and corrected several checks that
> reported success while the condition they guarded was untrue.

### SDLC.016 — Code Reviews

> All changes to the default branch require a pull request with an approving review and review by a
> code owner; approvals are dismissed automatically when new commits are pushed. Branch deletion and
> history rewriting are blocked, and automated review, code-quality and code-scanning conditions are
> applied at merge.
>
> In addition to per-change review, the team's documented way of working requires an independent
> adversarial review before any delivery phase is signed off. This has materially changed outcomes:
> the review conducted after the fifth phase identified defects in every preceding phase, and the
> resulting remediation is traceable in the change history.

### SDLC.007 — Classify and Remediate All Security Findings (PD 6.1)

> Static analysis of the new UI currently reports **no open findings**. That reflects completed
> remediation rather than absence of scanning: a backlog of 21 findings, 6 of them high severity, was
> identified and fully remediated. The backlog had accumulated because scanning results were being
> produced but not routinely reviewed; consuming those results is now an explicit condition of phase
> sign-off, and the check fails if it is pointed at a code state that has never been analysed, so a
> clean result cannot be produced by an unscanned target.
>
> Severity handling follows PD 6.1: high and critical findings cannot be accepted and must be fixed;
> medium and low findings require a **dated acceptance that expires**, so an accepted risk cannot
> persist silently.

### SDLC.004 — Accessibility Rollback

> Accessibility regressions are prevented at merge rather than reverted after release: automated
> accessibility scanning runs over 15 application surfaces and states, and any new violation fails
> the build. The list of accepted violations is currently empty. Reverting an accessibility change
> uses the standard pull-request revert path. The mechanism has been validated by deliberately
> reintroducing a previously fixed defect and confirming the check fails.

### SDLC.017 — Export Control and Encryption Design Alignment

> The new UI introduces **no new cryptography**. It is a browser application communicating with the
> Nuxeo platform over HTTPS; encryption methods and key management remain platform responsibilities.
> Credentials are supplied from the environment and are never embedded in source or request URLs.
> The existing Product Encryption Questionnaire process therefore continues to apply.
>
> Recommend Legal confirm the existing assessment covers the new UI.

### SDLC.035 — Encryption Configuration

> The new UI holds no application-managed data at rest. Data in transit is protected by HTTPS to the
> Nuxeo platform, and encryption configuration and key management remain platform responsibilities
> aligned to existing standards.
>
> For completeness of review: the authenticated session is held in browser session storage for the
> lifetime of the tab. Recommend Security confirm this is acceptable for the applicable data
> classification.

---

## Note text for the rows already Conforming

Recommendation is to leave the status as set and add the scope note.

### SDLC.006 — Application Penetration Testing

> **Scope note:** the referenced penetration testing covers Nuxeo LTS 2025 and the existing Web UI.
> The new UI has **not** been penetration tested. It is delivered as an addon served from the Nuxeo
> instance, so part of the attack surface is inherited, but its new client-side surface — the
> configuration model, the extension registry, and the customer extension boundary — has not been
> assessed. Recommend scheduling before general availability.

### SDLC.008 — Dynamic Application Security Testing

> **Scope note:** the referenced DAST results cover Nuxeo 2023 and 2025. The new UI has not been
> separately scanned. As a browser application served from the Nuxeo web container it may already
> fall within an existing scan's scope; recommend AppSec confirm rather than assume.

### SDLC.009 — Software Composition Analysis

> **New UI:** dependency and vulnerability scanning of production dependencies runs automatically on
> every change. High and critical findings in production dependencies cannot be accepted and must be
> resolved; lower-severity findings require a dated acceptance that expires. The same check also
> identifies declared but unused production dependencies, and four were removed as a result.
>
> **Discrepancy to resolve:** the existing note attributes remediation to Dependabot updates.
> Automated **security** updates are currently **disabled** on the UI repository, although scheduled
> version updates are configured. Recommend either enabling security updates or amending the note.

### SDLC.010 — Static Application Security Testing

> **New UI:** static analysis is enabled across all languages used in the repository, including
> workflow definitions, and currently reports no open findings.
>
> Two scope bounds worth recording: the analysis runs the default rule set rather than the extended
> security-and-quality set, so the rule coverage is narrower than the maximum available; and the
> review of results is a condition of phase sign-off rather than of every individual change, because
> analysis completes asynchronously and a per-change gate would fail on findings that the change
> being tested has already fixed.

---

## Not Conforming rows — what closes each one

Each is a genuine gap, and most are small. Listing the closing action makes them plannable.

| ID       | Gap                                                                               | What closes it                                                                                                                                                                                                                              | Likely owner            |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SDLC.001 | Accessibility Risk Analysis Form, action plan and timeline not completed          | Complete the form. Engineering can supply the risk surface: the component inventory, the surfaces the latest `phase-6-a11y` capture scans (14 axe scans over 9 routes on 2026-11-23), and the seven categories of defect already remediated | Product + Accessibility |
| SDLC.002 | No formal accessibility exceptions list                                           | Create the list. One known defect should be its first entry (see SDLC.003)                                                                                                                                                                  | Product + Accessibility |
| SDLC.003 | Manual / assistive-technology testing not defined                                 | Define and run a manual pass. Automated coverage is already established and evidenced                                                                                                                                                       | Engineering + QA        |
| SDLC.005 | No antivirus scanning step owned by this team                                     | Confirm whether the Nuxeo release pipeline scans the produced addon package. If it does, this becomes Conforming via an inherited process                                                                                                   | Build / Release         |
| SDLC.011 | No threat model for the new UI                                                    | Produce one. Security-relevant design decisions are already documented and can seed it                                                                                                                                                      | Engineering + AppSec    |
| SDLC.018 | AI-assisted features introduce data flows outside the existing privacy assessment | Privacy review of those flows                                                                                                                                                                                                               | Privacy                 |
| SDLC.019 | Model approval status not confirmed                                               | Confirm the models in use are whitelisted or AI-council approved. Engineering can supply the full inventory of AI-assisted features and the calls they make                                                                                 | Product + AI Council    |
| SDLC.020 | New third-party dependency set not through licence review                         | Licence review. Engineering can supply the complete dependency inventory, including components sourced from private Hyland registries                                                                                                       | OSS / Legal             |
| SDLC.037 | Prior SGRC engagement relied upon as a "minor change"                             | SGRC decision on whether a new UI with a new customer-facing extensibility contract qualifies                                                                                                                                               | SGRC                    |

## Not Applicable row

**SDLC.027 — Incident Response Enablement & Escalation.** The new UI is not an independently
operated service. It is delivered as an addon into a customer-managed Nuxeo instance, so on-call
coverage, service models and incident routing sit with the platform and the customer. This is
consistent with the SaaS section being Not Applicable throughout. Recommend Operations confirm.

---

## Two judgement calls to make at the sync, not in the page

**SDLC.003** is the closest call. Automated accessibility testing is genuinely established, scanned
across 15 surfaces with no outstanding violations, and evidenced. It is marked Not Conforming only
because the requirement asks for a **manual and automated** approach and no manual pass is defined.
Defining one converts this to Conforming with no further engineering work.

One bound should be stated whichever way it goes: automated tooling inspects rendered structure and
**cannot detect interaction-time failures**. A keyboard-navigation defect was found by manual
inspection that the automated scan passes — a dialog that does not move focus to itself when opened,
leaving keyboard users outside it. The accurate claim is therefore conformance **against
automatically detectable criteria**, not full AA conformance.

**SDLC.006 and SDLC.008** are marked to keep their existing Conforming status because the platform
evidence is real and the SDLC team set those statuses against team-level evidence. If the checklist
is read strictly as _this team's product_, Conforming is harder to defend for a UI that has not been
tested. Worth agreeing the reading before submission.
