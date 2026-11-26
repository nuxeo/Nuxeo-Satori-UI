# Full-Text Search (OpenSearch) Setup Guide

This guide walks through setting up OpenSearch for full-text search in the Nuxeo Angular UI.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (localhost:4200)                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Angular App                                              │   │
│  │  SearchService / AssetService                             │   │
│  │    GET /nuxeo/api/v1/search/pp/<page-provider>/execute    │   │
│  │    POST /nuxeo/api/v1/automation/Search.SuggestersLauncher│   │
│  └──────────┬───────────────────────────────────────────────┘   │
│             │ /nuxeo proxy                                      │
└─────────────┼───────────────────────────────────────────────────┘
              │
   ┌──────────▼──────────┐
   │  Nuxeo Server       │  ◀─── host port 8080
   │  localhost:8080      │
   │  ┌────────────────┐ │
   │  │ Page Providers │ │  default_search, assets_search, etc.
   │  │ ecm_fulltext   │ │  Nuxeo translates to OpenSearch DSL
   │  └───────┬────────┘ │
   └──────────┼──────────┘
              │ HTTP (9200)
   ┌──────────▼──────────┐
   │  OpenSearch          │
   │  localhost:9200      │
   │  ┌────────────────┐ │
   │  │ nuxeo index    │ │  Documents, full-text, aggregations
   │  │ nuxeo-audit    │ │  Audit log entries
   │  └────────────────┘ │
   └─────────────────────┘
```

**How it works:**

1. The Angular app sends search requests to Nuxeo's REST API using **page providers** (`default_search`, `assets_search`)
2. The `ecm_fulltext` parameter triggers Nuxeo's full-text search across document titles, descriptions, binary text, tags, and note content
3. Nuxeo translates the page provider query + aggregation definitions into an OpenSearch DSL query
4. OpenSearch returns matching documents and aggregation buckets (facets)
5. Nuxeo formats the response and returns it to the Angular app as JSON with `entries` and `aggregations`

## Prerequisites

- **Docker Desktop** (with Docker Compose v2)
- **Nuxeo Server** running on `localhost:8080` (or your configured port)
- **Nuxeo's OpenSearch 2 packages**, `nuxeo-search-client-opensearch2` and `nuxeo-audit-opensearch2`,
  installed on your Nuxeo instance: the two the demo server installs
  ([`compose.yml`](../business-apps/demo-server/compose.yml))

## Step 1: Start OpenSearch

Create or add to your Nuxeo Docker Compose stack. A minimal OpenSearch service, at 2.13.0, the
version the local `nuxeo-opensearch` container runs (`docker inspect`, 25 November 2026) and the
demo server pins. The demo server's [`compose.yml`](../business-apps/demo-server/compose.yml) is
the version of record: `npm run demo-server:selftest` holds it to the stack
[`scripts/demo-server-plan.mjs`](../scripts/demo-server-plan.mjs) declares, so a new version is
made in both, and then here.

```yaml
services:
  opensearch:
    image: opensearchproject/opensearch:2.13.0
    container_name: opensearch
    environment:
      - discovery.type=single-node
      # The entrypoint reads this env var, not the plugins.security.disabled
      # setting. Setting it here is what skips install_demo_configuration.sh,
      # so no OPENSEARCH_INITIAL_ADMIN_PASSWORD is needed at all.
      - DISABLE_SECURITY_PLUGIN=true
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m
    ports:
      - 9200:9200
      - 9600:9600
    volumes:
      - opensearch-data:/usr/share/opensearch/data
    networks:
      - nuxeo-net

volumes:
  opensearch-data:

networks:
  nuxeo-net:
    external: true
```

Start it:

```bash
docker network create nuxeo-net   # if not already created
docker compose -f <your-compose-file>.yml up -d opensearch
```

Verify OpenSearch is running:

```bash
curl http://localhost:9200
```

You should see a JSON response with `"cluster_name"` and `"version"`.

## Step 2: Configure Nuxeo to Use OpenSearch

Add the following to your Nuxeo server's `nuxeo.conf`:

```properties
# OpenSearch connection
opensearch.addressList=http://opensearch:9200

# Index names
opensearch.indexName=nuxeo
opensearch.indexNumberOfReplicas=0
opensearch.indexNumberOfShards=1

# Audit index
audit.opensearch.indexName=nuxeo-audit
audit.opensearch.enabled=true

# Reindex on startup (set to true for first run, then false)
opensearch.reindex.onStartup=false
```

If running Nuxeo as a Docker container on the same `nuxeo-net` network, use `http://opensearch:9200` as the address. If Nuxeo runs on the host, use `http://localhost:9200`.

### Install the OpenSearch packages

If not already included in your Nuxeo Docker image, install the packages:

```bash
# Inside the Nuxeo container or via nuxeoctl
nuxeoctl mp-install nuxeo-search-client-opensearch2 nuxeo-audit-opensearch2
```

Or add them to your Nuxeo Dockerfile:

