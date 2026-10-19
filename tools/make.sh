#!/usr/bin/env bash
# Build everything from src/:
#   dist/index.html  one file, three.js from cdnjs (the published web page)
#   release/         the zips for itch.io and for playing offline (index.html + three.min.js)
#   docs/            the GitHub Pages copy
#   (docs/ also gets the link-preview tags and media/ogp.jpg, so a shared link shows a picture)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
python3 tools/build.py src/index.html src/art/noart.js src/audio.js dist/index.html
python3 tools/package_release.py dist/index.html vendor/three.min.js vendor/three.LICENSE release/kigenzen-ojirun
mkdir -p docs
cp release/kigenzen-ojirun/index.html release/kigenzen-ojirun/three.min.js release/kigenzen-ojirun/LICENSES.txt docs/
cp media/ogp.jpg docs/ogp.jpg
python3 tools/pages_meta.py docs/index.html
touch docs/.nojekyll
echo "docs/ updated for GitHub Pages"
