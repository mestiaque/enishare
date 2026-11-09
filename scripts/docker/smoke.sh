#!/usr/bin/env bash
# Headless UI smoke test (inside the container): starts ENiShare under Xvfb and takes
# screenshots into .cache/shots. Usage: smoke.sh "<xdotool steps separated by ;>"
set -uo pipefail
mkdir -p .cache/shots /tmp/home/Downloads
Xvfb :99 -screen 0 1280x840x24 >/dev/null 2>&1 &
XPID=$!
trap 'kill $EPID $XPID 2>/dev/null' EXIT
export DISPLAY=:99
sleep 1
dbus-run-session -- node_modules/electron/dist/electron . --no-sandbox --disable-gpu >.cache/electron.log 2>&1 &
EPID=$!
sleep 7
import -window root .cache/shots/00-start.png
i=1
IFS=';' read -ra STEPS <<< "${1:-}"
for s in "${STEPS[@]}"; do
  [ -z "$s" ] && continue
  eval "xdotool $s"
  sleep 1.6
  import -window root ".cache/shots/$(printf %02d $i).png"
  i=$((i+1))
done
