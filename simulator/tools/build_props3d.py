#!/usr/bin/env python3
"""Build the 3D replay's Howling Abyss props (viewer/models3d.js places them on the map).

Turns animated characters from a client export (dump_map_assets.py output) into compressed glTF files
with their animations, and writes props.json, which says where each one stands on the lane:

    python3 simulator/tools/build_props3d.py EXPORT_DIR [--out web/public/assets/map3d]

Requires: pip install pyritofile pillow numpy, and npx (gltf-transform compresses the result). Textures
are fetched once as PNG and cached in ~/.cache/deeparam-map. Base skins only.

It also builds the models of the summons the simulator records (Annie's Tibbers, Viego's souls) and
writes summons.json, which the replay reads to show them (viewer/models3d.js, "summon:<name>"), with each
one's HUD icon (<name>.png) for the 2D replay.

Positions are in lane units, as the map (build_map3d.py): x along the lane from where the simulator's
fights start, z across it (positive toward the camera), one game unit each. The lane is 550 units each
side of its middle; props stand at its edges.
"""
import argparse, io, json, os, re, struct, subprocess, sys, tempfile, urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_map3d import fetch_png  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
TEX_MAX = 512

# name -> (character folder, mesh, skeleton, texture, {clip: animation file})
# The base skin's size (its skin file isn't exported): bridge Poros stand about a third of a champion's height.
SCALE = {"poro": 0.4}
MODELS = {
    "poro": ("assets/characters/ha_ap_poro/skins/base", "ha_ap_poro.skn", "ha_ap_poro.skl", "ha_ap_poro_2.tex",
             {"idle": "poro_idle1.anm", "idle2": "poro_idle2.anm", "idle3": "poro_idle3.anm", "idle4": "poro_idle4.anm",
              "eat": "pet_poro_eat.anm", "jump": "poro_jump.anm"}),
}
# Where they stand, by hand from the map: Poros just inside the bridge's edges, where the replay's view
# still shows them (it sees about 600 units above the lane's middle and 500 below).
PLACES = [
    {"model": "poro", "x": -700, "z": -560, "yaw": 150, "clips": ["idle", "idle2", "eat"]},
    {"model": "poro", "x": 350, "z": 470, "yaw": -20, "clips": ["idle3", "idle"]},
    {"model": "poro", "x": 1250, "z": -570, "yaw": 200, "clips": ["idle4", "idle", "jump"]},
    {"model": "poro", "x": 2300, "z": 480, "yaw": 15, "clips": ["idle2", "eat", "idle"]},
    {"model": "poro", "x": 3400, "z": -560, "yaw": 170, "clips": ["idle", "idle3"]},
    {"model": "poro", "x": 4700, "z": 470, "yaw": -30, "clips": ["eat", "idle4"]},
]


# Summons the simulator records (trace "summon" events, x = the name here). The clip files and texture are
# under the folder unless given as a full path (Viego's souls use Senna's soul mesh, animations and texture).
# Base-skin scale and HUD icon from each one's skin0 bin. Clips are named by the replay's roles.
SUMMONS = {
    "tibbers": ("assets/characters/annietibbers/skins/base", "annietibbers.skn", "annietibbers.skl", "annietibbers_cm.tex",
                {"idle": "annietibbers_idle1.anm", "attack": "annietibbers_attack1.anm", "attack2": "annietibbers_attack2.anm",
                 "run": "annietibbers_run.anm", "respawn": "annietibbers_spawn.anm", "death": "annietibbers_death.anm"},
                1.2, "assets/characters/annietibbers/hud/bear_circle.tex", None),
    "viegosoul": ("assets/characters/kiwi_viegosoul/skins/base", "senna_base_soul.skn", "senna_base_soul.skl",
                  "assets/characters/senna/skins/base/senna_base_minor_wraith_tx_cm.tex",
                  {"idle": "assets/characters/sennasoul/skins/base/animations/senna_soul_idle.anm",
                   "respawn": "assets/characters/sennasoul/skins/base/animations/senna_soul_appear.anm",
                   "death": "assets/characters/sennasoul/skins/base/animations/senna_soul_death.anm"},
                  1.3, "assets/characters/viegosoul/hud/viegosoul_circle.tex", "#5fe0c0"),
}

