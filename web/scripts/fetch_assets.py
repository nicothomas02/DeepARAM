"""Mirror every image, sound, model, font and script the site's pages use into web/public/assets/,
so the whole site loads from deeparam.com.

Where things land (the full map, for the other tabs, is /mnt/project-files/website/assets-map.md):
  raw.communitydragon.org/<channel>/<path>   -> /assets/cd/<channel>/<path, lower case>   (channel: latest or pbe)
  ddragon.leagueoflegends.com/cdn/<v>/img/<p> -> /assets/dd/<v>/img/<p>                  (live patch's version only)
  ddragon.leagueoflegends.com/cdn/img/<p>     -> /assets/dd/img/<p>                      (splash, loading, tile art; runes)
  cdn.modelviewer.lol/lol/models/<id>/<n>/model.glb -> /assets/models/<id>/<n>/model.glb + models.json
                                                  (slimmed: the replay's clips only, 512 px WebP textures)
  Google Fonts (Bricolage Grotesque, Geist, Geist Mono) -> /assets/fonts/fonts.css
  three.js 0.160.0 (the replay's 3D)           -> /assets/lib/three-0.160.0/{build,examples/jsm}/...
Player profile icons (5,000+) aren't mirrored; the site serves them at /assets/profile-icon/<id>.jpg.

Official versions first: where Data Dragon has an image (champion icons, splash, loading and tile art,
ability, item, summoner spell, rune and profile icons), pages show that copy instead of the client file.
web/src/data/dd-swap.json maps each client-file path pages name to its Data Dragon copy; sync-embeds.mjs
and src/lib/assets.ts apply it, and the swapped splash art and pick quotes are no longer kept. Mayhem
augment and item icons, challenge tokens and minimaps have no Data Dragon version and stay as they are.

What gets fetched: every such URL written anywhere in the repo's pages and data, plus the sets pages build
from ids at runtime (each champion's icon, pick quote, client JSON, splash and ability icons; items; augments;
the Howling Abyss minimaps; the replay's ability icons and models). /assets/manifest.json records the
live patch and what was fetched.

Usage (from the repo root):
  python3 web/scripts/fetch_assets.py           # icons, splashes, sounds, JSON, fonts, three.js (new files only)
  python3 web/scripts/fetch_assets.py --refresh # also re-download files already present (after a patch),
                                                #   and refresh the translated names (fetch_names.py)
                                                #   and the game's item groups (fetch_item_groups.py)
  python3 web/scripts/fetch_assets.py --models  # + 3D models (needs node and the glTF tools, see below)

--models runs simulator/tools/build_models.mjs, which needs:
  npm install --prefix /tmp/gltf @gltf-transform/cli@4 @gltf-transform/core@4 @gltf-transform/extensions@4 meshoptimizer
and is run with GLTF_MODULES=/tmp/gltf/node_modules (default).
"""
import argparse, concurrent.futures as cf, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
REPO = os.path.normpath(os.path.join(WEB, ".."))
OUT = os.path.join(WEB, "public", "assets")

CD = "https://raw.communitydragon.org"
GD = "plugins/rcp-be-lol-game-data/global/default"
DD = "https://ddragon.leagueoflegends.com"
FONTS = ("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700"
         "&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap")
THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0"
THREE_ENTRIES = ["build/three.module.js", "examples/jsm/loaders/GLTFLoader.js",
                 "examples/jsm/libs/meshopt_decoder.module.js", "examples/jsm/utils/SkeletonUtils.js"]
MINIMAPS = ["2dlevelminimap", "2dlevelminimap_bloom", "2dlevelminimap_bilgewater2", "2dlevelminimap_crepe"]
CAP = 25 * 1024 * 1024 - 64 * 1024  # Cloudflare serves static files up to 25 MiB
UA = {"User-Agent": "deeparam-assets"}  # CommunityDragon refuses Python's default User-Agent
# A modern browser's User-Agent, so Google Fonts answers with WOFF2.
FONT_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/126.0 Safari/537.36"}

