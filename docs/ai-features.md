# AI Features

This document describes the AI capabilities integrated into the Nuxeo Angular UI.

> **The AI backend is not in this repository.** An earlier iteration used a Node.js Express
> service at `apps/ai-backend/`. That has moved to its own repository and now ships as a
> **Nuxeo marketplace package** exposing Automation operations. This repo contains only the
> Angular client, `libs/shared/ai-client`.
>
> If the marketplace package is not installed on the Nuxeo instance you are pointed at,
> every AI call returns **HTTP 500** and the AI panels fail. That is expected, and the rest
> of the application is unaffected.

Knowledge Enrichment follows the same shape but through a different package: the Nuxeo
server and the Hyland Content Intelligence Connector (CIC).

## Architecture

```
AI features
┌──────────────┐                     ┌────────────────────┐        ┌──────────┐
│  nuxeo-ui    │                     │  Nuxeo Server      │        │  HAIP    │
│  :4200 dev   │─ POST /nuxeo/api/  ▶│  AI.* automation   │──────▶ │  Model   │
│  libs/shared │  v1/automation/AI.* │  (marketplace pkg) │        │  Gateway │
│  /ai-client  │                     │  :8080             │        └──────────┘
└──────────────┘                     └────────────────────┘

Knowledge Enrichment
┌──────────────┐          ┌──────────────────┐        ┌────────────────┐
│  nuxeo-ui    │─────────▶│  Nuxeo Server    │──────▶ │  CIC / Context │
│  libs/shared │ multipart│  automation ops  │        │  API           │
│  /ke-client  │ blob     │  HylandKE.*      │        └────────────────┘
└──────────────┘          └──────────────────┘
```

**Key design decisions:**

- No model credentials reach the browser. HAIP configuration lives on the Nuxeo server.
- AI calls are ordinary Nuxeo Automation requests, so they reuse the existing auth
  interceptor and are same-origin in production — there is no separate `/ai/*` surface and
  no CORS configuration to maintain.
- The server-side operation builds LLM context (document content, metadata, audit) itself.
- Treat AI responses as untrusted content: render through template binding, never
  `innerHTML`.

## Quick Start

Nothing to start locally beyond the app. Point it at a Nuxeo instance that has the AI
marketplace package installed:

```bash
npm run dev                # http://localhost:4200
```

Verify the operations are available on your Nuxeo instance:

```bash
curl -u Administrator:Administrator -X POST \
  -H "Content-Type: application/json" -d '{"params":{}}' \
  http://localhost:8080/nuxeo/api/v1/automation/AI.Insights
```

A 404 or 500 means the package is not installed on that server.

## Features

### 1. Natural Language Search

**Location:** Search page (toggle "AI Search" button)

Converts plain English queries into valid NXQL and executes them against Nuxeo.

- Type a query like "PDFs uploaded last week by Administrator"
- The system generates and displays the NXQL query
- Results appear in the standard grid/table/list views
- Autocomplete suggestions appear as you type (debounced, uses gpt-4o-mini)

**Also available in:** Admin > NXQL Search page as a "Generate NXQL" input that populates the query editor.

| Component        | File                                                           |
| ---------------- | -------------------------------------------------------------- |
| Search UI        | `libs/features/search/src/lib/search/search.ts`                |
| Admin NXQL       | `libs/features/administration/src/lib/admin-nxql-search-page/` |
| Client call      | `AiGatewayService.nlToNxql()`                                  |
| Server operation | `AI.NlToNxql` — implemented in the AI package repo             |

**API:** `POST /nuxeo/api/v1/automation/AI.NlToNxql`

```json
{ "query": "all PDFs modified this month", "suggestions": false }
→ { "nxql": "SELECT * FROM Document WHERE ...", "explanation": "..." }
```

---

### 2. Document Summarization

**Location:** Document Detail > AI Insights tab > Document Summary

Generates a structured summary of any document by reading its blob content and metadata.

- Click "Generate" to create a summary
- Returns a paragraph summary + bullet-point key points
- Handles text and JSON blobs; reports binary content gracefully

| Component          | File                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| Document Detail UI | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| Server operation   | `AI.Summarize` — implemented in the AI package repo                        |

**API:** `POST /nuxeo/api/v1/automation/AI.Summarize`

```json
{ "docId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
→ { "summary": "...", "keyPoints": ["...", "..."], "wordCount": 1234 }
```

---

### 3. AI Tag Suggestions

**Location:** Document Detail > AI Insights tab > Suggested Tags

Analyzes document content and metadata to recommend relevant tags with confidence scores.

- Click "Suggest Tags" to generate recommendations
- Each tag shows a confidence percentage
- Click a tag chip to apply it to the document immediately (uses `TagService.addTag`)

| Component          | File                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| Document Detail UI | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| Server operation   | `AI.SuggestTags` — implemented in the AI package repo                      |

**API:** `POST /nuxeo/api/v1/automation/AI.SuggestTags`

```json
{ "docId": "..." }
→ { "tags": [{ "label": "contract", "confidence": 0.95 }, ...] }
```

---

### 4. Document Classification

**Location:** Document Detail > AI Insights tab > Classification & Metadata

