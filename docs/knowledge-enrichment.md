# Knowledge Enrichment

Knowledge Enrichment (KE) in this repo runs through **`AgenticKnowledgeEnrichment.Enrich`**, a Nuxeo automation operation in `nuxeo-agentic-core`. The operation calls the **Hyland CIC Java SDK** (`org.hyland.sdk:cic-ke`), which handles the token request and the Context API calls. The Angular app does not call a separate backend for KE. Instead, it:

1. fetches the current document blob from Nuxeo
2. posts that blob to `AgenticKnowledgeEnrichment.Enrich`
3. the operation calls the CIC Java SDK, which authenticates and calls the Context API
4. writes the returned enrichment back into Nuxeo metadata

The Hyland Content Intelligence Connector is no longer on the KE path. It is still installed for Knowledge Discovery and Ingest.

## Supported UI flows

The document detail page exposes KE actions in the top-right header area of the document preview. The text actions show for the document types listed under "Document types" below. The image action shows for images.

### Document types

The text actions (classify, extract entities, summarize) show for the MIME types in `KE_TEXT_MIME_TYPES` in `document-detail.ts`: PDF, Word, PowerPoint, Excel, RTF, OpenDocument text, presentation and spreadsheet, plain text, HTML, Markdown and CSV. The SDK accepts all Data Curation formats, but Hyland publishes no list, so this set is a guess and has not been tested for each type. Video and audio show no KE buttons.

The image action shows for any `image/*` MIME type or a picture document. A Note has no file, so it shows no KE buttons.

### Classification (PDF and other text types)

- `text-classification` -> persisted to `dc:nature` and shown as `Document Category`
  - Candidate classes are loaded live from the Nuxeo `nature` vocabulary
    (`DirectoryService.getEntries('nature')`) — never hardcoded. This guarantees
    the value the LLM picks is a real vocabulary id, so writing it back does not
    fail validation.
  - Two LLM outputs are explicitly rejected before any write to `dc:nature`:
    - the sentinel string `not_from_provided_classes` (returned when no class
      matched) — surfaced to the user as "could not match this document"
    - any value that is not present in the loaded vocabulary (id or display
      label, case-insensitive) — surfaced as "X is not in the document nature
      vocabulary"
  - Without these guards Nuxeo rejects the PUT with `HTTP 422 Unprocessable Entity` and the document silently stays out of sync with the displayed UI.
- `named-entity-recognition-text` -> persisted to `nxtag:tags`
- `text-summarization` -> persisted to `dc:description`

### Image

- `imageDescription` + `namedEntityRecognitionImage` run together from one action
- description is persisted to `dc:description`
- image entities are persisted to `nxtag:tags`. If the Context API finds no entities, the tags are empty and no error is shown, so a successful call can save only the description.

This mapping follows the KE end-user guide linked from `NXSAT-143` and keeps the results visible in the existing properties panel without introducing CSX components.

## Integration boundary

Shared client: `@agentic-ui/shared/ke-client`

Automation op:

- `AgenticKnowledgeEnrichment.Enrich`, registered in `nuxeo-agentic-core` (`OSGI-INF/knowledge-enrichment-operation-contrib.xml`)
- Implemented by `KnowledgeEnrichmentOperation.java`, which calls `KEService.enrich` from `org.hyland.sdk:cic-ke` 1.1.0
- Client credentials and environment come from `nuxeo.hyland.cic.*` properties; see "Required Nuxeo config" below

The op accepts multipart input:

- a JSON part named `request`
- a blob part named `input`

Requests that fail in the Context API return HTTP 500 from Nuxeo with the Context API's status and reason in the message, for example `Knowledge Enrichment failed: HTTP 400: ...`. The operation maps `maxWordCount` only to `textSummarization`, because the image actions reject it.

The connector's ops (`HylandKnowledgeEnrichment.*`) are no longer called by the app. They remain installed for Knowledge Discovery and Ingest.

## Request shape

The shared client posts multipart form data to:

```text
/nuxeo/site/automation/AgenticKnowledgeEnrichment.Enrich
```

The `request` part contains:

```json
{
  "params": {
    "actions": "textClassification,textSummarization",
    "sourceId": "document-uuid",
    "classes": "[\"Contract\",\"Invoice\",\"Legal\"]",
    "extraJsonPayloadStr": "{\"maxWordCount\":150}"
  }
}
```

## Response shape