ASSET_EXT = r"png|jpe?g|webp|svg|gif|ogg|mp3|wav|webm|mp4|glb|json"
URL_RE = re.compile(
    r"https://(?:raw\.communitydragon\.org/(?:latest|pbe|\d+\.\d+)/|ddragon\.leagueoflegends\.com/cdn/)"
    r"[^\s\"'`<>()\\]+?\.(?:" + ASSET_EXT + r")(?=[\s\"'`<>()\\?#]|$)", re.I)
# Pages that already point at the mirror (/assets/cd/<channel>/..., /assets/dd/<ver>/img/...) still name a
# source file, so they keep getting mirrored after a patch.
LOCAL_RE = re.compile(
    r"/assets/(cd/(?:latest|pbe)/|dd/(?:[\d.]+/)?img/)[^\s\"'`<>()\\]+?\.(?:" + ASSET_EXT + r")(?=[\s\"'`<>()\\?#]|$)", re.I)
SCAN_EXT = {".js", ".mjs", ".ts", ".tsx", ".json", ".html", ".css", ".csv"}
SCAN_SKIP = {".git", "node_modules", ".next", ".open-next", "mac-imports", "assets", "embed", "importer"}


def fetch(url, headers=UA, tries=4):
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            if attempt == tries - 1:
                raise
        except OSError:
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def local_path(url):
    """The file under OUT that mirrors an outside URL, or None if it isn't one we mirror."""
    u = urllib.parse.urlsplit(url)
    if u.netloc == "raw.communitydragon.org":
        channel, _, rest = u.path.lstrip("/").partition("/")
        return f"cd/{channel}/{urllib.parse.unquote(rest).lower()}".replace("kiwi", "mayhem")
    if u.netloc == "ddragon.leagueoflegends.com":
        m = re.match(r"/cdn/(?:([\d.]+)/)?((?:img|data)/.+)", u.path)
        return f"dd/{m.group(1) + '/' if m.group(1) else ''}{urllib.parse.unquote(m.group(2))}" if m else None
    return None


