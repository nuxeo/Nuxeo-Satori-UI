# AI Features

## Status: disabled for every user

All `AI.*` features are switched **off**, for all users, with no runtime way to turn them back
on. The single switch is `AI_FEATURES_ENABLED` in
`libs/shared/ai-client/src/lib/ai-feature-flag.service.ts`; setting it to `true` and restoring
the commented-out Settings menu entry in `app-shell.component.html` is the whole of re-enabling.

None of the feature code was removed — components, templates, gateway methods and their tests
are all intact. What changed is only reachability:

- `AiFeatureFlagService.aiEnabled` is a constant read-only signal, not a read of `localStorage`.
  Storage is user-writable, so while the flag was derived from it anyone could re-enable the whole
  surface from devtools. The two stored keys are purged on construction, so a browser that had
  opted in before is cleared.
- `setEnabled()` and `toggle()` are retained for call-site compatibility and are inert.
- `AiGatewayService` refuses to issue a request while the flag is off, so a component that forgets
  to check cannot put AI traffic on the wire. This matters: two callers were found issuing AI
  requests from `ngOnInit` while their templates were correctly hidden.

A deployment manifest can still un-gate `app.tabs.aiInsights`, since `app.rules.isAiEnabled` is a
Layer 1 rule. That surfaces an empty tab and nothing more — the gateway still sends nothing.

The sections below describe the feature set as built, and apply when it is re-enabled.

## Overview

AI features are served by **Nuxeo Automation operations**, provided by a Java marketplace
package deployed into the Nuxeo server. That package calls the Hyland AI Platform (HAIP)
Model Gateway, an OpenAI-compatible API.

**The AI backend does not live in this repository.** An earlier iteration used a Node.js
Express service at `apps/ai-backend/`; that has been moved to its own repository and now
ships as a Nuxeo marketplace package. This repo contains only the Angular client.

Consequences to keep in mind:

- There is nothing to start locally. If the marketplace package is not installed on the
  Nuxeo instance you are pointed at, every AI call returns **HTTP 500** and the AI panels
  fail. That is expected, not a client defect.
- There is no `/ai/*` HTTP surface any more, and no port 3000.
- HAIP credentials are configured on the Nuxeo server, never in this repo.

---

## How calls are made

The client posts to the Nuxeo Automation API on the same origin as Nuxeo:

```
POST {AI_BACKEND_URL}/api/v1/automation/{OperationId}
Body: { "params": { ... } }
```

`AI_BACKEND_URL` is an `InjectionToken` (`libs/shared/ai-client/src/lib/ai.config.ts`),
provided as `'/nuxeo'` in `apps/nuxeo-ui/src/app/app.config.ts`. URL construction lives in
`AiGatewayService.op()` (`libs/shared/ai-client/src/lib/ai-gateway.service.ts`).

## Automation operations

| Operation           | Purpose                                |
| ------------------- | -------------------------------------- |
| `AI.NlToNxql`       | Convert natural language to NXQL       |
| `AI.Summarize`      | Generate a document summary            |
| `AI.SuggestTags`    | Suggest tags for a document            |
| `AI.Classify`       | Classify document type and category    |
| `AI.Similar`        | Find similar documents                 |
| `AI.Chat`           | RAG conversational assistant           |
| `AI.Insights`       | Dashboard insight cards                |
| `AI.Anomalies`      | Audit log anomaly detection            |
| `AI.Sentiment`      | Comment and document sentiment         |
| `AI.NlPermissions`  | Natural language ACL queries           |
| `AI.AuditSummarize` | Summarise a set of audit events        |
| `AI.AuditNlFilter`  | Natural language filter over the audit |

---

## Feature Flag System

AI features are gated behind a single feature flag, currently **off for everyone** and not
toggleable at runtime (see "Status" above). It was previously on by default with a
`localStorage`-persisted opt-out, and the header menu entry that toggled it is commented out.

Keep the UI gate on every AI surface regardless — it is what the kill switch acts through, and
never hardcode HAIP credentials.

```typescript
// Service: libs/shared/ai-client/src/lib/ai-feature-flag.service.ts
const AI_FEATURES_ENABLED = false;                      // the switch
readonly aiEnabled: Signal<boolean> = this.state.asReadonly();  // read-only on purpose

// In templates
@if (aiFeatureFlag.aiEnabled()) {
  <app-ai-insights-panel />
}
```

---

## Angular AI Client

```typescript
// Service: libs/shared/ai-client/src/lib/ai.service.ts
// Import: @agentic-ui/shared/ai-client

summarize(content: string, title: string): Observable<string>
suggestTags(content: string, existingTags: string[]): Observable<string[]>
classify(content: string, title: string): Observable<string>
nlToNxql(query: string): Observable<string>
getInsights(recentDocs: NuxeoDocument[]): Observable<AiInsight[]>
detectAnomalies(auditEvents: AuditEvent[]): Observable<AiAnomaly[]>
```

---

## Adding a New AI Feature

The operation itself is implemented in the separate AI package repository, not here. On this
side:

1. Add a method to `AiGatewayService` calling `this.op('AI.<NewOperation>')`.
2. Add the typed response model in `libs/shared/ai-client/src/lib/models/`.
3. Expose it through `libs/shared/ai-client/src/lib/ai.service.ts`.
4. Gate the UI behind `@if (aiFeatureFlag.aiEnabled())`.
5. Handle the failure path — assume the operation may be absent on a given server.
6. Update this file and `docs/ai-features.md`.

---

## Local Development

Nothing to start. Point the app at a Nuxeo instance that has the AI marketplace package
installed:

```bash
npx nx serve nuxeo-ui
```

If your local Nuxeo does not have the package, AI calls return 500 and the rest of the
application is unaffected. Verify with:

```bash
curl -u Administrator:Administrator -X POST \
  -H "Content-Type: application/json" -d '{"params":{}}' \
  http://localhost:8080/nuxeo/api/v1/automation/AI.Insights
```
