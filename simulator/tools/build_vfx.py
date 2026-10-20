#!/usr/bin/env python3
"""Build the 3D replay's ability effect files (viewer/effects3d.js reads them).

Reads each champion's base-skin effect definitions (the JSON files dump_vfx_bins.py writes from the
client) and Mayhem's augment effects, keeps the parts the replay can draw (textured particles that face
the camera, flat quads, static meshes, trail streaks), and writes per champion a small JSON recipe and
one texture atlas:

    python3 simulator/tools/build_vfx.py DUMP_DIR [--out web/public/assets/vfx] [--only ahri zed]

DUMP_DIR holds <alias>.json per champion, optionally _global.json (shared effects) and meshes/
(the .scb/.sco meshes those effects use). Textures are fetched once and cached in
~/.cache/deeparam-vfx. Base skin only: no other skin's effects are read.
"""
import argparse, io, json, math, os, re, struct, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CACHE = os.path.expanduser("~/.cache/deeparam-vfx")
ART = "https://raw.communitydragon.org/latest/game/"
KIWI = ART + "maps/modespecificdata/kiwi.bin.json"
SLOTS = "QWER"
MAX_EMITTERS = 14       # per effect, the biggest ones first
MAX_PER_EMITTER = 48    # particles alive at once from one emitter
TEX_MAX = 128           # longest side of a plain texture in the atlas (flipbook frames get up to 96 each)
ATLAS_W = 1024

# ---------- reading values ----------

def const(v, default=None):
    """A Value* field's base value: its constant, else its first keyed value, else the default."""
    if v is None:
        return default
    if isinstance(v, (int, float, list)):
        return v
    if isinstance(v, dict):
        if "constantValue" in v:
            return v["constantValue"]
        dyn = v.get("dynamics") or {}
        vals = dyn.get("values")
        if vals:
            return vals[0]
    return default


def curve(v, n=1):
    """A Value* field over a particle's life: [[t, v...], ...] (None when it doesn't change)."""
    if not isinstance(v, dict):
        return None
    dyn = v.get("dynamics") or {}
    times, vals = dyn.get("times"), dyn.get("values")
    if not times or not vals or len(times) < 2:
        return None
    out = []
    for t, x in zip(times, vals):
        x = x if isinstance(x, list) else [x]
        out.append([round(float(t), 3)] + [round(float(c), 4) for c in x[:n]])
    return out


def rand_span(v, i):
    """How far a birth value is randomised on component i: (low, high) multipliers, or None."""
    if not isinstance(v, dict):
        return None
    tables = (v.get("dynamics") or {}).get("probabilityTables") or []
    if i >= len(tables):
        return None
    keys = tables[i].get("keyValues")
    if not keys:
        return None
    return min(keys), max(keys)


def spread(v):
    """A birth vector with random ranges: (centre, half-range per axis)."""
    base = vec3(v)
    c, h = [], []
    for i in range(3):
        r = rand_span(v, i)
        lo, hi = r if r else (1, 1)
        c.append(round(base[i] * (lo + hi) / 2, 1))
        h.append(round(abs(base[i]) * (hi - lo) / 2, 1))
    return c, h


def vec3(v, default=(0.0, 0.0, 0.0)):
    x = const(v, None)
    if isinstance(x, list) and len(x) >= 3:
        return [float(x[0]), float(x[1]), float(x[2])]
    if isinstance(x, (int, float)):
        return [float(x)] * 3
    return list(default)


def num(v, default=0.0):
    x = const(v, default)
    if isinstance(x, list):
        x = x[0] if x else default
    return float(x) if x is not None else default


# ---------- art ----------