The public Context API OpenAPI file documents the canonical KE response model as:

```json
{
  "id": "processing-id",
  "status": "Complete",
  "inProgress": false,
  "results": [
    {
      "objectKey": "documents/123/file.pdf",
      "textSummary": { "isSuccess": true, "result": "..." },
      "textClassification": { "isSuccess": true, "result": "Contract" },
      "namedEntityText": {
        "isSuccess": true,
        "result": {
          "ORGANIZATION": ["Hyland"],
          "PERSON": ["Jane Doe"]
        }
      },
      "imageDescription": { "isSuccess": true, "result": "..." },
      "namedEntityImage": {
        "isSuccess": true,
        "result": {
          "LOCATION": ["Cleveland"]
        }
      }
    }
  ]
}
```

Some connector builds may also wrap that in a generic:

```json
{
  "response": { "...": "..." },
  "responseCode": 200,
  "responseMessage": "OK"
}
```

`KeClientService` tolerates both forms.

## Required Nuxeo config

`AgenticKnowledgeEnrichment.Enrich` reads these properties. The SDK requests a token from `nuxeo.hyland.cic.auth.baseUrl` with `/connect/token` appended, using the grant type and scope below:

```conf
nuxeo.hyland.cic.auth.baseUrl=...
nuxeo.hyland.cic.contextEnrichment.baseUrl=...
nuxeo.hyland.cic.enrichment.clientId=...
nuxeo.hyland.cic.enrichment.clientSecret=...
nuxeo.hyland.cic.enrichment.auth.grantType=client_credentials
nuxeo.hyland.cic.enrichment.auth.scope=environment_authorization
nuxeo.hyland.cic.enrichment.environment=...
```

`nuxeo.hyland.cic.enrichment.environment` is the HXP environment ID. If it is unset, the operation falls back to `nuxeo.hyland.cic.ingest.environment`. Both should point at the same Content Intelligence environment.

Config files must use Unix line endings. A Windows `CRLF` line in `50-hyland-cic.conf` left the environment key unread in the local container.

The KE upload path also uses the CIC ingest contribution:

```conf
nuxeo.hyland.cic.ingest.baseUrl=...
nuxeo.hyland.cic.ingest.clientId=...
nuxeo.hyland.cic.ingest.clientSecret=...
nuxeo.hyland.cic.ingest.environment=...
nuxeo.hyland.cic.ingest.auth.scope=environment_authorization
```

This is separate from the `hxai.ingest.*` namespace used by the HxAI connector that feeds Knowledge Discovery Content Lake indexes.

## KE requires a SEPARATE External Application from Discovery

This is the single most common source of `HTTP 403 "You do not have permissions to access this resource"` against
`{contextEnrichmentBaseUrl}/files/upload/presigned-url`, and it is **not** a role-grant problem.

The Hyland Experience Admin Portal binds every External Application to one `Application*` value, and that binding
constrains the `appkey` (and therefore the `hxp_authorization.permission` set) of every token the External App can
issue. The Discovery External Application is bound to _Content Intelligence Connector_, which maps to
`appkey: "insight"`. Tokens it issues carry only `hxai-insight.*` and `system-integrations.*` permissions — never
`cin-context-api.*`, `cin-data-curation.*`, or `content-lake-api.*`.

The Context API's `/files/upload/presigned-url` endpoint enforces `cin-context-api.contentprocessing.write` plus
`content-lake-api.documents.*`. A token without those permissions is rejected with a generic 403, even when the
Mapped Service User's User Group has been assigned the _Context, Data Curation and Content Lake Group_ and
_Content Lake User_ roles on the Content Lake application card.

Symptoms of this exact misconfiguration:

- `verify-ke-dev-connectivity.sh` returns:
  - `OK: Dev IDP issued a KE access token.`
  - `FAIL: Context Enrichment presigned URL returned HTTP 403: {"title":"Authorization Error","status":403,"detail":"You do not have permissions to access this resource"}`
- Decoding the JWT shows `hxp_authorization.appkey == "insight"` and no `cin-context-api.*` / `content-lake-api.*`
  permissions, regardless of how many roles you grant the user group on Content Lake.

Fix:

