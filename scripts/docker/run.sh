#!/usr/bin/env bash
# Development helper: runs a command in the local build container (Xvfb, GTK) with the
# project mounted at /src. Used for headless UI smoke tests on machines without Xvfb.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ENISHARE_IMAGE:-endl-build}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || IMAGE=lumen-build
mkdir -p "$ROOT/.cache"
{ echo "root:x:0:0:root:/root:/bin/bash"; echo "builder:x:$(id -u):$(id -g):builder:/tmp/home:/bin/bash"; } >"$ROOT/.cache/.passwd"
# shellcheck disable=SC2086
exec docker run --rm -i --init ${ENISHARE_DOCKER_ARGS:-} \
  --user "$(id -u):$(id -g)" -e HOME=/tmp/home \
  -v "$ROOT/.cache/.passwd":/etc/passwd:ro \
  -v "$ROOT":/src -w /src "$IMAGE" bash -lc "mkdir -p /tmp/home && $*"
