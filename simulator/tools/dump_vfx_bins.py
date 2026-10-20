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
        # The base skin's effects live in skin0.bin and the shared bins it links (which also
        # hold other skins' effects: only the systems skin0 names are kept).
        bins = [entries]
        for path in linked:
            data = read(path)
            if data is None:
                continue
            try:
                bins.append(read_bin(data)[0])
            except Exception:
                continue
        # The effect name map: in skin0.bin, or for some champions in a linked bin (the one named for skin 0).
        def resolvers(found):
            return [(k, v) for k, v in found.items() if isinstance(v, dict) and "resourceMap" in v]
        resolver = next((v for _, v in resolvers(entries)), None)
        if resolver is None:
            linked_ones = [kv for found in bins[1:] for kv in resolvers(found)]
            resolver = next((v for k, v in linked_ones if "skin0" in k.lower() or "/skin0" in k.lower()), None) \
                or next((v for _, v in linked_ones), {})
        names = resolver.get("resourceMap", {})
        if not names:
            # No readable name map: every base skin effect system, named after itself.
            for found in bins:
                for key, value in found.items():
                    low = key.lower().replace("\\", "/")
                    if isinstance(value, dict) and value.get("__type") == "VfxSystemDefinitionData" \
                            and ("/skins/skin0/" in low or "/skins/base/" in low or "_base_" in low):
                        names[key.rsplit("/", 1)[-1]] = key
        wanted = {str(v).lower() for v in names.values()}
        systems = {}
        for found in bins:
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


def dump_global(final, dest):
    """Effects shared by every champion (summoner spells like Flash, crowd control on a target, items):
    every effect system, effect name map and spell in Global.wad.client's shared, globals and items bins."""
    wad_path = os.path.join(final, "Global.wad.client")
    if not os.path.exists(wad_path):
        return "no Global.wad.client"
    from cdtb.hashes import default_hashfile
    names = default_hashfile(wad_path).load()  # path hash -> name (from `cdtb fetch-hashes`)
    keep = ("VfxSystemDefinitionData", "ResourceResolver", "SpellObject")
    out = {}
    with open(wad_path, "rb") as fh:
        for f in Wad(wad_path).files:
            name = names.get(f.path_hash, "")
            if not name.endswith(".bin") or not name.startswith(("data/shared", "data/globals", "data/items", "data/spells")):
                continue
            try:
                found, _ = read_bin(f.read_data(fh))
            except Exception:
                continue
            for key, value in found.items():
                if isinstance(value, dict) and value.get("__type") in keep:
                    out[key] = value
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    return f"{len(out)} entries"


def mesh_names(obj, out):
    """Every effect mesh path named in a dumped JSON value."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("mSimpleMeshName",) and isinstance(v, str):
                out.add(v.lower().replace("\\", "/"))
            else:
                mesh_names(v, out)
    elif isinstance(obj, list):
        for v in obj:
            mesh_names(v, out)


def dump_meshes(final, out):
    """The static meshes (.scb/.sco) the dumped effects and Mayhem's augment effects draw, raw, under
    OUT/meshes/<path>: base skin and shared paths only, read from the champion's WAD, Global or Map12."""
    wanted = {}  # path -> champion alias whose WAD to try first
    for name in os.listdir(out):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(out, name)) as f:
            found = set()
            mesh_names(json.load(f), found)
        for p in found:
            if "/skins/skin" in p and "/skins/base/" not in p:
                continue
            wanted.setdefault(p, None if name.startswith("_") else name[:-5])
    map12 = os.path.join(final, "Maps", "Shipping", "Map12.wad.client")
    if os.path.exists(map12):
        data = Wad(map12)
        with open(map12, "rb") as fh:
            for f in data.files:
                if f.path_hash == path_hash("maps/modespecificdata/kiwi.bin"):
                    try:
                        found = set()
                        mesh_names(read_bin(f.read_data(fh))[0], found)
                        for p in found:
                            wanted.setdefault(p, None)
                    except Exception:
                        pass
    wads = {}

    def files_of(path):
        if path not in wads:
            wads[path] = {f.path_hash: f for f in Wad(path).files} if os.path.exists(path) else {}
        return wads[path]

    got = missing = size = 0
    for p, alias in sorted(wanted.items()):
        sources = []
        if alias:
            sources += glob.glob(os.path.join(final, "Champions", "*.wad.client"))
            sources = [w for w in sources if os.path.basename(w).lower() == alias + ".wad.client"]
        sources += [os.path.join(final, "Global.wad.client"), map12]
        data = None
        for w in sources:
            entry = files_of(w).get(path_hash(p))
            if entry:
                with open(w, "rb") as fh:
                    data = entry.read_data(fh)
                break
        if data is None:
            missing += 1
            continue
        dest = os.path.join(out, "meshes", p)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        got += 1
        size += len(data)
    return f"{got} meshes ({size / 1e6:.1f} MB), {missing} missing"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("out")
    ap.add_argument("--root", default=client_root())
    ap.add_argument("--only", nargs="*", help="champion aliases (default: all)")
    ap.add_argument("--meshes-only", action="store_true", help="only add the meshes and shared effects to an existing dump")
    args = ap.parse_args()
    if not args.root:
        sys.exit("No League client found; pass --root")
    final = os.path.join(args.root, "Game", "DATA", "FINAL", "Champions")
    wads = {os.path.basename(p)[:-len(".wad.client")].lower(): p
            for p in glob.glob(os.path.join(final, "*.wad.client"))
            if "." not in os.path.basename(p)[:-len(".wad.client")]}
    aliases = sorted(a for a in (args.only or wads) if a in wads)
    jobs = [] if args.meshes_only else [(wads[a], a, os.path.join(args.out, f"{a}.json")) for a in aliases]
    with ProcessPoolExecutor() as ex:
        for alias, note in ex.map(dump_champion, jobs):
            print(f"{alias}: {note}")
    print("global:", dump_global(os.path.dirname(final), os.path.join(args.out, "_global.json")))
    print("meshes:", dump_meshes(os.path.dirname(final), args.out))
    with open(os.path.join(args.root, "Game", "content-metadata.json")) as f:
        version = json.load(f).get("version")
    with open(os.path.join(args.out, "_source.json"), "w") as f:
        json.dump({"version": version, "root": os.path.basename(os.path.dirname(os.path.dirname(args.root)))}, f)
    print("client", version)


if __name__ == "__main__":
    main()
