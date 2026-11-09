#!/usr/bin/env bash
set -uo pipefail
mkdir -p /tmp/home/Downloads/ENiShare
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron tests/e2e/seed.js /tmp/home/Downloads/ENiShare
exec scripts/docker/smoke.sh "$@"
