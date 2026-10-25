"""Shared helpers for the data tests: repo paths, loading generated .js data, importing builder scripts
by path without running them, and the rules the site build applies to shipped files (web/scripts/sync-embeds.mjs).

Everything here is offline and read-only."""
import functools
import importlib.util
import json
import os
import re
import sys
import types
import urllib.parse

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ASSETS = os.path.join(REPO, "web", "public", "assets")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

TIERS = ("Silver", "Gold", "Prismatic")


def repo(*parts):
    return os.path.join(REPO, *parts)


def read(path):
    with open(path if os.path.isabs(path) else repo(path), encoding="utf-8") as f:
        return f.read()


def load_json(path):
    return json.loads(read(path))


_JS_WRAPPER = re.compile(r"^\s*(?:window\.([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))\s*=\s*")


@functools.lru_cache(maxsize=None)
def _load_js(path):
    text = read(path)
    m = _JS_WRAPPER.match(text)
    assert m, f"{path} does not start with `window.X = ` or `const X = `"
    body = text[m.end():].rstrip()
    if body.endswith(";"):
        body = body[:-1]
    return (m.group(1) or m.group(2)), json.loads(body)


def load_js_data(path, expect_var=None):
    """Parse a generated `window.X = {...};` file. Returns the JSON value (a fresh copy is not made: don't mutate)."""
    var, data = _load_js(path)
    if expect_var:
        assert var == expect_var, f"{path} assigns {var}, expected {expect_var}"
    return data


def js_var(path):
    return _load_js(path)[0]


def _stub_xxhash():
    """Builder modules import xxhash for string-table hashes; tests never hash, so a stub is enough when it's
    not installed."""
    if "xxhash" in sys.modules:
        return
    try:
        import xxhash  # noqa: F401
    except ImportError:
        stub = types.ModuleType("xxhash")
        stub.xxh3_64_intdigest = lambda b: 0
        sys.modules["xxhash"] = stub


