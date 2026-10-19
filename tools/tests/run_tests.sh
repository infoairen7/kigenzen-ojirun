#!/usr/bin/env bash
# The automatic checks (no GPU needed: a stand-in for three.js draws nothing, the game logic and UI run for real).
# Needs: Node 22+, Python 3, Playwright for Python (pip install playwright && python -m playwright install chromium).
# Run tools/make.sh first.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"; H=$ROOT/dist/index.html; JA=$ROOT/release/kigenzen-ojirun/index.html; EN=$ROOT/release/kigenzen-ojirun-en/index.html
OUT=$(mktemp -d)
node rules.js $H
node era_sim.js $H | tail -1
python3 ui.py $H $OUT | tail -2
python3 era_ui.py $H | tail -1
python3 input_test.py $H | tail -1
python3 hold_test.py $H | tail -1
python3 bgm_test.py $H | tail -2
python3 edition_test.py $EN $JA | tail -1
python3 embed_fit.py $JA | tail -1
python3 phone_fit.py $JA | tail -1
python3 hud_fit.py $JA | tail -1
python3 hud_overlap.py $JA | tail -1
python3 hint_pos.py $JA | tail -1
python3 touch_hold.py $JA | tail -1
python3 net_test.py $H $ROOT/server | tail -1
python3 p2p_test.py $H $ROOT/server | tail -1
python3 online_fit.py $JA $ROOT/server $OUT | tail -6
python3 lan_check.py $JA $ROOT/server
(cd $ROOT/server && node test/room-test.mjs | tail -1 && node test/worker-test.mjs | tail -1)
