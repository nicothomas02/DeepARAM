#!/bin/bash
# Exports the League client files the 3D replay still needs (dump_map_assets.py, plus Mel's effects) and uploads
# them to a temporary branch for the cloud build to pick up. Run on a Mac with League installed, from any checkout:
#   cd ~/Developer/ARAM-Mayhem && git fetch -q origin main && git show origin/main:simulator/tools/mac_export.sh | bash
set -euo pipefail
REPO=https://github.com/nicothomas02/DeepARAM.git
SRC=/tmp/deeparam-main OUT=/tmp/map-assets VENV=/tmp/vfxvenv UP=/tmp/map-upload

echo "== Fresh copy of the scripts"
rm -rf "$SRC"
git clone -q --depth 1 "$REPO" "$SRC"

echo "== Python tools"
if [ ! -x "$VENV/bin/cdtb" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q cdtb zstandard xxhash
  "$VENV/bin/cdtb" fetch-hashes
fi

echo "== Export"
rm -rf "$OUT"
cd "$SRC"
"$VENV/bin/python3" simulator/tools/dump_vfx_bins.py "$OUT/vfx" --only mel
"$VENV/bin/python3" simulator/tools/dump_map_assets.py "$OUT"

echo "== Pack"
cd /tmp
rm -f map-assets.tar.gz map-assets.tar.gz.part-*
COPYFILE_DISABLE=1 tar czf map-assets.tar.gz map-assets
split -b 90m map-assets.tar.gz map-assets.tar.gz.part-
ls -lh map-assets.tar.gz.part-*

echo "== Upload"
rm -rf "$UP"
mkdir "$UP"
cd "$UP"
git init -q
cp /tmp/map-assets.tar.gz.part-* .
git add .
git -c user.name="DeepARAM export" -c user.email="export@deeparam.com" commit -qm "Temporary map export"
git push -f "$REPO" HEAD:refs/heads/vfx-raw-tmp
echo "== Done: uploaded to vfx-raw-tmp"
