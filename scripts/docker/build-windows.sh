#!/usr/bin/env bash
# Builds the Windows installer on Linux using electron-builder's official Wine image.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$HOME/.cache/electron" "$HOME/.cache/electron-builder"
docker run --rm -v "$ROOT":/project -w /project \
  -e ELECTRON_CACHE=/root/.cache/electron -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
  -v "$HOME/.cache/electron":/root/.cache/electron -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
  electronuserland/builder:wine \
  bash -c "node scripts/vendor.js && npx electron-builder --win nsis --x64 --publish never; chown -R $(id -u):$(id -g) release"
