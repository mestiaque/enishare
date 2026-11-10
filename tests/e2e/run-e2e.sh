#!/usr/bin/env bash
# Runs the phone simulation end-to-end test inside the build container (needs Xvfb).
set -uo pipefail
OUT=$(mktemp -d)
mkdir -p .cache/shots
head -c 20000000 /dev/urandom > "$OUT/holiday.mov"
printf 'line1\nline2\n' > "$OUT/list.csv"
ELECTRON_RUN_AS_NODE=1 ENISHARE_TEST_DELAY_CHUNK_REPLY_MS=${DELAY_REPLY:-0} node_modules/electron/dist/electron tests/e2e/serve.js "$OUT" > .cache/e2e-server.log 2>&1 &
SPID=$!
for i in $(seq 1 30); do [ -f "$OUT/pair-url.txt" ] && break; sleep 0.5; done
Xvfb :97 -screen 0 600x900x24 >/dev/null 2>&1 &
XPID=$!
trap 'kill $SPID $XPID 2>/dev/null' EXIT
sleep 1
START=$(date +%s); DARK=${DARK:-} DISPLAY=:97 node_modules/electron/dist/electron tests/e2e/phone-sim.cjs --no-sandbox --disable-gpu -- "$(cat "$OUT/pair-url.txt")" "$PWD/.cache/shots" "$OUT/holiday.mov" "$OUT/list.csv" 2>&1 | grep -v -i dbus
echo "phone run took $(( $(date +%s) - START )) s"
echo "--- received on PC:"
ls -la "$OUT/storage/Received"
cmp "$OUT/holiday.mov" "$OUT/storage/Received/holiday.mov" && echo "holiday.mov: byte-identical"
cmp "$OUT/list.csv" "$OUT/storage/Received/list.csv" && echo "list.csv: byte-identical"