def art_url(path):
    """A game texture or mesh path as the mirror stores it (textures as PNG)."""
    p = path.lower().replace("\\", "/")
    if p.endswith((".tex", ".dds")):
        p = p[:-4] + ".png"
    return ART + p


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    name = os.path.join(CACHE, re.sub(r"[^a-z0-9._-]+", "_", url.split("/game/", 1)[-1]))
    if os.path.exists(name):
        with open(name, "rb") as f:
            data = f.read()
        return data or None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "deeparam-build"})
        data = urllib.request.urlopen(req, timeout=60).read()
    except Exception:
        data = b""
    with open(name, "wb") as f:
        f.write(data)
    return data or None


def load_texture(path):
    data = fetch(art_url(path))
    if not data:
        return None
    try:
        return Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        return None


def gradient(path, n=6):
    """A colour-over-life texture sampled along its middle row: [[t, r, g, b, a], ...]."""
    im = load_texture(path)
    if im is None:
        return None
    w, h = im.size
    out = []
    for i in range(n):
        t = i / (n - 1)
        r, g, b, a = im.getpixel((min(w - 1, int(t * (w - 1))), h // 2))
        out.append([round(t, 3), r / 255, g / 255, b / 255, a / 255])
    return out


# ---------- meshes ----------

def read_mesh(data):
    """Static mesh (.scb binary or .sco text) -> (positions, uvs, triangle indices), or None."""
    try:
        if data[:8] == b"r3d2Mesh":
            f = io.BytesIO(data)
            f.read(8)
            major, minor = struct.unpack("<HH", f.read(4))
            f.read(128)  # object name
            nv, nf, flags = struct.unpack("<III", f.read(12))
            f.read(24)   # bounding box
            vtype = struct.unpack("<I", f.read(4))[0] if (major, minor) >= (3, 2) else 0
            verts = [struct.unpack("<3f", f.read(12)) for _ in range(nv)]
            if vtype == 1:
                f.read(4 * nv)  # vertex colours
            f.read(12)  # centre
            pos, uvs, idx = [], [], []
            for _ in range(nf):
                a, b, c = struct.unpack("<3I", f.read(12))
                f.read(64)  # material name
                u = struct.unpack("<6f", f.read(24))
                for k, vi in enumerate((a, b, c)):
                    pos.append(verts[vi])
                    uvs.append((u[k], u[k + 3]))
                    idx.append(len(idx))
            return pos, uvs, idx
        text = data.decode("latin-1")
        if "[ObjectBegin]" in text:
            lines = [l.strip() for l in text.splitlines()]
            i = next(k for k, l in enumerate(lines) if l.startswith("Verts="))
            nv = int(lines[i].split("=")[1])
            verts = [tuple(map(float, lines[i + 1 + k].split()[:3])) for k in range(nv)]
            j = next(k for k, l in enumerate(lines) if l.startswith("Faces="))
            nf = int(lines[j].split("=")[1])
            pos, uvs, idx = [], [], []
            for k in range(nf):
                parts = lines[j + 1 + k].split()
                a, b, c = int(parts[1]), int(parts[2]), int(parts[3])
                u = list(map(float, parts[5:11]))
                for m, vi in enumerate((a, b, c)):
                    pos.append(verts[vi])
                    uvs.append((u[m * 2], u[m * 2 + 1]))
                    idx.append(len(idx))
            return pos, uvs, idx
    except Exception:
        return None
    return None


def pack_mesh(mesh):
    pos, uvs, idx = mesh
    # Welded back where corners match, so shared edges don't double the size.
    seen, P, U, I = {}, [], [], []
    for p, u in zip(pos, uvs):
        key = (round(p[0], 1), round(p[1], 1), round(p[2], 1), round(u[0], 3), round(u[1], 3))
        if key not in seen:
            seen[key] = len(P)
            P.append(list(key[:3]))
            U.append(list(key[3:]))
        I.append(seen[key])
    return {"p": [c for v in P for c in v], "uv": [c for v in U for c in v], "i": I}


# ---------- emitters ----------

SKIP_TEX = re.compile(r"distort|normal|_nm\b|refract|heat", re.I)
SKIP_EMITTER = re.compile(r"indicator|(^|_)range(_|$)|team_?(red|blue)|(^|_)(red|blue)(_|$)", re.I)


def convert_emitter(e, ctx):
    """One emitter as the viewer draws it, or None when it isn't something the replay can draw."""
    if e.get("disabled") or not isinstance(e, dict):
        return None
    prim = e.get("primitive") or {}
    ptype = prim.get("__type") if isinstance(prim, dict) else None
    tex = e.get("texture")
    # Rays (light shafts and shimmer streaks) can't be drawn faithfully without their stretch rules.
    if ptype in ("VfxPrimitiveNonRenderable", "VfxPrimitiveAttachedMesh", "VfxPrimitiveBeam", "VfxPrimitiveRay") \
            or "distortionDefinition" in e or SKIP_EMITTER.search(str(e.get("emitterName") or "")):
        return None
    if not tex or SKIP_TEX.search(tex):
        return None
    kind = "b"  # camera-facing billboard
    mesh = None
    if ptype == "VfxPrimitiveArbitraryQuad":
        kind = "q"
    elif ptype == "VfxPrimitivePlanarProjection":
        kind = "g"
    elif ptype in ("VfxPrimitiveArbitraryTrail", "VfxPrimitiveCameraTrail"):
        kind = "t"
    elif ptype == "VfxPrimitiveMesh":
        name = ((prim.get("mMesh") or {}).get("mSimpleMeshName") or "")
        mesh = ctx.mesh(name) if name else None
        if mesh is None:
            return None
        kind = "m"
    frame = ctx.texture(tex, e.get("texDiv"))
    if frame is None:
        return None

    out = {"k": kind, "f": frame}
    blend = e.get("blendMode")
    out["b"] = 1 if blend in (1, 3) else 0   # 1: alpha (smoke, dirt), 0: additive (glows, sparks)

    # Timing.
    single = bool(e.get("isSingleParticle"))
    rate = num(e.get("rate"), 1.0)
    life = num(e.get("particleLifetime"), -1.0)
    span = e.get("lifetime")
    span = float(span) if isinstance(span, (int, float)) else None
    out["delay"] = round(float(e.get("timeBeforeFirstEmission") or 0), 3)
    if single:
        out["count"] = max(1, min(8, int(round(rate)) or 1))
        out["rate"] = 0
        out["dur"] = 0
        if life <= 0:
            life = span if span and span > 0 else -1
    else:
        out["dur"] = round(span, 3) if span and span > 0 else -1
        if life <= 0:
            life = 1.0
        rate = max(0.0, rate)
        if rate <= 0:
            return None
        # No more than MAX_PER_EMITTER alive at once.
        rate = min(rate, MAX_PER_EMITTER / max(0.05, life))
        out["rate"] = round(rate, 3)
    out["life"] = round(life, 3)

    # Size: quads span twice their scale; meshes scale their vertices.
    sc = vec3(e.get("birthScale0"), (1, 1, 1))
    if e.get("isUniformScale"):
        sc = [sc[0]] * 3
    if kind == "m":
        out["size"] = [round(c, 3) for c in sc]
    else:
        out["size"] = [round(sc[0] * 2, 2), round((sc[1] if sc[1] else sc[0]) * 2, 2)]
    s_curve = curve(e.get("scale0"), 3)
    if s_curve:
        out["st"] = [[p[0], p[1]] for p in s_curve]
    elif isinstance(const(e.get("scale0")), list):
        m = const(e.get("scale0"))[0]
        if m not in (None, 1, 1.0):
            out["size"] = [round(c * m, 3) for c in out["size"]]
    # Random size: a range of multipliers on width (and height, unless it's uniform).
    sx, sy = rand_span(e.get("birthScale0"), 0), rand_span(e.get("birthScale0"), 1)
    if e.get("isUniformScale"):
        sy = sx
    if sx and sx != (1, 1):
        out["sv"] = [round(sx[0], 3), round(sx[1], 3)]
    if sy and sy != (1, 1) and kind != "m":
        out["svy"] = [round(sy[0], 3), round(sy[1], 3)]

    # Colour: the birth colour times the colour over life (and a colour-over-life texture).
    birth = const(e.get("birthColor"), [1, 1, 1, 1]) or [1, 1, 1, 1]
    over = curve(e.get("Color") or e.get("color"), 4)
    if not over:
        c = const(e.get("Color") or e.get("color"), [1, 1, 1, 1]) or [1, 1, 1, 1]
        over = [[0, *c[:4]], [1, *c[:4]]]
    grad = gradient(e["particleColorTexture"]) if e.get("particleColorTexture") else None
    col = []
    for p in over:
        t = p[0]
        c = [birth[i] * p[1 + i] for i in range(4)]
        if grad:
            g = sample(grad, t)
            c = [c[i] * g[i] for i in range(4)]
        col.append([round(t, 3)] + [round(x, 3) for x in c])
    if max(p[4] for p in col) < 0.03:
        return None
    out["col"] = col

    # Where and how it moves (game units, local axes: x right, y up, z forward).
    off = vec3(e.get("EmitterPosition")) if e.get("EmitterPosition") else [0.0, 0.0, 0.0]
    bt = vec3(e.get("birthTranslation"))
    off = [off[i] + bt[i] for i in range(3)]
    shape = e.get("SpawnShape") or {}
    eo = shape.get("emitOffset")
    if eo is not None:
        # A random range on an axis makes a box: centre and half-width.
        c, box = spread(eo)
        off = [off[i] + c[i] for i in range(3)]
        if any(box):
            out["box"] = box
    if shape.get("radius"):
        out["spr"] = round(float(shape["radius"]), 1)
    if any(abs(c) > 0.5 for c in off):
        out["off"] = [round(c, 1) for c in off]
    vel, vb = spread(e.get("birthVelocity"))
    v2 = vec3(e.get("velocity"))
    vel = [vel[i] + v2[i] for i in range(3)]
    if any(abs(c) > 0.5 for c in vel):
        out["vel"] = [round(c, 1) for c in vel]
    if any(vb):
        out["vb"] = vb
    acc = vec3(e.get("worldAcceleration"))
    if any(abs(c) > 0.5 for c in acc):
        out["acc"] = [round(c, 1) for c in acc]

    # Rotation: a billboard's roll, a quad's or mesh's orientation (degrees), random ranges and spin.
    rot = vec3(e.get("birthRotation0"))
    rs = [rand_span(e.get("birthRotation0"), i) for i in range(3)]
    if kind in ("q", "m", "g"):
        base = [rot[i] * (rs[i][0] if rs[i] else 1) for i in range(3)]
        out["rot"] = [round(c, 1) for c in base]
        rr = [round(rot[i] * (rs[i][1] - rs[i][0]), 1) if rs[i] else 0 for i in range(3)]
        if any(rr):
            out["rr"] = rr
    else:
        i = 2 if rot[2] else 0
        out["rot"] = round(rot[i] * (rs[i][0] if rs[i] else 1), 1)
        if rs[i]:
            out["rr"] = round(rot[i] * (rs[i][1] - rs[i][0]), 1)
    spin = vec3(e.get("birthRotationalVelocity0"))
    if any(spin):
        out["spin"] = [round(c, 1) for c in spin] if kind in ("q", "m", "g") else round(spin[2] or spin[0], 1)
    if e.get("isDirectionOriented") or kind in ("t", "r"):
        out["dir"] = 1
    if e.get("isGroundLayer") or kind == "g":
        out["g"] = 1

    # Flipbook.
    div = e.get("texDiv")
    if isinstance(div, list) and len(div) >= 2 and (div[0] > 1 or div[1] > 1):
        out["div"] = [int(div[0]), int(div[1])]
        n = e.get("numFrames")
        out["n"] = int(n) if n else int(div[0]) * int(div[1])
        fps = e.get("frameRate") or num(e.get("birthFrameRate"), 0)
        if fps:
            out["fps"] = round(float(fps), 2)
        if e.get("isRandomStartFrame"):
            out["rf"] = 1
    if mesh is not None:
        out["mesh"] = mesh
    return out


def sample(curve_, t):
    for i in range(len(curve_) - 1):
        a, b = curve_[i], curve_[i + 1]
        if b[0] >= t:
            k = (t - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0
            return [a[j] + (b[j] - a[j]) * k for j in range(1, len(a))]
    return curve_[-1][1:]


def importance(em):
    """Roughly how much an emitter shows: its size times its brightest alpha times how many it draws."""
    w = em["size"][0] * (em["size"][1] if em["k"] != "m" else 100) if em["k"] != "m" else 100 * 100 * max(em["size"])
    alpha = max(p[4] for p in em["col"])
    many = em.get("count", 1) if not em["rate"] else min(MAX_PER_EMITTER, em["rate"] * em["life"])
    return abs(w) * alpha * math.sqrt(max(1, many))


class Champion:
    """Collects one champion's effects, textures and meshes."""

    def __init__(self, systems, names, meshes_dir):
        self.systems_src = systems          # full path -> VfxSystemDefinitionData
        self.names = names                  # effect key -> full path
        self.meshes_dir = meshes_dir
        self.textures = []                  # [(path, div)]
        self.tex_index = {}
        self.meshes = []
        self.mesh_body = {}
        self.mesh_index = {}
        self.systems = []
        self.sys_index = {}

    def texture(self, path, div):
        key = path.lower()
        if key not in self.tex_index:
            im = load_texture(path)
            if im is None:
                self.tex_index[key] = None
            else:
                self.tex_index[key] = len(self.textures)
                self.textures.append((im, div))
        return self.tex_index[key]

    def mesh(self, path):
        key = path.lower().replace("\\", "/")
        if key not in self.mesh_index:
            data = None
            if self.meshes_dir:
                p = os.path.join(self.meshes_dir, key)
                if os.path.exists(p):
                    with open(p, "rb") as f:
                        data = f.read()
            m = read_mesh(data) if data else None
            if m and len(m[2]) <= 3000:
                packed = pack_mesh(m)
                # Different paths often hold the same mesh: stored once.
                same = self.mesh_body.setdefault(json.dumps(packed), len(self.meshes))
                if same == len(self.meshes):
                    self.meshes.append(packed)
                self.mesh_index[key] = same
            else:
                self.mesh_index[key] = None
        return self.mesh_index[key]

    def system(self, path, depth=0):
        """Index of a converted system (with its children's emitters folded in), or None."""
        key = path.lower()
        if key in self.sys_index:
            return self.sys_index[key]
        src = next((v for k, v in self.systems_src.items() if k.lower() == key), None)
        self.sys_index[key] = None
        if not src:
            return None
        ems = []
        for e in (src.get("complexEmitterDefinitionData") or []) + (src.get("simpleEmitterDefinitionData") or []):
            em = convert_emitter(e, self)
            if em:
                ems.append(em)
            child = e.get("childParticleSetDefinition") if isinstance(e, dict) else None
            if child and depth < 2:
                for c in child.get("childrenIdentifiers") or []:
                    target = self.names.get(c.get("effectKey") or "") or c.get("effect")
                    ci = self.system(target, depth + 1) if isinstance(target, str) else None
                    if ci is not None:
                        delay = float(e.get("timeBeforeFirstEmission") or 0)
                        for ce in self.systems[ci]["emitters"]:
                            ce = dict(ce)
                            ce["delay"] = round(ce.get("delay", 0) + delay, 3)
                            ems.append(ce)
        if not ems:
            return None
        ems.sort(key=importance, reverse=True)
        ems = ems[:MAX_EMITTERS]
        self.sys_index[key] = len(self.systems)
        self.systems.append({"name": src.get("particleName") or path.rsplit("/", 1)[-1], "emitters": ems})
        return self.sys_index[key]

    def atlas(self):
        """Packs the textures (shelf packing) -> (image, frames [[x, y, w, h], ...])."""
        sized = []
        for im, div in self.textures:
            cols, rows = (int(div[0]), int(div[1])) if isinstance(div, list) and len(div) >= 2 else (1, 1)
            limit = max(TEX_MAX, min(512, 96 * max(cols, rows)))
            w, h = im.size
            k = min(1.0, limit / max(w, h))
            sized.append(im.resize((max(cols, round(w * k)), max(rows, round(h * k))), Image.LANCZOS) if k < 1 else im)
        order = sorted(range(len(sized)), key=lambda i: -sized[i].size[1])
        frames = [None] * len(sized)
        x = y = shelf = 0
        for i in order:
            w, h = sized[i].size
            if x + w > ATLAS_W:
                x, y, shelf = 0, y + shelf + 2, 0
            frames[i] = [x, y, w, h]
            x += w + 2
            shelf = max(shelf, h)
        H = 1
        while H < y + shelf:
            H *= 2
        out = Image.new("RGBA", (ATLAS_W, H), (0, 0, 0, 0))
        for i, im in enumerate(sized):
            out.paste(im, (frames[i][0], frames[i][1]))
        return out, frames


# ---------- which effect plays when ----------

ROLE_WORDS = [
    ("missile", re.compile(r"(^|_)(mis|missile|projectile|proj|bolt|orb|ball|bullet|spear)(_|\d|$)", re.I)),
    ("hit", re.compile(r"(^|_)(tar|hit|impact|explode|explosion|detonate|tar_?\w*)(_|\d|$)", re.I)),
    ("buff", re.compile(r"(^|_)(buf|buff|debuff|marker|mark|stun|charm|slow|root|fear|aura)(_|\d|$)", re.I)),
    ("area", re.compile(r"(^|_)(aoe|ground|zone|field|area|circle|pool|nova|wave|landing|land|blast|burst)(_|\d|$)", re.I)),
    ("cast", re.compile(r"(^|_)(cas|cast|activate|start|self|weapon|hand|trail|dash)(_|\d|$)", re.I)),
]
SKIP_NAME = re.compile(r"indicator|range|team_?|_red\b|_blue\b|enemy_?view|ready|_sfx|sound|audio|cooldown|recall|taunt|joke|dance|laugh|death|_idle|_ss_|avatar|hud|icon|textureswap|eyes", re.I)


def classify(key):
    """(slot, role) of an effect name like "Ahri_E_mis", or None."""
    k = key.strip()
    m = re.search(r"(?:^|_)(Q|W|E|R|P|BA|Crit|Passive)(?:\d?)(?:_|$)(.*)", k, re.I)
    if not m:
        return None
    slot = m.group(1).upper()
    slot = {"PASSIVE": "P", "CRIT": "crit", "BA": "attack"}.get(slot, slot)
    rest = m.group(2)
    if SKIP_NAME.search(k):
        return None
    for role, rx in ROLE_WORDS:
        if rx.search(rest) or rx.search("_" + rest):
            return slot, role, True
    # Any other part of the ability (a ring, a spin, a heal) plays on the caster, after the named ones.
    return slot, "cast", not rest


def build_champion(dump, meshes_dir):
    names = dump.get("resourceMap") or {}
    ch = Champion(dump.get("systems") or {}, names, meshes_dir)
    slots = {}
    found = []
    for key, path in sorted(names.items()):
        if not isinstance(path, str) or path.startswith("{"):
            continue
        cls = classify(key)
        if cls:
            found.append((not cls[2], key, path, cls[0], cls[1]))
    for _, key, path, slot, role in sorted(found):
        if slot == "crit":
            slot, role = "attack", "crit" if role in ("hit",) else role
        lst = slots.get(slot, {}).get(role, [])
        if len(lst) >= 3:
            continue
        si = ch.system(path)
        if si is None or si in lst:
            continue
        slots.setdefault(slot, {}).setdefault(role, []).append(si)
    if not slots:
        return None
    return ch, slots


def write(ch, slots, out_dir, name):
    im, frames = ch.atlas()
    im.save(os.path.join(out_dir, name + ".webp"), "WEBP", quality=82, method=6)
    data = {"atlas": name + ".webp", "size": list(im.size), "frames": frames, "slots": slots,
            "systems": ch.systems, "meshes": ch.meshes}
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return os.path.getsize(os.path.join(out_dir, name + ".webp")) + os.path.getsize(os.path.join(out_dir, name + ".json"))


# Mayhem effects by the name the replay asks for: (part, effect name, needs a mesh to look right).
MAYHEM = {
    "PoroCharge": [("missile", "Kiwi_Augment_PoroCharge_PoroMissile", True), ("hit", "Kiwi_Augment_PoroCharge_NormalHit", False),
                   ("cast", "Kiwi_Augment_PoroCharge_PoroSpawn", False)],
}


def build_mayhem(meshes_dir, out_dir):
    data = fetch(KIWI)
    if not data:
        return None
    kiwi = json.loads(data)
    systems = {k: v for k, v in kiwi.items() if isinstance(v, dict) and v.get("__type") == "VfxSystemDefinitionData"}
    names = {}
    for v in kiwi.values():
        if isinstance(v, dict) and v.get("__type") == "ResourceResolver":
            names.update({k: p for k, p in (v.get("resourceMap") or {}).items() if isinstance(p, str)})
    ch = Champion(systems, names, meshes_dir)
    slots = {}
    for slot, parts in MAYHEM.items():
        roles = {}
        for role, name, needs_mesh in parts:
            si = ch.system(names.get(name, ""))
            if si is None or (needs_mesh and not any(e["k"] == "m" for e in ch.systems[si]["emitters"])):
                roles = {}
                break
            roles[role] = [si]
        if roles:
            slots[slot] = roles
    if not slots:
        return None
    return write(ch, slots, out_dir, "mayhem")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dump", help="dump_vfx_bins.py output (one JSON per champion)")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "assets", "vfx"))
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    meshes = os.path.join(args.dump, "meshes")
    meshes = meshes if os.path.isdir(meshes) else None
    # Champions by the replay's id (lower case), which is the client's alias.
    index_path = os.path.join(args.out, "index.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) and args.only else {"v": 1, "champions": {}}
    files = sorted(f for f in os.listdir(args.dump) if f.endswith(".json") and not f.startswith(("_", ".")))
    todo = [f[:-5] for f in files if not args.only or f[:-5] in args.only]

    def one(alias):
        with open(os.path.join(args.dump, alias + ".json")) as f:
            dump = json.load(f)
        built = build_champion(dump, meshes)
        if not built:
            return alias, None
        ch, slots = built
        return alias, (write(ch, slots, args.out, alias), {s: sorted(r) for s, r in slots.items()})

    total = 0
    with ThreadPoolExecutor(8) as ex:
        for alias, res in ex.map(one, todo):
            if res is None:
                index["champions"].pop(alias, None)
                print(f"{alias}: nothing drawable")
                continue
            size, roles = res
            total += size
            index["champions"][alias] = alias + ".json"
            print(f"{alias}: {size // 1024} KB {roles}")
    # Mayhem's own effects the replay shows (Poro Charge's stampede), from the mode's bin.
    if not args.only or "mayhem" in args.only:
        res = build_mayhem(meshes, args.out)
        if res:
            index["champions"]["mayhem"] = "mayhem.json"
            print(f"mayhem: {res // 1024} KB")
    with open(index_path, "w") as f:
        json.dump(index, f, separators=(",", ":"), sort_keys=True)
    print(f"{len(todo)} champions, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
