# NXSAT-308 parity fixture

The data that `../nxsat-308-parity.mjs` runs against, and the means to recreate it on a Nuxeo of
your own. Committed by NXSAT-643; until then it existed only in the 2026-10-08 "before" capture's
evidence folder, so nothing in the repository could recreate the fixture.

| File                                 | What it is                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `seed-parity-data.mjs`               | Deletes and recreates the fixture, then verifies it (`--check`, `--remove`) |
| `assets/`                            | The PDF, PNG, WebM and octet-stream blobs, byte-identical to the capture's  |
| `start-parity-nuxeo.sh`              | A Nuxeo 2025 on PostgreSQL of your own on `:18094`, images pinned by digest |
| `10-parity-postgresql.conf.template` | The `conf.d` file it mounts (password placeholder only)                     |
| `proxy.parity.json`                  | A dev-server proxy pointing `/nuxeo` at `:18094`                            |

## Team runs use their own Nuxeo

Run the parity steps against a Nuxeo you started for the purpose and seeded from here — **never a
developer's own local Nuxeo**. Its data and configuration are someone else's working state, its
`parity` workspace is not yours to replace, and a server whose state nobody recorded produces
evidence nobody can reproduce. The seed refuses the default workspace on a `:8080` server, the
conventional port of a developer's own Nuxeo, for that reason.

Credentials come from the environment only: `NUXEO_USER` / `NUXEO_PASS` for the administrator,
`PARITY_USER_PASS` for the restricted user, `NUXEO_CLID` for the container. Nothing here has a
default for any of them.

```zsh
export NUXEO_CLID=…                                     # your Connect instance id
zsh scripts/beta-harness/steps/nxsat-308-parity/start-parity-nuxeo.sh

export NUXEO_URL=http://localhost:18094 NUXEO_USER=… NUXEO_PASS=…   # the container's administrator
export PARITY_USER_PASS=$(openssl rand -hex 16)
node scripts/beta-harness/steps/nxsat-308-parity/seed-parity-data.mjs        # → "fixture verified"

npx nx serve nuxeo-ui --port 4216 --proxy-config scripts/beta-harness/steps/nxsat-308-parity/proxy.parity.json
APP_URL=http://localhost:4216 PARITY_SURFACE=nxs npm run beta:evidence -- nxsat-308-parity
```

## The identity guard

Every request the seed sends carries the `Authorization` header, and before its first write it
asks `/nuxeo/api/v1/me` who it is talking to. On a Nuxeo with anonymous access switched on, a
request whose header did not arrive is answered `200` as `Anonymous` instead of being refused, so
a fixture "verified" that way verifies nothing. The parity steps then run through the phase
runner's identity guard, which checks every step boundary the same way. Both use
`scripts/beta-harness/identity-guard.mjs`.

## Exercising the seed without a Nuxeo of your own

`--workspace` and `--user` put the same fixture under other names, so the script can be proved
on a shared server. Another workspace gets its own user, `<workspace>-user`. The seed replaces and
deletes only what it created — a workspace or user that exists without its marker is refused —
so it cannot reset someone else's:

```zsh
node seed-parity-data.mjs --workspace nxsat-643-parity        # its user: nxsat-643-parity-user
node seed-parity-data.mjs --workspace nxsat-643-parity --remove
```

The parity steps read the default names, so a fixture seeded under other names is not one they
can run against.

The seed manifest is written outside the repository, to
`$AGENTIC_UI_EVIDENCE_DIR/nxsat-308-parity/<workspace>/seed-manifest.json` (or `--manifest`).