Classifies document content and suggests metadata values including description, nature, subjects, and workflow recommendation.

- Click "Classify" to analyze
- Displays suggested description, nature category, subjects, and recommended workflow with reasoning

| Component          | File                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| Document Detail UI | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| Server operation   | `AI.Classify` — implemented in the AI package repo                         |

**API:** `POST /nuxeo/api/v1/automation/AI.Classify`

```json
{ "docId": "..." }
→ { "description": "...", "nature": "report", "subjects": ["finance"],
    "suggestedType": "File", "confidence": 0.85,
    "suggestedWorkflow": "SerialDocumentReview", "workflowReason": "..." }
```

---

### 5. Similar Documents

**Location:** Document Detail > AI Insights tab > Related Documents

Finds documents related to the current one using a combination of LLM-generated search queries and OpenAI text embeddings with cosine similarity scoring.

- Click "Find Similar" to discover related documents
- Results show title, path, and relevance score
- Click any result to navigate to that document

| Component          | File                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| Document Detail UI | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| Server operation   | `AI.Similar` — implemented in the AI package repo                          |

**API:** `POST /nuxeo/api/v1/automation/AI.Similar`

```json
{ "docId": "...", "limit": 5 }
→ { "documents": [{ "uid": "...", "title": "...", "path": "...", "type": "File", "score": 0.87 }] }
```

---

### 6. AI Chat Assistant

**Location:** App header sparkle icon (top-right) opens a chat drawer

A context-aware conversational assistant that can answer questions about documents, search the repository, and provide workflow guidance.

- Uses RAG (Retrieval-Augmented Generation): detects search intent, queries Nuxeo, and includes results as context
- Context-aware: knows which document/page you are currently viewing
- Shows source document citations as clickable chips
- Welcome screen with starter suggestion prompts

| Component          | File                                                 |
| ------------------ | ---------------------------------------------------- |
| Chat drawer UI     | `apps/nuxeo-ui/src/app/shell/app-shell.component.ts` |
| Chat state service | `libs/shared/ai-client/src/lib/ai-chat.service.ts`   |
| Server operation   | `AI.Chat` — implemented in the AI package repo       |

**API:** `POST /nuxeo/api/v1/automation/AI.Chat`

```json
{ "message": "What documents were modified today?",
  "history": [...],
  "context": { "docId": "...", "page": "/search" } }
→ { "reply": "...", "sources": [{ "uid": "...", "title": "...", "path": "..." }] }
```

---

### 7. Dashboard AI Insights

**Location:** Dashboard page > AI Insights widget

Generates personalized, actionable insights based on the user's pending tasks, recent documents, and repository activity.

- Loads automatically when the dashboard opens
- Each insight has an icon, priority level, and a link to the relevant page
- Priority levels: high (red), medium (orange), low (green)

| Component        | File                                                          |
| ---------------- | ------------------------------------------------------------- |
| Dashboard UI     | `apps/nuxeo-ui/src/app/dashboard/dashboard-page.component.ts` |
| Server operation | `AI.Insights` — implemented in the AI package repo            |

**API:** `POST /nuxeo/api/v1/automation/AI.Insights`

```json
{ "userId": "Administrator" }
→ { "insights": [{ "text": "...", "icon": "task", "link": "/tasks", "priority": "high" }] }
```

---

### 8. Audit Anomaly Detection

**Location:** Admin > Analytics > AI Audit Anomalies tab

Analyzes recent audit events using AI to detect unusual patterns such as bulk deletions, permission escalations, or mass downloads.

- Select a time range (24h, 7d, 30d)
- Click "Scan for Anomalies"
- Displays a summary assessment and individual anomaly cards with severity levels

| Component        | File                                                         |
| ---------------- | ------------------------------------------------------------ |
| Analytics UI     | `libs/features/administration/src/lib/admin-analytics-page/` |
| Server operation | `AI.Anomalies` — implemented in the AI package repo          |

**API:** `POST /nuxeo/api/v1/automation/AI.Anomalies`

```json
{ "timeRange": "24h" }
→ { "anomalies": [{ "description": "...", "severity": "high", "events": [...], "timestamp": "..." }],
    "summary": "..." }
```

---

### 9. Comment Sentiment Analysis

**Location:** Available via API (UI integration pending)

Analyzes comment threads on documents to determine sentiment and provide a discussion summary.

| Component        | File                                    |
| ---------------- | --------------------------------------- |
| Server operation | `AI.Sentiment` — in the AI package repo |

**API:** `POST /nuxeo/api/v1/automation/AI.Sentiment`

```json
{ "comments": [{ "id": "c1", "text": "Looks great!" }] }
→ { "sentiments": [{ "id": "c1", "sentiment": "positive", "summary": "..." }],
    "threadSummary": "..." }
```

---

### 10. Natural Language Permission Queries

**Location:** Available via API (UI integration pending)

Answers natural language questions about document permissions by querying Nuxeo ACLs.

| Component        | File                                        |
| ---------------- | ------------------------------------------- |
| Server operation | `AI.NlPermissions` — in the AI package repo |

**API:** `POST /nuxeo/api/v1/automation/AI.NlPermissions`

