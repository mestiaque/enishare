#!/usr/bin/env bash
# Desktop app on :99 + simulated iPhone on :98; screenshots of both mid-transfer into .cache/shots.
set -uo pipefail
SH="$PWD/.cache/shots"; mkdir -p "$SH" /tmp/home/Downloads/ENiShare; rm -f "$SH"/*
head -c 40000000 /dev/urandom > /tmp/home/clip.mov
THEME=${THEME:-dark} PIN=482913 ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron tests/e2e/seed.js /tmp/home/Downloads/ENiShare >/dev/null
Xvfb :99 -screen 0 1280x840x24 >/dev/null 2>&1 & X1=$!
Xvfb :98 -screen 0 500x900x24 >/dev/null 2>&1 & X2=$!
sleep 1
DISPLAY=:99 dbus-run-session -- node_modules/electron/dist/electron . --no-sandbox --disable-gpu > .cache/electron.log 2>&1 & EP=$!
trap 'kill $EP $X1 $X2 2>/dev/null' EXIT
sleep 8
IP=$(hostname -I | awk '{print $1}')
DISPLAY=:98 timeout 60 node_modules/electron/dist/electron tests/e2e/visual-phone.cjs --no-sandbox --disable-gpu -- "http://$IP:8080" 482913 "$SH" /tmp/home/clip.mov >/dev/null 2>&1 &
PP=$!
for i in $(seq 1 60); do [ -f "$SH/MID" ] && break; sleep 0.25; done
DISPLAY=:99 import -window root "$SH/desktop-mid.png"
sleep 1.2
DISPLAY=:99 import -window root "$SH/desktop-mid2.png"
wait $PP
DISPLAY=:99 import -window root "$SH/desktop-after.png"