```dockerfile
RUN /opt/nuxeo/bin/nuxeoctl mp-install nuxeo-search-client-opensearch2 nuxeo-audit-opensearch2
```

## Step 3: Initial Indexing

After configuring Nuxeo with OpenSearch, trigger a full reindex to populate the search index with existing documents.

**Option A** — Set `opensearch.reindex.onStartup=true` in `nuxeo.conf` and restart Nuxeo. After the reindex completes, set it back to `false`.

**Option B** — Use the Nuxeo Admin console:

1. Open `http://localhost:8080/nuxeo/admin` (Admin > Elasticsearch/OpenSearch)
2. Click **Reindex Repository** for the `default` repository
3. Wait for the indexing to complete (check the admin page or server logs)

**Option C** — Use the REST API:

```bash
curl -u Administrator:Administrator -X POST \
  "http://localhost:8080/nuxeo/site/automation/Elasticsearch.Index" \
  -H "Content-Type: application/json" \
  -d '{"params":{},"context":{}}'
```

## Step 4: Verify Search Is Working

### Check the OpenSearch index

```bash
curl http://localhost:9200/nuxeo/_count
```

The `count` should match the number of documents in your Nuxeo repository.

### Check from the Angular app

1. Start the dev server: `npx nx serve nuxeo-ui`
2. Navigate to `http://localhost:4200/search`
3. Type a search term in the full-text search field
4. Results should appear with facet aggregations in the sidebar

### Check the suggest/typeahead

Type in the global search bar in the app header. Suggestions should appear from the `Search.SuggestersLauncher` automation.

## How Search Works in the Angular App

### Page Providers

The Angular app uses two main Nuxeo page providers:

| Page Provider    | Used By         | Purpose                            |
| ---------------- | --------------- | ---------------------------------- |
| `default_search` | `SearchService` | Document search with facet filters |
| `assets_search`  | `AssetService`  | Asset/DAM search with media facets |

### SearchService (`libs/shared/nuxeo-client/src/lib/services/search.service.ts`)

Key methods:

| Method             | Endpoint                                                  | Description                         |
| ------------------ | --------------------------------------------------------- | ----------------------------------- |
| `search(params)`   | `GET /nuxeo/api/v1/search/pp/default_search/execute`      | Full-text + faceted document search |
| `suggest(term)`    | `POST /nuxeo/api/v1/automation/Search.SuggestersLauncher` | Global typeahead suggestions        |
| `getSavedSearches` | `GET /nuxeo/api/v1/search/saved`                          | List saved searches                 |
| `saveSavedSearch`  | `POST /nuxeo/api/v1/search/saved`                         | Create a saved search               |

#### Search parameters

The `search()` method accepts:

| Parameter      | Query Param       | Description                        |
| -------------- | ----------------- | ---------------------------------- |
| `ecmFulltext`  | `ecm_fulltext`    | Full-text search across all fields |
| `q`            | `query`           | Raw query string                   |
| `quickFilters` | `quickFilters`    | Named quick filters                |
| `sortBy`       | `sortBy`          | Sort field (default: `dc:created`) |
| `sortOrder`    | `sortOrder`       | `asc` or `desc`                    |
| `modifiedDate` | `dc_modified_agg` | Date range aggregation filter      |
| `author`       | `dc_creator_agg`  | Creator aggregation filter         |
| `collection`   | `collection_agg`  | Collection aggregation filter      |
| `nature`       | `dc_nature_agg`   | Document nature filter             |
| `coverage`     | `dc_coverage_agg` | Coverage filter                    |
| `subjects`     | `dc_subjects_agg` | Subject/topic filter               |
| `size`         | `common_size_agg` | File size range filter             |
| `tag`          | `ecm_tags`        | Tag filter                         |

#### Document search aggregations

These facets are returned by OpenSearch via Nuxeo and displayed in the search sidebar:

| Aggregation Key   | Facet Label   | Type       |
| ----------------- | ------------- | ---------- |
| `dc_modified_agg` | Modified Date | Date range |
| `dc_creator_agg`  | Author        | Terms      |
| `collection_agg`  | Collection    | Terms      |
| `dc_nature_agg`   | Nature        | Terms      |
| `dc_coverage_agg` | Coverage      | Terms      |
| `dc_subjects_agg` | Subjects      | Terms      |
| `common_size_agg` | Size          | Range      |

### AssetService (`libs/shared/nuxeo-client/src/lib/services/asset.service.ts`)

| Method                 | Endpoint                                            | Description                    |
| ---------------------- | --------------------------------------------------- | ------------------------------ |
| `searchAssets(params)` | `GET /nuxeo/api/v1/search/pp/assets_search/execute` | Asset search with media facets |

#### Asset search aggregations