def scan_repo():
    """Every asset URL written literally in the repo's pages and data."""
    found = set()
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SCAN_SKIP and not d.startswith(".")]
        for f in files:
            # dd-swap.json names every client file with an official copy; pages don't use those.
            if os.path.splitext(f)[1].lower() not in SCAN_EXT or f == "dd-swap.json":
                continue
            try:
                text = open(os.path.join(root, f), encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            found.update(m.group(0) for m in URL_RE.finditer(text))
            found.update(source_url(m.group(0)) for m in LOCAL_RE.finditer(text))
    return found


def source_url(path):
    """/assets/cd/latest/x.png -> its CommunityDragon URL; /assets/dd/<ver>/img/x.png -> its Data Dragon URL."""
    rest = path.removeprefix("/assets/")
    if rest.startswith("cd/"):
        return f"{CD}/{rest[3:].replace('mayhem', 'kiwi')}"
    if rest.startswith("dd/img/"):
        return f"{DD}/cdn/{rest[3:]}"
    ver, _, img = rest[3:].partition("/")
    return f"{DD}/cdn/{ver}/{img}"


def client_path(p):
    """/lol-game-data/assets/ASSETS/... as the client writes it -> its CommunityDragon URL."""
    return f"{CD}/latest/{GD}/{p.replace('/lol-game-data/assets/', '').lower()}" if p else None


def real_champion(c):
    # The summary also lists placeholder (-1) and game-mode bot entries (ids from 60000 up).
    return 0 < c["id"] < 10000


def runtime_sets(summary, champ_json):
    """URLs pages build from ids at runtime, so no literal scan finds them."""
    urls = {f"{CD}/latest/{GD}/v1/{f}" for f in
            ["champion-summary.json", "items.json", "cherry-augments.json", "summoner-spells.json"]}
    urls.add(f"{CD}/latest/cdragon/arena/en_us.json")
    urls.update(f"{CD}/latest/game/assets/maps/info/map12/{m}.png" for m in MINIMAPS)
    urls.add(f"{CD}/latest/game/assets/spells/icons2d/porocharge_quest2.png")
    for c in summary:
        if not real_champion(c):
            continue
        for f in (f"champion-icons/{c['id']}.png", f"champions/{c['id']}.json"):
            urls.add(f"{CD}/latest/{GD}/v1/{f}")
        data = champ_json.get(c["id"])
        if data:
            base = data["skins"][0]
            # The champion panel shows the base skin's full (uncentered) splash.
            urls.add(client_path(base.get("uncenteredSplashPath") or base.get("splashPath")))
            for a in [data.get("passive", {})] + data.get("spells", []):
                if a.get("abilityIconPath"):
                    urls.add(client_path(a["abilityIconPath"]))
    return urls


def save(url, force):
    rel = local_path(url)
    dst = os.path.join(OUT, rel)
    if os.path.exists(dst) and not force:
        return rel, 0, None
    try:
        body = fetch(url)
    except urllib.error.HTTPError as e:
        # A few icons pages name under latest/ exist only on PBE until the patch ships.
        if e.code != 404 or "/latest/" not in url:
            return rel, 0, str(e)
        try:
            body = fetch(url.replace("/latest/", "/pbe/", 1))
        except Exception as e2:  # noqa: BLE001
            return rel, 0, str(e2)
    except Exception as e:  # noqa: BLE001 — one missing file shouldn't stop the run
        return rel, 0, str(e)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(body)
    return rel, len(body), None


def fetch_all(urls, force, label):
    new = errors = 0
    with cf.ThreadPoolExecutor(16) as pool:
        for rel, n, err in pool.map(lambda u: save(u, force), sorted(urls)):
            if err:
                errors += 1
                print(f"  {label}: {rel} failed ({err})")
            elif n:
                new += 1
    print(f"{label}: {len(urls)} files, {new} downloaded, {errors} failed")
    return errors


def fetch_fonts():
    css = fetch(FONTS, FONT_UA).decode()
    os.makedirs(os.path.join(OUT, "fonts"), exist_ok=True)

    def local(m):
        url = m.group(1)
        name = re.sub(r"[^A-Za-z0-9._-]", "_", urllib.parse.urlsplit(url).path.strip("/").replace("/", "-"))
        dst = os.path.join(OUT, "fonts", name)
        if not os.path.exists(dst):
            with open(dst, "wb") as f:
                f.write(fetch(url, FONT_UA))
        return f"url(/assets/fonts/{name})"

    css = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", local, css)
    with open(os.path.join(OUT, "fonts", "fonts.css"), "w") as f:
        f.write("/* Bricolage Grotesque, Geist and Geist Mono (SIL Open Font License). */\n" + css)
    print("fonts: fonts.css written")


def fetch_three():
    """three.js's module build plus the addons the replay imports, and everything those import."""
    todo, seen = list(THREE_ENTRIES), set()
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        dst = os.path.join(OUT, "lib", "three-0.160.0", rel)
        if os.path.exists(dst):
            body = open(dst, "rb").read()
        else:
            body = fetch(f"{THREE}/{rel}")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "wb") as f:
                f.write(body)
        for spec in re.findall(rb"""(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]""", body):
            spec = spec.decode()
            if spec.startswith("."):
                todo.append(os.path.normpath(os.path.join(os.path.dirname(rel), spec)))
    print(f"three.js: {len(seen)} files (import map: \"three\" -> /assets/lib/three-0.160.0/build/three.module.js)")


def write_large_icon_list():
    """Augment small icons whose large (rarity-coloured) copy is mirrored, for src/lib/assets.ts."""
    have = []
    for root, _, files in os.walk(os.path.join(OUT, "cd")):
        for f in files:
            if f.endswith("_small.png") and "/augments/icons" in root.replace(os.sep, "/") and f[:-10] + "_large.png" in files:
                have.append("/assets/" + os.path.relpath(os.path.join(root, f), OUT).replace(os.sep, "/"))
    with open(os.path.join(REPO, "web", "src", "data", "augment-large-icons.json"), "w") as fh:
        json.dump(sorted(have), fh, indent=0)


SWAP = os.path.join(WEB, "src", "data", "dd-swap.json")


