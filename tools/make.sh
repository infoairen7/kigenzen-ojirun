#!/usr/bin/env bash
# Build everything from src/:
#   dist/index.html  one file, three.js from cdnjs (the published web page)
#   release/         the zips for itch.io and for playing offline (index.html + three.min.js)
#   docs/            the GitHub Pages copy
# Bake an online race server into the build:  TORCH_SERVER=https://kigenzen-ojirun-online.NAME.workers.dev bash tools/make.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
python3 tools/build.py src/index.html src/art/noart.js src/audio.js dist/index.html
python3 tools/package_release.py dist/index.html vendor/three.min.js vendor/three.LICENSE release/kigenzen-ojirun
mkdir -p docs
cp release/kigenzen-ojirun/index.html release/kigenzen-ojirun/three.min.js release/kigenzen-ojirun/LICENSES.txt docs/
touch docs/.nojekyll
echo "docs/ updated for GitHub Pages"