1. In **Identity → External Applications**, create a NEW External Application:
   - Mapped Service User: same one Discovery uses (e.g. `nuxeo-kd-svc`) so existing group memberships transfer.
   - **Application**: pick a Content-Lake-issuing application (on our Dev tenant this is _Content Lake_ on the
     **Insight Integration Testing - 1** environment).
   - Allowed Scopes: mirror the Discovery External App — at minimum `environment_authorization`, `hxp`,
     `hxp.integrations`, `openid`.
   - Copy the new Client ID and Client Secret IMMEDIATELY (the secret is shown once).
2. In **Account → Insight Integration Testing - 1 → Applications → Content Lake → User Rights**, assign the
   Mapped Service User's User Group to both **Context, Data Curation and Content Lake Group** and
   **Content Lake User** roles. (These rights only become visible in tokens minted by the new External App in
   step 1; they're inert against the old Discovery External App.)
3. In `nuxeo-conf/50-hyland-kd-dev.conf` (gitignored), point only the KE block at the new credentials. Keep
   `nuxeo.hyland.cic.discovery.*`, `nuxeo.hyland.cic.ingest.*`, and `hxai.ingest.*` on the original Discovery SA —
   they need `appkey: "insight"`:

   ```conf
   nuxeo.hyland.cic.enrichment.clientId=<new-sc-...-id>
   nuxeo.hyland.cic.enrichment.clientSecret=<new-secret>
   ```

4. Restart Nuxeo (`docker restart nuxeo`) so it reloads the new credentials, then re-run
   `./scripts/verify-ke-dev-connectivity.sh`. Expected output:

   ```text
   OK: Dev IDP issued a KE access token.
   OK: Context Enrichment presigned URL endpoint returned HTTP 200.
   ```

To prove the new token has the right shape (no network beyond the IDP token call):

```bash
KE_ENRICHMENT_CLIENT_ID=<new-sc-...> \
KE_ENRICHMENT_CLIENT_SECRET='<new-secret>' \
python3 - <<'PY'
import base64, json, os, urllib.parse, urllib.request
form = urllib.parse.urlencode({"grant_type":"client_credentials","scope":"environment_authorization",
    "client_id":os.environ["KE_ENRICHMENT_CLIENT_ID"],
    "client_secret":os.environ["KE_ENRICHMENT_CLIENT_SECRET"]}).encode("utf-8")
req = urllib.request.Request("https://auth.iam.dev.experience.hyland.com/idp/connect/token",
    data=form, method="POST", headers={"Content-Type":"application/x-www-form-urlencoded"})
tok = json.loads(urllib.request.urlopen(req, timeout=30).read())
pad = lambda s: s + "=" * (-len(s) % 4)
payload = json.loads(base64.urlsafe_b64decode(pad(tok["access_token"].split(".")[1])))
ha = payload["hxp_authorization"]
print("appkey:", ha["appkey"])
print("roles:", ha.get("role"))
print("permissions:", sorted(ha.get("permission", [])))
PY
```

Expected `appkey` is `content-lake` and permissions must include
`cin-context-api.contentprocessing.write` and `content-lake-api.documents.*`. If they don't, the External
Application binding in step 1 is wrong — pick a different `Application*` value.

## Verification steps

1. Confirm the operation is registered. An unauthenticated POST returns 401 when it exists, and 404 when it doesn't:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "http://localhost:8080/nuxeo/site/automation/AgenticKnowledgeEnrichment.Enrich"
```

2. Run the connectivity check. It requests a token and calls the presigned-URL endpoint. Both should succeed:

```bash
export KE_ENRICHMENT_CLIENT_ID=<client id>
export KE_ENRICHMENT_CLIENT_SECRET=<client secret>
bash scripts/verify-ke-dev-connectivity.sh
```

Expected output: `OK: Dev IDP issued a KE access token.` and `OK: Context Enrichment presigned URL endpoint returned HTTP 200.`

3. In the UI, upload:

- a PDF, or another supported text type, for classification, entity extraction, and summarization
- an image for description and image entity extraction

A 500 from the operation means the Context API rejected the request. The message names the HTTP status and the reason. A 403 usually means the KE client lacks the Context API permissions, and the section on separate External Applications explains the fix.

4. After each action, verify the properties panel refreshes:

- `Document Category`
- `Tags`
- `Description`

## Environment notes

- `NXENG-42` comments indicate the old dev KE setup was unstable.
- Prefer the integrations/staging path documented in the linked engineering guide when provisioning KE accounts and credentials.
- `NXSAT-143` comments already called out avoiding noisy shared environments for reliable validation.