# Summons with only an icon so far (Ivern's Daisy: her skeleton and animations aren't in the export yet).
SUMMON_ICONS = {"daisy": "assets/characters/ivernminion/hud/daisy_circle.tex"}


def elf(name):
    h = 0
    for c in name.lower().encode():
        h = (h << 4) + c
        g = h & 0xF0000000
        if g:
            h ^= g >> 24
        h &= ~g
    return h & 0xFFFFFFFF


def v3(v):
    return [v.x, v.y, v.z]


def quat(q):
    return [q.x, q.y, q.z, q.w]


# The game's coordinates are left-handed and the viewer's right-handed: mirror x.
def mx(p):
    return [-p[0], p[1], p[2]]


def mq(q):
    return [q[0], -q[1], -q[2], q[3]]


def trs(t, r, s):
    x, y, z, w = r
    rot = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = rot * np.array(s)
    m[:3, 3] = t
    return m


def skinned_glb(export, rel, skn_name, skl_name, tex_name, clips):
    import pyritofile
    folder = os.path.join(export, rel)
    skn = pyritofile.SKN()
    skn.read(os.path.join(folder, skn_name))
    skl = pyritofile.SKL()
    skl.read(os.path.join(folder, skl_name))
    joints = skl.joints
    by_hash = {elf(j.name): i for i, j in enumerate(joints)}

    pos = np.array([mx(v3(v.position)) for v in skn.vertices], np.float32)
    nrm = np.array([mx(v3(v.normal)) for v in skn.vertices], np.float32)
    uv = np.array([[v.uv.x, v.uv.y] for v in skn.vertices], np.float32)
    jnt = np.array([[skl.influences[i] for i in v.influences] for v in skn.vertices], np.uint16)
    wgt = np.array([v.weights for v in skn.vertices], np.float32)
    wgt /= np.maximum(wgt.sum(axis=1, keepdims=True), 1e-6)
    jnt[wgt == 0] = 0
    idx = np.array(skn.indices, np.uint32).reshape(-1, 3)[:, [0, 2, 1]].ravel()  # mirrored: wind back

    S = np.diag([-1.0, 1, 1, 1])
    ibm = np.stack([(S @ trs(v3(j.ibind_translate), quat(j.ibind_rotate), v3(j.ibind_scale)) @ S).T for j in joints]).astype(np.float32)

    parts, views, accessors = [], [], []
    off = 0

    def view(data, target=None):
        nonlocal off
        pad = (-len(data)) % 4
        parts.append(data + b"\0" * pad)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        off += len(data) + pad
        return len(views) - 1

    def acc(arr, kind, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        comp = {np.float32: 5126, np.uint32: 5125, np.uint16: 5123}[arr.dtype.type]
        a = {"bufferView": view(arr.tobytes(), target), "componentType": comp, "count": len(arr), "type": kind}
        if minmax:
            a["min"] = np.atleast_1d(arr.min(axis=0)).tolist()
            a["max"] = np.atleast_1d(arr.max(axis=0)).tolist()
        accessors.append(a)
        return len(accessors) - 1

    nodes = []
    for i, j in enumerate(joints):
        nodes.append({"name": j.name, "translation": mx(v3(j.local_translate)), "rotation": mq(quat(j.local_rotate)),
                      "scale": v3(j.local_scale)})
    for i, j in enumerate(joints):
        if j.parent >= 0:
            nodes[j.parent].setdefault("children", []).append(i)
    roots = [i for i, j in enumerate(joints) if j.parent < 0]
    mesh_node = len(nodes)
    nodes.append({"name": "mesh", "mesh": 0, "skin": 0})
    top = len(nodes)
    nodes.append({"name": "model", "children": roots + [mesh_node]})

    attrs = {"POSITION": acc(pos, "VEC3", 34962, True), "NORMAL": acc(nrm, "VEC3", 34962),
             "TEXCOORD_0": acc(uv, "VEC2", 34962), "JOINTS_0": acc(jnt, "VEC4", 34962), "WEIGHTS_0": acc(wgt, "VEC4", 34962)}
    prim = {"attributes": attrs, "indices": acc(idx, "SCALAR", 34963), "material": 0}

    animations = []
    for clip, file in clips.items():
        anm = pyritofile.ANM()
        anm.read(os.path.join(export, file) if "/" in file else os.path.join(folder, "animations", file))
        fps = anm.fps or 30
        channels, samplers = [], []
        for t in anm.tracks:
            ji = by_hash.get(t.joint_hash)
            if ji is None or not t.poses:
                continue
            keys = sorted(t.poses)
            times = np.array(keys, np.float32) / fps
            ta = acc(times, "SCALAR", minmax=True)
            for path, get, fix in (("translation", lambda p: p.translate, lambda v: mx(v3(v))),
                                   ("rotation", lambda p: p.rotate, lambda v: mq(quat(v))),
                                   ("scale", lambda p: p.scale, lambda v: v3(v))):
                vals, last = [], None
                for k in keys:
                    v = get(t.poses[k])
                    last = fix(v) if v is not None else last
                    vals.append(last)
                if any(v is None for v in vals):
                    first = next((v for v in vals if v is not None), None)
                    if first is None:
                        continue
                    vals = [v if v is not None else first for v in vals]
                samplers.append({"input": ta, "output": acc(np.array(vals, np.float32), "VEC4" if path == "rotation" else "VEC3"),
                                 "interpolation": "LINEAR"})
                channels.append({"sampler": len(samplers) - 1, "target": {"node": ji, "path": path}})
        if channels:
            animations.append({"name": clip, "channels": channels, "samplers": samplers})

    img = fetch_png(tex_name if "/" in tex_name else rel + "/" + tex_name)
    b = io.BytesIO()
    if max(img.size) > TEX_MAX:
        img = img.resize((TEX_MAX, round(img.height * TEX_MAX / img.width)), Image.LANCZOS)
    img.convert("RGB").save(b, "WEBP", quality=85, method=6)
    iv = view(b.getvalue())

    ibm_acc = acc(ibm.reshape(-1, 16), "MAT4")
    blob = b"".join(parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "build_props3d.py"},
        "extensionsUsed": ["EXT_texture_webp"], "extensionsRequired": ["EXT_texture_webp"],
        "scene": 0, "scenes": [{"nodes": [top]}], "nodes": nodes,
        "meshes": [{"primitives": [prim]}],
        "skins": [{"joints": list(range(len(joints))), "inverseBindMatrices": ibm_acc}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1}}],
        "textures": [{"sampler": 0, "extensions": {"EXT_texture_webp": {"source": 0}}}],
        "images": [{"bufferView": iv, "mimeType": "image/webp"}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "animations": animations, "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    return (struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(blob)) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(blob), 0x004E4942) + blob)


def write_glb(glb, final):
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "raw.glb")
        with open(raw, "wb") as f:
            f.write(glb)
        subprocess.run(["npx", "--yes", "@gltf-transform/cli@4", "meshopt", raw, final], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("export", help="dump_map_assets.py output")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "assets", "map3d"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, (folder, skn, skl, tex, clips) in MODELS.items():
        final = os.path.join(args.out, name + ".glb")
        write_glb(skinned_glb(args.export, folder, skn, skl, tex, clips), final)
        print(f"{name}: {os.path.getsize(final) // 1024} KB")
    with open(os.path.join(args.out, "props.json"), "w") as f:
        json.dump({"v": 1, "models": {n: n + ".glb" for n in MODELS}, "scale": SCALE, "places": PLACES}, f, indent=1)
    summons = {}
    for name, (folder, skn, skl, tex, clips, scale, icon, tint) in SUMMONS.items():
        write_glb(skinned_glb(args.export, folder, skn, skl, tex, clips), os.path.join(args.out, name + ".glb"))
        img = fetch_png(icon)
        if img:
            img.resize((64, 64), Image.LANCZOS).save(os.path.join(args.out, name + ".png"), optimize=True)
        # The models are in game units; the replay's champion models are in hundredths of one.
        summons[name] = {"file": name + ".glb", "icon": name + ".png", "scale": round(scale / 100, 5),
                         "clips": {c: c for c in clips}, **({"tint": tint} if tint else {})}
        print(f"{name}: {os.path.getsize(os.path.join(args.out, name + '.glb')) // 1024} KB")
    for name, icon in SUMMON_ICONS.items():
        img = fetch_png(icon)
        if img:
            img.resize((64, 64), Image.LANCZOS).save(os.path.join(args.out, name + ".png"), optimize=True)
    with open(os.path.join(args.out, "summons.json"), "w") as f:
        json.dump(summons, f, indent=1)


if __name__ == "__main__":
    main()