| Aggregation Key          | Facet Label    | Type  |
| ------------------------ | -------------- | ----- |
| `system_primaryType_agg` | Document Type  | Terms |
| `system_mimetype_agg`    | MIME Type      | Terms |
| `asset_width_agg`        | Width          | Range |
| `asset_height_agg`       | Height         | Range |
| `color_profile_agg`      | Color Profile  | Terms |
| `color_depth_agg`        | Color Depth    | Terms |
| `video_duration_agg`     | Video Duration | Range |

### Full-Text Search Fields

When `ecm_fulltext` is set, Nuxeo searches across these fields (configured server-side in the page provider XML):

- `dc:title` — Document title
- `ecm:binarytext` — Extracted text from binary files (PDF, Office, etc.)
- `dc:description` — Document description
- `ecm:tag` — Tags
- `note:note` — Note content
- `file:content.name` — Attached file name

The saved-search highlight configuration in the Angular app matches these fields:

```
dc:title.fulltext,ecm:binarytext,dc:description.fulltext,ecm:tag,note:note.fulltext,file:content.name
```

## Stopping OpenSearch

```bash
docker compose -f <your-compose-file>.yml stop opensearch
```

To remove the container and data volume:

```bash
docker compose -f <your-compose-file>.yml down -v
```

## Troubleshooting

### Search returns no results

1. **Check OpenSearch is running:**

   ```bash
   curl http://localhost:9200/_cluster/health
   ```

   Status should be `green` or `yellow` (single-node clusters are always `yellow`).

2. **Check the index exists and has documents:**

   ```bash
   curl http://localhost:9200/nuxeo/_count
   ```

   If count is `0`, trigger a reindex (see Step 3).

3. **Check Nuxeo can reach OpenSearch:**
   Look in Nuxeo server logs for connection errors:

   ```bash
   docker logs <nuxeo-container> 2>&1 | grep -i "opensearch\|elastic"
   ```

4. **Check the page provider is configured:**
   ```bash
   curl -u Administrator:Administrator \
     "http://localhost:8080/nuxeo/api/v1/search/pp/default_search/execute?pageSize=1"
   ```
   Should return a JSON response with `entries` (even if empty) and `aggregations`.

### Aggregations/facets are empty

- Aggregations require documents to populate. Upload a few documents of different types, with different metadata, to see buckets appear.
- OpenSearch must be configured as the search backend. If Nuxeo falls back to the database (VCS) backend, aggregations won't work.

### Slow search or timeout

- Increase OpenSearch JVM heap: change `-Xms512m -Xmx512m` to `-Xms1g -Xmx1g` (or higher).
- Check if the index needs optimization:
  ```bash
  curl -X POST "http://localhost:9200/nuxeo/_forcemerge?max_num_segments=1"
  ```

### "No alive nodes found" in Nuxeo logs

- OpenSearch is not reachable from Nuxeo. Verify:
  - Both are on the same Docker network (if containerized)
  - The `opensearch.addressList` in `nuxeo.conf` is correct
  - Security plugin is disabled or credentials are configured

### Binary text not indexed (PDF/Office content not searchable)

- Nuxeo needs the binary text extraction to run. Check:
  - The `nuxeo-platform-convert` package is installed
  - LibreOffice and/or `pdftotext` are available in the Nuxeo environment
  - Binary text indexing jobs have completed (check Admin > Background Work)

## Angular App Configuration

The Angular app's search features require no special configuration beyond the standard Nuxeo proxy. The dev proxy in `apps/nuxeo-ui/proxy.conf.json` forwards all `/nuxeo` requests to the Nuxeo server:

```json
{
  "/nuxeo": {
    "target": "http://localhost:8080",
    "secure": false,
    "changeOrigin": true,
    "autoRewrite": true,
    "headers": {
      "X-NXproperties": "*"
    }
  }
}
```

If your Nuxeo server runs on a different port, update the `target` value.

## File Reference

| File                                                                      | Purpose                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| `libs/shared/nuxeo-client/src/lib/services/search.service.ts`             | Document search, suggestions, saved searches      |
| `libs/shared/nuxeo-client/src/lib/services/asset.service.ts`              | Asset/DAM search with media facets                |
| `libs/shared/nuxeo-client/src/lib/services/search-aggregation.service.ts` | Client-side signal state for search aggregations  |
| `libs/shared/nuxeo-client/src/lib/services/asset-aggregation.service.ts`  | Client-side signal state for asset aggregations   |
| `libs/shared/nuxeo-client/src/lib/models/search.model.ts`                 | Search response and aggregation TypeScript models |
| `libs/shared/nuxeo-client/src/lib/models/asset.model.ts`                  | Asset search params and aggregation models        |
| `libs/features/search/src/lib/search/search.ts`                           | Search page component                             |
| `libs/features/search/src/lib/search-filters-drawer/`                     | Search filters sidebar (full-text, facets, saved) |
| `libs/features/assets/src/lib/asset-search-results/`                      | Asset search results page                         |
| `libs/features/assets/src/lib/assets-drawer/`                             | Asset filter sidebar                              |
| `apps/nuxeo-ui/proxy.conf.json`                                           | Dev server proxy to Nuxeo                         |