def dd_data(ver, rel, refresh):
    """A Data Dragon data file, kept under /assets/dd/<ver>/data/en_US/ (the champion panel reads them too)."""
    path = os.path.join(OUT, "dd", ver, "data", "en_US", rel)
    if os.path.exists(path) and not refresh:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    body = fetch(f"{DD}/cdn/{ver}/data/en_US/{rel}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)
    return json.loads(body)


def client_json(rel):
    """A client data file (v1/...), from the mirror when it's there."""
    path = os.path.join(OUT, "cd", "latest", GD, "v1", rel)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(fetch(f"{CD}/latest/{GD}/v1/{rel}"))


def dd_swap(ver, champ_json, refresh):
    """Client-file path -> its Data Dragon copy, both relative to /assets/, for every image Data Dragon has."""
    rel = lambda p: local_path(client_path(p)) if p else None  # noqa: E731
    swap = {}
    champs = dd_data(ver, "champion.json", refresh)["data"]
    keys = {int(c["key"]): k for k, c in champs.items()}
    with cf.ThreadPoolExecutor(16) as pool:
        full = dict(pool.map(lambda k: (k, dd_data(ver, f"champion/{k}.json", refresh)["data"][k]), keys.values()))
    art = (("tilePath", "tiles"), ("uncenteredSplashPath", "splash"), ("splashPath", "centered"), ("loadScreenPath", "loading"))
    for cid, key in keys.items():
        swap[f"cd/latest/{GD}/v1/champion-icons/{cid}.png"] = f"dd/{ver}/img/champion/{key}.png"
        client, d = champ_json.get(cid), full[key]
        if not client:
            continue
        nums = {s["num"] for s in d["skins"]}
        for skin in client.get("skins", []):
            num = skin["id"] % 1000
            if num in nums:
                for field, folder in art:
                    if rel(skin.get(field)):
                        swap[rel(skin[field])] = f"dd/img/champion/{folder}/{key}_{num}.jpg"
        pairs = [(client.get("passive", {}), f"passive/{d['passive']['image']['full']}")]
        pairs += [(a, f"spell/{b['image']['full']}") for a, b in zip(client.get("spells", []), d["spells"])]
        for a, to in pairs:
            if rel(a.get("abilityIconPath")):
                swap[rel(a["abilityIconPath"])] = f"dd/{ver}/img/{to}"
    items = dd_data(ver, "item.json", refresh)["data"]
    for i in client_json("items.json"):
        if str(i["id"]) in items and rel(i.get("iconPath")):
            swap[rel(i["iconPath"])] = f"dd/{ver}/img/item/{i['id']}.png"
    spells = {int(s["key"]): s["image"]["full"] for s in dd_data(ver, "summoner.json", refresh)["data"].values()}
    for s in client_json("summoner-spells.json"):
        if s["id"] in spells and rel(s.get("iconPath")):
            swap[rel(s["iconPath"])] = f"dd/{ver}/img/spell/{spells[s['id']]}"
    runes = {}
    for style in dd_data(ver, "runesReforged.json", refresh):
        runes[style["id"]] = style["icon"]
        for slot in style["slots"]:
            runes.update((r["id"], r["icon"]) for r in slot["runes"])
    for p in client_json("perks.json") + client_json("perkstyles.json").get("styles", []):
        if p["id"] in runes and rel(p.get("iconPath")):
            swap[rel(p["iconPath"])] = f"dd/img/{runes[p['id']]}"
    return swap


def reachable(swap, named):
    """The part of the swap pages can reach: paths they name, and the kinds they build from ids at runtime
    (champion, ability, item, rune and summoner spell icons; each champion's base splash and tile)."""
    runtime = ("/champion-icons/", "/hud/icons2d/", "/items/icons2d/", "/perk-images/", "/summoner")
    base_art = re.compile(r"/skins/base/images/[^/]+_splash_(tile|uncentered)_\d+\.jpg$")
    return {k: v for k, v in swap.items() if k in named or any(r in k for r in runtime) or base_art.search(k)}


def write_swap(ver, swap):
    with open(SWAP, "w") as f:
        json.dump({"version": ver, "paths": {f"/assets/{k}": f"/assets/{v}" for k, v in sorted(swap.items())}}, f, indent=0)
    with open(os.path.join(WEB, "src", "data", "dd-version.json"), "w") as f:  # small, for browser code
        json.dump({"version": ver}, f)


def swapped_art(rel, swap, keep_client):
    """Champion art whose official copy is in place (the replay still names some client files directly)."""
    return rel in swap and "/skins/" in rel and rel not in keep_client


def prune_swapped(swap, keep_client, used):
    """Drop client copies of champion art that now comes from Data Dragon, the pick quotes, and official
    champion art no page uses any more."""
    gone = 0
    art = os.path.join(OUT, "dd", "img", "champion")
    for root, _, files in os.walk(art):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), OUT).replace(os.sep, "/")
            if rel not in used:
                os.remove(os.path.join(root, f))
    for root, _, files in os.walk(os.path.join(OUT, "cd", "latest")):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), OUT).replace(os.sep, "/")
            if swapped_art(rel, swap, keep_client) or "/champion-choose-vo/" in rel:
                os.remove(os.path.join(root, f))
                gone += 1
    print(f"official versions: {len(swap)} client files have one; removed {gone} client copies")


