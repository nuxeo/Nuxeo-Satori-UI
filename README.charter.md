# Nuxeo Agentic UI — PoC charter
PoC Charter: Agentic AI‑Built Nuxeo Angular UI
1. Overview
This Proof of Concept (PoC) evaluates the feasibility of using agentic AI tooling to generate a functional, deployable Nuxeo Angular UI with zero or near‑zero hand‑written application code authored by a Hyland engineer.
The PoC is time‑boxed to one calendar week and targets a clearly defined MVP feature set (v1.0) focused on core ECM capabilities.
Core Question

How far can agentic AI tooling take us—largely unassisted—in delivering a real‑world, enterprise‑grade Angular UI?

The goal is not perfection, but evidence.

2. Pre‑Requisites
The following must be in place before the PoC begins:
Tooling & Access

✅ Access to Claude Code / Microsoft Copilot (or equivalent agentic AI tooling)
✅ API tokens / credentials for all dependent services
✅ Token usage and cost tracking enabled

Platform & Infrastructure

✅ Access to a running Nuxeo instance for integration and testing
✅ Target Angular project scaffold or starter repository
✅ CI pipeline access (e.g., GitHub Actions) with permission to:

Add or modify workflows
Trigger builds and deployments



Failure to meet these prerequisites risks invalidating PoC outcomes.

3. Scope
Timeframe

Strictly limited to one calendar week

In‑Scope

Use of agentic AI to:

Generate Angular UI code
Integrate with Nuxeo APIs
Align UI with the Satori design system
Integrate the generated codebase into an existing CI pipeline
Produce a build that is deployable to a dev or staging environment



MVP Feature Set

Defined in MVP v1.0 (referenced separately)
Includes only core ECM functionality
Features not explicitly included in v1.0 are out of scope

Out‑of‑Scope

Feature expansion beyond the agreed MVP
Manual refactoring or optimization outside of PoC constraints
Production‑hardening or long‑term maintainability improvements


4. Approach
Role of the Engineer
The Hyland engineer acts as a director and reviewer, not a coder.
Responsibilities include:

Prompting and guiding the agentic AI
Reviewing generated output
Accepting or rejecting changes
Unblocking the agent where:

Credentials
Environment
Access
CI permissions
become an issue


Logging observations throughout the week

Critical Constraint
🚫 No hand‑written application code should be authored by the engineer.
If manual intervention is required to:

Fix broken logic
Correct architecture
Adjust framework usage

…it must be logged explicitly as an obstacle and factored into findings.

5. Outcomes & Measurements
The PoC will produce findings across three dimensions:
1. Functionality

Percentage of MVP v1.0 features completed within one week
Categorization of each feature:

✅ Fully implemented
🟡 Partially implemented
❌ Not reached



2. Obstacles & Constraints
Documented blockers and friction points, including (but not limited to):

Context window limitations
Hallucinated or incorrect APIs
Incorrect Angular or framework assumptions
CI/CD integration friction
Nuxeo‑specific complexity
Any requirement for human intervention

3. Cost
Total cost to produce the UI, including:

AI token / credit consumption
Engineer effort:

Time spent prompting
Reviewing
Unblocking
Debugging AI output




6. Success Criteria
The PoC is considered successful if it produces clear, evidence‑backed answers to:

How much of the MVP was delivered?
What slowed or blocked the AI?
What was the true cost—technical and human—of delivery?

✅ Partial completion is acceptable
✅ Failure data is valuable
✅ Observational clarity outweighs feature completeness
The objective is insight, not output volume.

7. Expected Deliverables
By the end of the week:

A deployable Angular UI (even if incomplete)
CI pipeline integration
A written findings summary covering:

Functionality
Constraints
Cost


A decision‑support artifact answering:

Is agentic AI viable for enterprise UI delivery today—and under what conditions?
