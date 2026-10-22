# Knowledge Enrichment

Knowledge Enrichment (KE) in this repo runs through the **Hyland Content Intelligence Connector (CIC)** installed on Nuxeo. The Angular app does not call a separate backend for KE. Instead, it:

1. fetches the current document blob from Nuxeo
2. posts that blob to a Nuxeo automation op
3. lets the connector handle KE authentication and Context API calls
4. writes the returned enrichment back into Nuxeo metadata

## Supported UI flows

The document detail page exposes KE actions in the top-right header area of the document preview.

### PDF

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

- `image-description` + `named-entity-recognition-image` run together from one action
- description is persisted to `dc:description`
- image entities are persisted to `nxtag:tags`

This mapping follows the KE end-user guide linked from `NXSAT-143` and keeps the results visible in the existing properties panel without introducing CSX components.

## Integration boundary

Shared client: `@agentic-ui/shared/ke-client`

Primary automation op:

- `HylandKnowledgeEnrichment.Enrich`

Other verified KE-related ops available on the live Nuxeo server:

- `HylandKnowledgeEnrichment.SendForEnrichment`
- `HylandKnowledgeEnrichment.GetEnrichmentResults`
- `HylandKnowledgeEnrichment.UploadFile`
- `HylandKnowledgeEnrichment.Invoke`
- `HylandKnowledgeEnrichment.Configure`
- `HylandContentIntelligence.GetContributionNames`

`HylandKnowledgeEnrichment.Enrich` accepts multipart input:

- a JSON part named `request`
- a blob part named `input`

This was verified live against the local Nuxeo container. When KE config is missing, the op currently fails with:

```text
No authentication info for calling the Enrichment service.
```

That proves the browser-to-Nuxeo multipart shape is correct and the remaining blocker is server-side KE configuration, not the Angular request format.

## Request shape

The shared client posts multipart form data to:

```text
/nuxeo/site/automation/HylandKnowledgeEnrichment.Enrich
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

The KE contribution inside the CIC bundle reads these properties:

```conf
nuxeo.hyland.cic.auth.baseUrl=...
nuxeo.hyland.cic.contextEnrichment.baseUrl=...
nuxeo.hyland.cic.enrichment.clientId=...
nuxeo.hyland.cic.enrichment.clientSecret=...
nuxeo.hyland.cic.enrichment.auth.grantType=client_credentials
nuxeo.hyland.cic.enrichment.auth.scope=environment_authorization
```

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

4. Restart Nuxeo (`docker restart nuxeo`) so the connector reloads the new credentials, then re-run
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

1. Confirm the connector exposes KE contributions:

```bash
docker exec nuxeo curl -s -u Administrator:Administrator \
  -X POST -H "Content-Type: application/json" \
  http://localhost:8080/nuxeo/site/automation/HylandContentIntelligence.GetContributionNames \
  -d '{"params":{"which":"knowledgeEnrichment"}}'
```

Expected result:

```json
{ "knowledgeEnrichment": ["default"] }
```

2. Smoke test the multipart KE op:

```bash
printf 'KE smoke test' >/tmp/ke-sample.txt

curl -sS -u Administrator:Administrator \
  -X POST "http://localhost:8080/nuxeo/site/automation/HylandKnowledgeEnrichment.Enrich" \
  -H "Accept: application/json" \
  -F "request={\"params\":{\"actions\":\"textSummarization\"}};type=application/json" \
  -F "input=@/tmp/ke-sample.txt;type=text/plain"
```

If config is still missing, the current expected failure is the connector error above. Once KE credentials are configured, this should return a JSON result payload instead.

If it returns a generic connector envelope like this:

```json
{ "response": {}, "responseMessage": "Forbidden", "responseCode": 403 }
```

the connector reached the Context API, but the configured KE service account is not authorized for the Context API presigned upload endpoint.

3. In the UI, upload:

- a PDF for classification, entity extraction, and summarization
- an image for description and image entity extraction

4. After each action, verify the properties panel refreshes:

- `Document Category`
- `Tags`
- `Description`

## Environment notes

- `NXENG-42` comments indicate the old dev KE setup was unstable.
- Prefer the integrations/staging path documented in the linked engineering guide when provisioning KE accounts and credentials.
- `NXSAT-143` comments already called out avoiding noisy shared environments for reliable validation.