def replay_index():
    with open(os.path.join(REPO, "simulator", "viewer", "replay-data", "index.json")) as f:
        return json.load(f)


def fetch_models(force):
    mods = os.environ.get("GLTF_MODULES", "/tmp/gltf/node_modules")
    out = os.path.join(OUT, "models")
    args = ["node", "tools/build_models.mjs", "--index", "viewer/replay-data/index.json", "--out", out]
    if not force and os.path.exists(os.path.join(out, "models.json")):
        have = {k.lower() for k in json.load(open(os.path.join(out, "models.json")))}
        missing = [c["id"] for c in replay_index()["champions"] if c["id"].lower() not in have]
        if not missing:
            relayout_models()
            return
        args += ["--only", ",".join(missing)]
    subprocess.run(args, cwd=os.path.join(REPO, "simulator"), env={**os.environ, "NODE_PATH": mods}, check=True)
    relayout_models()


def relayout_models():
    """build_models.mjs writes <Id>.glb; move each to <id>/<key*1000>/model.glb, the path the full model has."""
    out = os.path.join(OUT, "models")
    path = os.path.join(out, "models.json")
    if not os.path.exists(path):
        return
    keys = {c["id"]: c["key"] for c in replay_index()["champions"]}
    manifest = json.load(open(path))
    for cid, entry in manifest.items():
        rel = f"{cid.lower()}/{keys[cid] * 1000}/model.glb"
        src = os.path.join(out, entry["file"])
        if entry["file"] != rel and os.path.exists(src):
            os.makedirs(os.path.dirname(os.path.join(out, rel)), exist_ok=True)
            shutil.move(src, os.path.join(out, rel))
        entry["file"] = rel
    json.dump(manifest, open(path, "w"))
    print(f"models: {len(manifest)} champions")