def load_module(rel_path, name, extra_path=()):
    """Import a script by path under a unique module name without running its main()."""
    if name in sys.modules:
        return sys.modules[name]
    _stub_xxhash()
    for p in extra_path:
        p = repo(p)
        if p not in sys.path:
            sys.path.insert(0, p)
    spec = importlib.util.spec_from_file_location(name, repo(rel_path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------- what ships to the site ----------
# sync-embeds.mjs copies these folders into web/public/embed/: dashboard (minus data/), simulator/viewer and
# every folder with a site-tab.json (top level or one level down), leaving out .py and .md files and __pycache__.

def embed_roots():
    roots = [("dashboard", ("data",)), (os.path.join("simulator", "viewer"), ())]
    skip = {"web", "node_modules", ".git", ".github"}

    def discover(d, depth):
        for name in sorted(os.listdir(d)):
            folder = os.path.join(d, name)
            if not os.path.isdir(folder) or name.startswith(".") or name in skip:
                continue
            if os.path.exists(os.path.join(folder, "site-tab.json")):
                roots.append((os.path.relpath(folder, REPO), ()))
            elif depth < 2:
                discover(folder, depth + 1)

    discover(REPO, 1)
    return roots


TEXT_EXT = (".html", ".js", ".mjs", ".css", ".json")


@functools.lru_cache(maxsize=None)
def shipped_embed_files(ext=TEXT_EXT):
    """Repo-relative paths of the text files sync-embeds publishes."""
    out = []
    for root, exclude in embed_roots():
        base = repo(root)
        for dirpath, dirnames, filenames in os.walk(base):
            rel_dir = os.path.relpath(dirpath, base)
            if rel_dir.split(os.sep)[0] in exclude or "__pycache__" in dirpath:
                dirnames[:] = []
                continue
            for f in filenames:
                if re.search(r"\.(py|md)$", f) or not f.endswith(ext):
                    continue
                out.append(os.path.relpath(os.path.join(dirpath, f), REPO))
    return tuple(sorted(out))


def _kiwi(m):
    s = m.group(0)
    return "MAYHEM" if s == "KIWI" else "Mayhem" if s[0] == "K" else "mayhem"


def _large_icon(m):
    path = m.group(1)
    return f"/assets/{path}_large.png" if os.path.isfile(os.path.join(ASSETS, *f"{path}_large.png".split("/"))) else m.group(0)


_SWAP = None


def _swap(m):
    global _SWAP
    if _SWAP is None:
        path = os.path.join(ASSETS, "..", "..", "src", "data", "dd-swap.json")
        _SWAP = json.load(open(path))["paths"] if os.path.exists(path) else {}
    return _SWAP.get(m.group(0), m.group(0))


def _embed_rules():
    """sync-embeds.mjs's LOCAL list; a rule with a third entry applies only when that file is in public/assets."""
    rules = [
        (r"https://raw\.communitydragon\.org/", "/assets/cd/"),
        (r"https://ddragon\.leagueoflegends\.com/cdn/", "/assets/dd/"),
        (r"\{\{\s*Kiwi_[^}]*\}\}\s*", ""),
        (r"(?i)kiwi", _kiwi),
        (r"(?i)/assets/(cd/[^\"'`\s]*?/augments/icons/[\w.-]+?)_small\.png", _large_icon),
        (r"https://d28xe8vt774jo5\.cloudfront\.net/champion-abilities", "/assets/clips", "clips"),
        (r"https://cdn\.modelviewer\.lol/lol/models", "/assets/models", "models/models.json"),
        (r"https://cdn\.jsdelivr\.net/npm/three@0\.160\.0/", "/assets/lib/three-0.160.0/",
         "lib/three-0.160.0/build/three.module.js"),
        (r"<link[^>]+rel=\"preconnect\"[^>]+fonts\.g(?:oogleapis|static)\.com[^>]*>\s*", ""),
        (r"https://fonts\.googleapis\.com/css2\?[^\"')\s]+", "/assets/fonts/fonts.css"),
        # official versions first (web/src/data/dd-swap.json), and no pick quotes
        (r"/assets/cd/latest/[^\"'`\s()\\<>]+", _swap),
        (r"\"/assets/cd/latest/[^\"]*/champion-choose-vo/\d+\.ogg\"", "null"),
    ]
    return [(re.compile(r[0]), r[1]) for r in rules
            if len(r) < 3 or os.path.exists(os.path.join(ASSETS, *r[2].split("/")))]


def embed_transform(text):
    """The text rewrites sync-embeds applies to every published file: outside asset hosts point at the site's
    /assets/ copies, unfilled Kiwi tooltip tokens go, and the mode's internal name becomes Mayhem."""
    for rx, to in _embed_rules():
        text = rx.sub(to, text)
    return text


ASSET_EXT = r"png|jpe?g|webp|svg|gif|ogg|mp3|wav|webm|mp4|glb|json|woff2?"
# a literal /assets/... path that starts a URL (not ".../game/assets/..." built from a prefix variable)
ASSET_RE = re.compile(r"(?<![\w/.\-])/assets/[^\s\"'`<>()\\{}$]+?\.(?:" + ASSET_EXT + r")(?=[\s\"'`<>()\\?#,;]|$)", re.I)


def asset_paths(text):
    return sorted(set(ASSET_RE.findall(text)))


def asset_exists(site_path):
    """Whether /assets/<rel> is in web/public/assets (case-sensitive, as the site serves it). Files over the
    host's size cap are stored as .part0, .part1, ..."""
    rel = urllib.parse.unquote(site_path.split("?")[0].split("#")[0])[len("/assets/"):]
    p = os.path.join(ASSETS, *rel.split("/"))
    return os.path.isfile(p) or os.path.isfile(p + ".part0")


def flatten_strings(value):
    """Every string value (not key) in a JSON structure."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from flatten_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from flatten_strings(v)


def walk_numbers(value, path="$"):
    """(path, number) for every int/float in a JSON structure (bools excluded)."""
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        yield path, value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from walk_numbers(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from walk_numbers(v, f"{path}[{i}]")


@functools.lru_cache(maxsize=None)
def champions():
    """The champion list the champion pages ship: [{id, alias, name, ...}]."""
    return load_js_data("champions/data.js", "CHAMPS_DATA")["champions"]


def champion_ids():
    return {c["id"] for c in champions()}


def champion_aliases():
    return {c["alias"] for c in champions()}


def champion_names():
    return {c["name"] for c in champions()}