```json
{ "query": "Who can edit documents in /default-domain/workspaces/Legal?" }
→ { "answer": "...", "results": [{ "principal": "jdoe", "permission": "ReadWrite", "path": "/..." }] }
```

---

### 11. Knowledge Enrichment

**Location:** Document Detail > document preview header (top-right KE action buttons)

Knowledge Enrichment runs through the Hyland Content Intelligence Connector
installed on Nuxeo. It does not use the OpenAI backend in this repo.

- PDF actions:
  - classify document
  - extract named entities
  - summarize document
- Image action:
  - describe image and extract image entities
- Results are persisted back into Nuxeo metadata and refreshed in the properties panel

| Component / Service   | File                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| Document Detail UI    | `libs/features/document-detail/src/lib/document-detail/document-detail.ts` |
| KE shared client      | `libs/shared/ke-client/src/lib/ke-client.service.ts`                       |
| KE config + models    | `libs/shared/ke-client/src/lib/`                                           |
| Nuxeo/CIC setup guide | `docs/knowledge-enrichment.md`                                             |

**API:** `POST /nuxeo/site/automation/HylandKnowledgeEnrichment.Enrich`

The client first downloads the current blob from Nuxeo, then posts a multipart
automation request:

```json
{
  "params": {
    "actions": "textClassification",
    "sourceId": "document-uuid",
    "classes": "[\"Contract\",\"Invoice\",\"Legal\",\"Technical\"]"
  }
}
```

The normalized result contains Context API outputs such as:

```json
{
  "textClassification": { "isSuccess": true, "result": "Contract" },
  "textSummary": { "isSuccess": true, "result": "Short summary..." },
  "namedEntityText": {
    "isSuccess": true,
    "result": { "ORGANIZATION": ["Hyland"] }
  }
}
```

**Metadata mapping:**

- `text-classification` -> `dc:nature`
- `named-entity-recognition-text` -> `nxtag:tags`
- `text-summarization` -> `dc:description`
- `image-description` + `named-entity-recognition-image` -> `dc:description`, `nxtag:tags`

---

## Project Structure

Only the client lives in this repository. The `AI.*` automation operations, their prompts,
model selection and HAIP client are in the separate AI package repository.

```
libs/shared/ai-client/              # Angular library for AI integration
  src/
    index.ts                        # Public API barrel
    lib/
      ai.config.ts                  # AI_BACKEND_URL InjectionToken (provided as '/nuxeo')
      ai-gateway.service.ts         # Posts to /api/v1/automation/AI.* for every feature
      ai-chat.service.ts            # Signal-based chat conversation state
      ai.models.ts                  # TypeScript interfaces for all request/response types
libs/shared/ke-client/              # Angular library for KE via Nuxeo CIC
  src/
    index.ts                        # Public API barrel
    lib/
      ke.config.ts                  # KE_CIC_OPERATIONS InjectionToken
      ke-client.service.ts          # Multipart browser -> Nuxeo -> CIC client
      ke.models.ts                  # Context API request/response models
```

## Models Used

Model selection is made by the AI package on the server, not by this client. The table below
records the intent behind each feature and may drift from the package's current configuration
— treat the package repository as authoritative.

| Feature            | Model                                | Reason                                              |
| ------------------ | ------------------------------------ | --------------------------------------------------- |
| NL-to-NXQL         | gpt-4o                               | Needs strong reasoning for query generation         |
| Search suggestions | gpt-4o-mini                          | Fast autocomplete, low cost                         |
| Summarization      | gpt-4o                               | Long-context document handling                      |
| Tag suggestions    | gpt-4o-mini                          | Simple classification task                          |
| Classification     | gpt-4o-mini                          | Metadata suggestion                                 |
| Similar documents  | text-embedding-3-small + gpt-4o-mini | Embeddings for similarity, LLM for query generation |
| Chat (RAG)         | gpt-4o                               | Complex multi-step reasoning                        |
| Sentiment          | gpt-4o-mini                          | Simple sentiment classification                     |
| Insights           | gpt-4o-mini                          | Lightweight summary generation                      |
| Anomaly detection  | gpt-4o                               | Security analysis needs strong reasoning            |
| NL permissions     | gpt-4o                               | Complex ACL interpretation                          |

## Configuration

This repository has no AI environment variables. Model credentials and HAIP settings are
configured on the Nuxeo server by the AI marketplace package.

The only client-side setting is the `AI_BACKEND_URL` injection token, provided as `'/nuxeo'`
in `apps/nuxeo-ui/src/app/app.config.ts`. Override it only if the automation API is served
from a different origin.

## Deployment

Because AI calls are ordinary Nuxeo Automation requests, deployment needs nothing beyond the
usual same-origin setup: the Angular build is served from `/nuxeo/agentic-ui/` and posts to
`/nuxeo/api/v1/automation/AI.*` on the same host. There is no separate service to route, no
reverse-proxy rule for `/ai/*`, and no CORS configuration.

The prerequisite is that the **AI marketplace package is installed** on the target Nuxeo
instance. Without it the application runs normally and only the AI panels fail, returning
HTTP 500.