def split_large():
    """Cloudflare won't serve a static file over 25 MiB: split any such file into .part0, .part1, ..."""
    split = {}
    for root, _, files in os.walk(OUT):
        for f in files:
            p = os.path.join(root, f)
            if ".part" in f or os.path.getsize(p) <= CAP:
                continue
            data = open(p, "rb").read()
            parts = [data[i:i + CAP] for i in range(0, len(data), CAP)]
            for i, chunk in enumerate(parts):
                open(f"{p}.part{i}", "wb").write(chunk)
            os.remove(p)
            split[os.path.relpath(p, OUT)] = len(parts)
    return split


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="download files that already exist again")
    ap.add_argument("--models", action="store_true", help="also build the 3D champion models")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    summary = json.loads(fetch(f"{CD}/latest/{GD}/v1/champion-summary.json"))
    champ_json = {}

    def load_champ(cid):
        path = os.path.join(OUT, "cd", "latest", GD, "v1", "champions", f"{cid}.json")
        if os.path.exists(path) and not args.refresh:
            return cid, json.load(open(path))
        try:
            return cid, json.loads(fetch(f"{CD}/latest/{GD}/v1/champions/{cid}.json"))
        except Exception:  # noqa: BLE001
            return cid, None

    with cf.ThreadPoolExecutor(16) as pool:
        champ_json = dict(pool.map(load_champ, [c["id"] for c in summary if real_champion(c)]))

    literal = scan_repo()
    literal = {u for u in literal if "${" not in u and "{" not in u}
    cd_urls = {u for u in literal | runtime_sets(summary, champ_json) if u and local_path(u)}

    index = replay_index()
    ver = index.get("ddragon_version") or json.loads(fetch(f"{DD}/api/versions.json"))[0]
    base = index.get("icon_base", "")
    icons = [rel for c in index["champions"] for rel in c.get("icons", [])]
    if base.startswith("/assets/"):  # the replay names the mirrored client files directly
        cd_urls |= {source_url(base + rel.lower()) for rel in icons}
        dd_urls = set()
    else:
        dd_urls = {f"{DD}/cdn/{ver}/img/{rel}" for rel in icons}
    cd_urls -= {u for u in cd_urls if "ddragon" in u}
    dd_urls |= {u for u in literal if "ddragon" in u}

    # Official versions first: fetch the Data Dragon copy of every client image pages name that has one.
    swap = dd_swap(ver, champ_json, args.refresh)
    named = {local_path(u) for u in cd_urls}
    wanted = reachable(swap, named)
    errors = fetch_all(dd_urls | {source_url("/assets/" + v) for v in wanted.values()}, args.refresh, "official versions and replay icons")
    # A copy that couldn't be fetched leaves the client file in use.
    swap = {k: v for k, v in swap.items() if os.path.exists(os.path.join(OUT, v))}
    used = reachable(swap, named)
    write_swap(ver, used)
    replay_files = {local_path(source_url(base + r.lower())) for r in icons} if base.startswith("/assets/") else set()
    cd_urls = {u for u in cd_urls if not swapped_art(local_path(u), swap, replay_files) and "/champion-choose-vo/" not in u}

    errors += fetch_all(cd_urls, args.refresh, "client files")
    # Pages show each augment's large icon, which carries its rarity colour (the small ones are grey; see
    # sync-embeds.mjs). Arena augments have no large icon, so those misses are expected and not counted.
    large = {re.sub(r"_small\.png$", "_large.png", u) for u in cd_urls if re.search(r"/augments/icons/[^/]+_small\.png$", u, re.I)}
    fetch_all(large - cd_urls, args.refresh, "augment large icons (Arena ones have none)")
    prune_swapped(swap, replay_files, set(used.values()))
    for old in os.listdir(os.path.join(OUT, "dd")):  # keep only the live patch's copies (img/ isn't versioned)
        if old not in (ver, "img"):
            shutil.rmtree(os.path.join(OUT, "dd", old))
    fetch_fonts()
    fetch_three()
    if args.models:
        fetch_models(args.refresh)
    write_large_icon_list()
    split = split_large()

    versions = json.loads(fetch(f"{DD}/api/versions.json"))
    patch = ".".join(versions[0].split(".")[:2])
    counts, total = {}, 0
    for root, _, files in os.walk(OUT):
        for f in files:
            if f == "manifest.json":
                continue
            top = os.path.relpath(root, OUT).split(os.sep)[0]
            counts[top] = counts.get(top, 0) + 1
            total += os.path.getsize(os.path.join(root, f))
    manifest = {"patch": patch, "ddragon_version": versions[0], "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "files": counts, "bytes": total, "split": split}
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"done: patch {patch}, {sum(counts.values())} files, {total / 1e6:.1f} MB" + (f", {errors} failed" if errors else ""))
    if args.refresh:  # the other languages' champion, item and augment names follow the patch too
        subprocess.run([sys.executable, os.path.join(HERE, "fetch_names.py")], check=False)
        subprocess.run([sys.executable, os.path.join(HERE, "fetch_item_groups.py")], check=False)


if __name__ == "__main__":
    main()
