"""Dump each champion's base-skin ability effect definitions from the installed League client.

The replay's 3D edition draws each ability with the art the game uses for it. Which textures,
colors, sizes and timings an ability's effect uses is defined in the champion's skin bins
(skin0.bin and the shared bins it links), which only the client's WAD archives hold. This reads
them and writes one JSON per champion: the base skin's effect name map and every effect system
it names. build_vfx.py turns those into the replay's effect files.

Usage: python3 simulator/tools/dump_vfx_bins.py OUT_DIR [--root CLIENT_ROOT]
CLIENT_ROOT holds Game/ (on macOS ".../League of Legends.app/Contents/LoL"); the live client is
used when installed, else PBE. Requires: pip install cdtb zstandard xxhash, then `cdtb fetch-hashes`.
Base skin only: no other skin's bins are read.
"""
import argparse, glob, io, json, os, struct, sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "datamine"))
from local import MAC, WIN, path_hash  # noqa: E402
from cdtb.wad import Wad  # noqa: E402
from cdtb.binfile import BinReader  # noqa: E402


def client_root():
    for base in (MAC, WIN):
        for suffix in ("", " (PBE)"):
            root = base.format(suffix)
            if os.path.isdir(os.path.join(root, "Game")):
                return root
    return None


def plain(v):
    """cdtb's serializable form, with anything left over (paths, hashes) as strings."""
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return str(v)


def read_bin(data):
    """{entry path: entry} and the linked bin paths of one .bin; unreadable entries are skipped."""
    f = io.BytesIO(data)
    magic = f.read(4)
    if magic == b"PTCH":
        f.read(8)
        magic = f.read(4)
    if magic != b"PROP":
        raise ValueError("not a bin file")
    reader = BinReader(f)
    _, linked, types = reader.read_binfile_header()
    out = {}
    for htype in types:
        start = f.tell()
        length, = struct.unpack("<L", f.read(4))
        f.seek(start)
        try:
            entry = reader.read_binfile_entry(htype)
        except Exception:
            f.seek(start + 4 + length)
            continue
        out[str(entry.path.to_serializable())] = plain(entry.to_serializable())
    return out, list(linked or [])


def dump_champion(args):
    wad_path, alias, dest = args
    wad = Wad(wad_path)
    by_hash = {f.path_hash: f for f in wad.files}
    with open(wad_path, "rb") as fh:
        def read(path):
            entry = by_hash.get(path_hash(path))
            return entry.read_data(fh) if entry else None

        skin = read(f"data/characters/{alias}/skins/skin0.bin")
        if skin is None:
            return alias, "no skin0.bin"
        entries, linked = read_bin(skin)
        resolver = next((v for v in entries.values() if isinstance(v, dict) and "resourceMap" in v), {})
        names = resolver.get("resourceMap", {})
        wanted = {str(v).lower() for v in names.values()}
        systems = {}
        # The base skin's effects live in skin0.bin and the shared bins it links (which also
        # hold other skins' effects: only the systems skin0 names are kept).
        for path in [None] + linked:
            if path is None:
                found = entries
            else:
                data = read(path)
                if data is None:
                    continue
                try:
                    found, _ = read_bin(data)
                except Exception:
                    continue
            for key, value in found.items():
                if key.lower() in wanted:
                    systems[key] = value
        # The champion bin's spells say which effect key each ability's missile uses.
        champ = read(f"data/characters/{alias}/{alias}.bin")
        spells = {}
        if champ is not None:
            try:
                found, _ = read_bin(champ)
                spells = {k: v for k, v in found.items() if isinstance(v, dict) and v.get("__type") == "SpellObject"}
            except Exception:
                pass
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({"alias": alias, "resourceMap": names, "systems": systems, "spells": spells}, f, separators=(",", ":"))
    return alias, f"{len(systems)}/{len(names)} systems"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out")
    ap.add_argument("--root", default=client_root())
    ap.add_argument("--only", nargs="*", help="champion aliases (default: all)")
    args = ap.parse_args()
    if not args.root:
        sys.exit("No League client found; pass --root")
    final = os.path.join(args.root, "Game", "DATA", "FINAL", "Champions")
    wads = {os.path.basename(p)[:-len(".wad.client")].lower(): p
            for p in glob.glob(os.path.join(final, "*.wad.client"))
            if "." not in os.path.basename(p)[:-len(".wad.client")]}
    aliases = sorted(a for a in (args.only or wads) if a in wads)
    jobs = [(wads[a], a, os.path.join(args.out, f"{a}.json")) for a in aliases]
    with ProcessPoolExecutor() as ex:
        for alias, note in ex.map(dump_champion, jobs):
            print(f"{alias}: {note}")
    with open(os.path.join(args.root, "Game", "content-metadata.json")) as f:
        version = json.load(f).get("version")
    with open(os.path.join(args.out, "_source.json"), "w") as f:
        json.dump({"version": version, "root": os.path.basename(os.path.dirname(os.path.dirname(args.root)))}, f)
    print("client", version)


if __name__ == "__main__":
    main()
