#!/usr/bin/env zsh
# Starts a Nuxeo of your own for the NXSAT-308 parity steps: `nxsat308-parity` on :18094, on
# PostgreSQL (`nxsat308-parity-pg`), both on the private network `nxsat308-parity-net`. Both images
# are pinned to the digests the 2026-10-08 "before" capture used (Nuxeo 2025.26.16, PostgreSQL 16.13).
#
# Team runs use a Nuxeo started this way and seeded with seed-parity-data.mjs — never a developer's
# own local Nuxeo, whose data and configuration are not the fixture's to replace (see README.md).
#
# Changes nothing outside the three resources it names: no other container, network or volume is
# read, started or stopped. NUXEO_CLID comes from the environment only and is never printed.
#
# Why PostgreSQL rather than the stock H2: Nuxeo's H2 template hard-codes fulltext
# searchDisabled="true", so every search answers HTTP 400 "Fulltext search disabled by configuration".
#
#   export NUXEO_CLID=…            # your Nuxeo Connect instance id
#   zsh scripts/beta-harness/steps/nxsat-308-parity/start-parity-nuxeo.sh
#
# The administrator is the image's stock account; set NUXEO_USER / NUXEO_PASS to it for the seed.
# Published on 127.0.0.1 only, so that stock account is not reachable from the network.
# Tear down:  docker rm -f nxsat308-parity nxsat308-parity-pg && docker network rm nxsat308-parity-net \
#               && rm -f /tmp/nxsat308-parity-postgresql.conf
set -euo pipefail
HERE=${0:A:h}
NUXEO_IMAGE=${NUXEO_IMAGE:-docker-private.packages.nuxeo.com/nuxeo/nuxeo@sha256:5879b74c724b5752871ec5de9beec6fe25dee5e78c3475aab125e21f28b66433}
PG_IMAGE=${PG_IMAGE:-postgres@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416}
NET=nxsat308-parity-net
LABEL=purpose=nxsat-308-parity
PORT=${PARITY_NUXEO_PORT:-18094}

[[ -n ${NUXEO_CLID:-} ]] || { echo "NUXEO_CLID must be set in the environment (no default)" >&2; exit 2; }
for c in nxsat308-parity nxsat308-parity-pg; do
  if docker container inspect $c >/dev/null 2>&1; then
    echo "$c already exists — tear down first (see the header)" >&2
    exit 1
  fi
done

umask 077
WORK=$(mktemp -d)
trap 'rm -rf $WORK' EXIT
printf 'NUXEO_CLID=%s\n' "$NUXEO_CLID" > $WORK/clid.env
PGPASS=$(openssl rand -hex 16)
printf 'POSTGRES_USER=nuxeo\nPOSTGRES_PASSWORD=%s\n' "$PGPASS" > $WORK/pg.env

docker network inspect $NET >/dev/null 2>&1 || docker network create --label $LABEL $NET >/dev/null
docker run -d --name nxsat308-parity-pg --label $LABEL --network $NET --memory=512m \
  --env-file $WORK/pg.env "$PG_IMAGE" >/dev/null
for i in {1..30}; do
  docker exec nxsat308-parity-pg pg_isready -U nuxeo -d nuxeo >/dev/null 2>&1 && break
  sleep 1
done
docker exec nxsat308-parity-pg pg_isready -U nuxeo -d nuxeo

# The Nuxeo image runs as uid 900, so the conf.d file must be world-readable; it holds only the
# throwaway database's password. Kept for the container's lifetime (a bind mount needs its source),
# under /tmp because Docker Desktop shares it; the teardown line in the header removes it.
PG_CONF=/tmp/nxsat308-parity-postgresql.conf
sed "s/@PGPASS@/$PGPASS/" $HERE/10-parity-postgresql.conf.template > $PG_CONF
chmod 644 $PG_CONF
unset PGPASS
docker run -d --name nxsat308-parity --label $LABEL --network $NET --memory=3g -p 127.0.0.1:$PORT:8080 \
  -v $PG_CONF:/etc/nuxeo/conf.d/10-parity-postgresql.conf:ro \
  --env-file $WORK/clid.env "$NUXEO_IMAGE" >/dev/null

s=000
for i in {1..60}; do
  s=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/nuxeo/runningstatus || true)
  [[ $s == 200 ]] && break
  sleep 5
done
[[ $s == 200 ]] || { echo "Nuxeo did not report running (last status $s)" >&2; exit 1; }
echo "Nuxeo on PostgreSQL ready at http://localhost:$PORT/nuxeo"
