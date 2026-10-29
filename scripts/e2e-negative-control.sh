#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point. The portable runner compares baseline and starved app runs.
exec node "$(dirname "$0")/e2e-negative-control.mjs" "$@"
