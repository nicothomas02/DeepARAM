#!/usr/bin/env python3
"""Build the 3D replay's Howling Abyss floor (viewer/models3d.js draws it under the fighters).

Reads the map's geometry and materials from a client export (dump_map_assets.py output), keeps the
lane and what stands near it, and writes one compressed glTF file with the map's own textures and its
baked lighting:

    python3 simulator/tools/build_map3d.py EXPORT_DIR [--out web/public/assets/map3d]

Requires: pip install pyritofile cdtb pillow numpy, `cdtb fetch-hashes`, and npx (gltf-transform
compresses the result). Textures and light maps are fetched once as PNG and cached in
~/.cache/deeparam-map. Base map only.

The file is in lane units: x runs along the lane from the blue side to the red side, with 0 where
the simulator's fights start; z runs across it (positive toward the camera); y is height above the
lane floor. One unit is one game unit.
"""
import argparse, io, json, os, re, struct, subprocess, sys, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CACHE = os.path.expanduser("~/.cache/deeparam-map")
ART = "https://raw.communitydragon.org/latest/game/"
GEO = "data/maps/mapgeometry/map12/base.mapgeo"
MATS = "data/maps/mapgeometry/map12/base.materials.bin"

# The lane: its middle and its direction (blue to red), in game coordinates (x east, z north).
CENTER = (6560.0, 6620.0)
FIGHT_START = -1600.0       # the simulator's x = 0, measured along the lane from its middle
ALONG = (-9000.0, 9000.0)   # how much of the lane is kept, from its middle
ACROSS = 2600.0             # and how far to each side
TEX_MAX = 512               # longest side of a material's texture
LIGHT_MAX = 1024            # and of a light map


def load_mapgeo(path):
    """The map's models. pyritofile keeps only the last vertex stream of a model drawn from several
    (positions and texture coordinates are separate streams), so a vertex keeps every stream's values."""
    import pyritofile, pyritofile.mapgeo as pm

    class Vertex:
        __slots__ = ("_v",)

        def __init__(self, value=None):
            self._v = value

        def _set(self, v):
            if self._v is None or v:
                self._v = v

        value = property(lambda s: s._v, _set)

    pm.MAPGEOVertex = Vertex
    m = pyritofile.MAPGEO()
    m.read(path)
    return m


def load_materials(path):
    """Material name -> {texture, alpha} for materials drawn with a plain texture."""
    from cdtb.binfile import BinFile
    out = {}
    for e in BinFile(path).entries:
        s = e.to_serializable()
        if not isinstance(s, dict) or not s.get("name"):
            continue
        tex = None
        for sv in s.get("samplerValues") or []:
            if sv.get("TextureName") in ("DiffuseTexture", "Diffuse_Texture", "BaseTexture") and sv.get("texturePath"):
                tex = sv["texturePath"]
                break
        if not tex:
            continue
        params = {p.get("name"): p.get("value") for p in s.get("paramValues") or []}
        shaders = " ".join(p.get("shader", "") for t in s.get("techniques") or [] for p in t.get("passes") or [])
        out[s["name"].lower()] = {
            "texture": tex.lower(),
            "alpha": "AlphaTestValue" in params or "alpha" in shaders.lower(),
            "tint": params.get("TintColor"),
            "unlit": "NO_BAKED_LIGHTING" in json.dumps(s),
        }
    return out


def fetch_png(path):
    """A client texture as an RGBA image, from the PNG copy of it."""
    rel = re.sub(r"\.(tex|dds)$", ".png", path.lower())
    cached = os.path.join(CACHE, rel)
    if not os.path.exists(cached):
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        try:
            with urllib.request.urlopen(urllib.request.Request(ART + rel, headers={"User-Agent": "deeparam-build"}), timeout=60) as r:
                data = r.read()
        except Exception as e:
            print(f"  missing texture {rel}: {e}")
            return None
        with open(cached, "wb") as f:
            f.write(data)
    return Image.open(cached).convert("RGBA")


def webp(img, longest, alpha):
    if max(img.size) > longest:
        k = longest / max(img.size)
        img = img.resize((max(4, round(img.width * k)), max(4, round(img.height * k))), Image.LANCZOS)
    b = io.BytesIO()
    (img if alpha else img.convert("RGB")).save(b, "WEBP", quality=82, method=6)
    return b.getvalue()


def vec(v, n):
    return (v.x, v.y, v.z)[:n] if hasattr(v, "x") else tuple(v)[:n]


