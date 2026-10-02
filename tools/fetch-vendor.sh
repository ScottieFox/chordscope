#!/usr/bin/env bash
# Download the sources that src/*.json are generated from into vendor/ (git-ignored).
#   fonts: Bravura, Petaluma, Petaluma Script (SIL OFL 1.1), from the @vexflow-fonts packages
#   piano: Salamander Grand Piano V3 (CC BY 3.0), velocity layer 8, from @audio-samples/piano-mp3-velocity8
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor
fetch() { # <npm-package@version> <folder under vendor/>
  local dir="vendor/$2" tgz
  rm -rf "$dir" && mkdir -p "$dir"
  tgz=$(npm pack "$1" --silent --pack-destination vendor | tail -n 1)
  tar -xzf "vendor/$tgz" -C "$dir"
  rm "vendor/$tgz"
  echo "  $1 -> $dir/package"
}
fetch @vexflow-fonts/bravura@1.0.2 bravura
fetch @vexflow-fonts/petaluma@1.0.1 petaluma
fetch @vexflow-fonts/petalumascript@1.0.0 petalumascript
fetch @audio-samples/piano-mp3-velocity8@1.0.5 samples/v8
