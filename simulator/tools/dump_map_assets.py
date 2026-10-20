"""Copy the raw Howling Abyss files the 3D replay still needs out of the installed League client.

Only the client's WAD archives hold them: the map's 3D geometry and object layout, the skeletons and animations of
the Mayhem summons and the map's props (Poro King, Tibbers, Viego's soul, health relic, bridge Poros), the mode's
sound banks (Mayhem augment sounds, Howling Abyss ambience) and the announcer voices. Files are written unchanged
under OUT/<path inside the WAD>; build tools in the cloud turn them into the replay's assets.

Usage: python3 simulator/tools/dump_map_assets.py OUT_DIR [--root CLIENT_ROOT] [--list]
CLIENT_ROOT holds Game/ (on macOS ".../League of Legends.app/Contents/LoL"); the live client is used when installed.
--list prints what would be copied without writing. Requires: pip install cdtb zstandard xxhash, then
`cdtb fetch-hashes`. Base map and base skins only: no champion skin files are read.
"""
import argparse, glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))
from dump_vfx_bins import client_root  # noqa: E402
from cdtb.wad import Wad  # noqa: E402
from cdtb.hashes import default_hashfile  # noqa: E402

# (WAD glob under Game/DATA/FINAL, paths to copy)
WANTED = [
    ("Maps/Shipping/Map12*.wad.client", [
        r"^data/maps/mapgeometry/map12/base\.",                       # 3D map mesh and its materials
        r"^data/maps/shipping/map12/[^/]+\.(bin|mapgeo|cfg|json)$",   # object layout, map properties
        r"^levels/map12/",
        r"^assets/characters/(kiwi_|ha_|kingporo)[^/]+/(skins/base/|animations/|[^/]+\.(skl|skn|anm)$)",
        r"^data/characters/(kiwi_|ha_|kingporo)[^/]+/",
        r"^assets/sounds/.*(mode_kiwi|env_map12|npc_map12|announcer)[^/]*\.(bnk|wpk)$",
    ]),
    ("Champions/Annie.wad.client", [
        r"^assets/characters/annietibbers/(skins/base/|animations/)",
        r"^data/characters/annietibbers/",
    ]),
    ("Champions/Senna.wad.client", [
        r"^assets/characters/sennasoul/(skins/base/|animations/)",
        r"^data/characters/sennasoul/",
    ]),
    ("Common*.wad.client", [r"^assets/sounds/.*announcer[^/]*\.(bnk|wpk)$"]),
    ("Global*.wad.client", [r"^assets/sounds/.*announcer[^/]*\.(bnk|wpk)$"]),
    ("Localized/*en_US*.wad.client", [r"^assets/sounds/.*(announcer|mode_kiwi|npc_map12)[^/]*\.(bnk|wpk)$"]),
]
SKIN = re.compile(r"/skins/skin\d+", re.I)  # other skins' folders are never copied


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out")
    ap.add_argument("--root", default=client_root())
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if not args.root:
        sys.exit("No League client found; pass --root")
    final = os.path.join(args.root, "Game", "DATA", "FINAL")
    total = count = 0
    seen = set()
    for pattern, paths in WANTED:
        rx = [re.compile(p, re.I) for p in paths]
        for wad_path in sorted(glob.glob(os.path.join(final, pattern))):
            names = default_hashfile(wad_path).load()
            wad = Wad(wad_path)
            with open(wad_path, "rb") as fh:
                for f in wad.files:
                    name = names.get(f.path_hash)
                    if not name or name in seen or SKIN.search(name) or not any(r.search(name) for r in rx):
                        continue
                    seen.add(name)
                    data = f.read_data(fh)
                    count += 1
                    total += len(data)
                    if args.list:
                        print(f"{len(data):>10}  {os.path.relpath(wad_path, final)}  {name}")
                        continue
                    dest = os.path.join(args.out, name)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, "wb") as out:
                        out.write(data)
    if not args.list:
        with open(os.path.join(args.root, "Game", "content-metadata.json")) as f:
            version = json.load(f).get("version")
        with open(os.path.join(args.out, "_source.json"), "w") as f:
            json.dump({"version": version, "files": count}, f)
    print(f"{count} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