def build(export, out_dir):
    geo = load_mapgeo(os.path.join(export, GEO))
    mats = load_materials(os.path.join(export, MATS))
    # Game coordinates are left-handed; the viewer's are right-handed, so x is mirrored (-x).
    s2 = 2 ** -0.5
    d = np.array([-s2, 0, s2])           # along the lane, blue to red
    n = np.array([-s2, 0, -s2])          # across it, toward the camera
    c = np.array([-CENTER[0], 0, CENTER[1]])

    groups = {}  # (material, light map) -> lists
    floor = []
    for model in geo.models:
        if not model.vertices or "Position" not in model.vertices[0].value:
            continue
        light = model.baked_light.path.lower() if model.baked_light.path else ""
        ls, lo = model.baked_light.scale, model.baked_light.offset
        P = np.array([vec(v.value["Position"], 3) for v in model.vertices], dtype=np.float64)
        P[:, 0] = -P[:, 0]
        rel = P - c
        lane = np.stack([rel @ d - FIGHT_START, P[:, 1], rel @ n], axis=1)
        uv0 = np.array([vec(v.value["Texcoord0"], 2) for v in model.vertices], dtype=np.float32)
        if "Texcoord7" in model.vertices[0].value and light:
            uv1 = np.array([vec(v.value["Texcoord7"], 2) for v in model.vertices], dtype=np.float32)
            uv1 = uv1 * np.array(ls, dtype=np.float32) + np.array(lo, dtype=np.float32)
        else:
            uv1, light = None, ""
        idx = np.array(model.indices, dtype=np.int64)
        for sm in model.submeshes:
            mat = mats.get(sm.name.lower())
            if not mat:
                continue
            tri = idx[sm.index_start:sm.index_start + sm.index_count].reshape(-1, 3)
            cen = lane[tri].mean(axis=1)
            keep = (cen[:, 0] - FIGHT_START > ALONG[0]) & (cen[:, 0] - FIGHT_START < ALONG[1]) & (np.abs(cen[:, 2]) < ACROSS)
            tri = tri[keep]
            if not len(tri):
                continue
            used, inv = np.unique(tri, return_inverse=True)
            g = groups.setdefault((sm.name.lower(), light if not mat["unlit"] else ""), {"p": [], "uv0": [], "uv1": [], "i": [], "n": 0})
            g["p"].append(lane[used])
            g["uv0"].append(uv0[used])
            g["uv1"].append(uv1[used] if uv1 is not None else np.zeros((len(used), 2), np.float32))
            # Mirroring x turns each triangle inside out: swap two corners back.
            g["i"].append(inv.reshape(-1, 3)[:, [0, 2, 1]] + g["n"])
            g["n"] += len(used)
            if abs(cen[keep][:, 2]).size:
                near = lane[used][np.abs(lane[used][:, 2]) < 400]
                if len(near):
                    floor.append(near[:, 1])
    ground = float(np.median(np.concatenate(floor))) if floor else 0.0
    print(f"{len(groups)} material groups, lane floor at y = {ground:.1f}")

    textures = sorted({mats[m]["texture"] for m, _ in groups})
    lights = sorted({l for _, l in groups if l})
    with ThreadPoolExecutor(8) as ex:
        timg = dict(zip(textures, ex.map(fetch_png, textures)))
        limg = dict(zip(lights, ex.map(fetch_png, lights)))

    # ---------- glTF ----------
    bin_parts, views, accessors, images, gl_textures, materials, prims = [], [], [], [], [], [], []
    offset = 0

    def add_view(data, target=None):
        nonlocal offset
        pad = (-len(data)) % 4
        bin_parts.append(data + b"\0" * pad)
        v = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        offset += len(data) + pad
        return len(views) - 1

    def add_accessor(arr, kind, target):
        arr = np.ascontiguousarray(arr)
        comp = {np.float32: 5126, np.uint32: 5125}[arr.dtype.type]
        a = {"bufferView": add_view(arr.tobytes(), target), "componentType": comp, "count": len(arr), "type": kind}
        if kind == "VEC3":
            a["min"] = arr.min(axis=0).tolist()
            a["max"] = arr.max(axis=0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    tex_index = {}

    def add_texture(key, img, longest, alpha):
        if key in tex_index:
            return tex_index[key]
        if img is None:
            tex_index[key] = None
            return None
        iv = add_view(webp(img, longest, alpha))
        images.append({"bufferView": iv, "mimeType": "image/webp"})
        gl_textures.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(images) - 1}}})
        tex_index[key] = len(gl_textures) - 1
        return tex_index[key]

    for (mname, light), g in sorted(groups.items()):
        mat = mats[mname]
        alpha = mat["alpha"]
        t = add_texture(mat["texture"], timg.get(mat["texture"]), TEX_MAX, alpha)
        if t is None:
            continue
        p = np.concatenate(g["p"]).astype(np.float32)
        p[:, 1] -= ground
        attrs = {"POSITION": add_accessor(p, "VEC3", 34962),
                 "TEXCOORD_0": add_accessor(np.concatenate(g["uv0"]).astype(np.float32), "VEC2", 34962)}
        m = {"name": mname.rsplit("/", 1)[-1], "pbrMetallicRoughness": {"baseColorTexture": {"index": t},
             "metallicFactor": 0, "roughnessFactor": 1}, "doubleSided": True}
        if alpha:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.3
        if light:
            lt = add_texture(light, limg.get(light), LIGHT_MAX, False)
            if lt is not None:
                attrs["TEXCOORD_1"] = add_accessor(np.concatenate(g["uv1"]).astype(np.float32), "VEC2", 34962)
                # The baked lighting: the viewer multiplies the texture by it (three.js lightMap, second UV set).
                m["occlusionTexture"] = {"index": lt, "texCoord": 1}
        materials.append(m)
        prims.append({"attributes": attrs, "indices": add_accessor(np.concatenate(g["i"]).astype(np.uint32).ravel(), "SCALAR", 34963),
                      "material": len(materials) - 1})

    blob = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "build_map3d.py"},
        "extensionsUsed": ["EXT_texture_webp"],
        "extensionsRequired": ["EXT_texture_webp"],
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "howling-abyss", "mesh": 0}],
        "meshes": [{"primitives": prims}],
        "materials": materials, "textures": gl_textures, "images": images,
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    glb = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    glb += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob

    os.makedirs(out_dir, exist_ok=True)
    final = os.path.join(out_dir, "howling-abyss.glb")
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "raw.glb")
        with open(raw, "wb") as f:
            f.write(glb)
        # Quantize and compress the geometry (the viewer decodes it with the meshopt decoder).
        subprocess.run(["npx", "--yes", "@gltf-transform/cli@4", "meshopt", raw, final], check=True)
    print(f"{final}: {os.path.getsize(final) / 1e6:.1f} MB ({len(blob) / 1e6:.1f} MB before compression)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("export", help="dump_map_assets.py output")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "assets", "map3d"))
    args = ap.parse_args()
    build(args.export, args.out)


if __name__ == "__main__":
    main()
