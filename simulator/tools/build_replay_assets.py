#!/usr/bin/env python3
"""Builds the assets for the fight replay viewer (viewer/).

Reads the fight traces written by `mayhem_sim --all --trace-dir DIR` and writes:

  OUT/index.json     champion names, ability names and icon positions, clip segments
  OUT/traces.json    every champion's traced fight, keyed by champion id
  OUT/sprites.webp   one row of 64px icons per champion: portrait, passive, Q, W, E, R

With --clips it also downloads Riot's official ability preview videos (the ones on
leagueoflegends.com champion pages), shrinks them, and joins each champion's Q, W,
E and R clips into OUT/clips/<id>.mp4. Without --clips the viewer streams the
original videos from Riot's CDN, which works anywhere except sandboxed pages.

The clips and icons are Riot Games assets. Don't commit them to the repository.

Usage:
  python3 tools/build_replay_assets.py --traces DIR --out DIR [--clips] [--width 360]
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

# The client's own champion data and icons (CommunityDragon's latest/ is the live patch).
ASSET_ROOT = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/"
CLIP_CDN = "https://d28xe8vt774jo5.cloudfront.net/champion-abilities"
# What the page loads: the website's own copy of the icons (web/public/assets/).
SITE_ICON_BASE = "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/"
ICON = 64
# Abilities that move the caster (from the client's ability descriptions), so the replay can carry
# the model to its target and back.
DASH = re.compile(r"\b(dash(es|ing)?|leaps?|leaping|lunges?|blinks?|jumps?|vaults?|rush(es)?|tumbles?|"
                  r"charges? (forward|toward|at|to)|teleports? (to|behind)|hops?|slides?|surges? forward|flies to|"
                  r"steps forward|propels?|(flings?|launch(es)?|pulls?) (him|her|it)self)\b", re.I)
SLOTS = "QWER"


def fetch(url, path):
    path = Path(path)
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-sim"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(data)
    tmp.rename(path)
    return path


def asset_path(client_path):
    """'/lol-game-data/assets/ASSETS/X.png' -> 'assets/x.png', relative to ASSET_ROOT."""
    return client_path.replace("/lol-game-data/assets/", "", 1).lstrip("/").lower()


def client_champion(key, cache):
    """Name, title, ability names, descriptions and icon paths from the client's champion file."""
    p = fetch(f"{ASSET_ROOT}v1/champions/{key}.json", Path(cache) / "gd" / "champions" / f"{key}.json")
    return json.loads(p.read_text()) if p else None


def clip_url(key, slot):
    k = f"{key:04d}"
    return f"{CLIP_CDN}/{k}/ability_{k}_{slot}1.webm"


def has_audio(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return bool(out.strip())


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout
    return float(out.strip())


def encode_segment(src, dst, width):
    """Shrinks one clip to a small H.264/AAC segment. Every segment gets the same
    codec settings and an audio track so they can be joined without re-encoding."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if has_audio(src):
        audio = ["-map", "0:a:0"]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
        audio = ["-map", "1:a:0", "-shortest"]
    cmd += ["-map", "0:v:0", *audio,
            "-vf", f"scale={width}:-2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "33",
            "-pix_fmt", "yuv420p", "-profile:v", "main", "-g", "15",
            "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-ar", "44100", str(dst)]
    subprocess.run(cmd, check=True)


def build_clip(champ, cache, out_dir, width):
    """Returns {slot: [start, duration]} for the joined clip, or None if Riot has no clips."""
    key = champ["key"]
    seg_dir = cache / "clip-segments" / str(width)
    seg_dir.mkdir(parents=True, exist_ok=True)
    segments = []
    for slot in SLOTS:
        seg = seg_dir / f"{champ['id']}_{slot}.mp4"
        if not seg.exists():
            raw = fetch(clip_url(key, slot), cache / "clips-raw" / f"{key:04d}_{slot}.webm")
            if raw is None:
                continue
            try:
                encode_segment(raw, seg, width)
            except subprocess.CalledProcessError:
                seg.unlink(missing_ok=True)
                continue
            finally:
                raw.unlink(missing_ok=True)  # the originals are large; keep only the small segment
        segments.append((slot, seg))
    if not segments:
        return None
    listing = seg_dir / f"{champ['id']}.txt"
    listing.write_text("".join(f"file '{p.resolve()}'\n" for _, p in segments))
    dst = out_dir / "clips" / f"{champ['id']}.mp4"
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                    "-movflags", "+faststart", str(dst)], check=True)
    listing.unlink()
    result, start = {}, 0.0
    for slot, seg in segments:
        d = duration(seg)
        result[slot] = [round(start, 3), round(d, 3)]
        start += d
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--traces", required=True, help="directory written by mayhem_sim --trace-dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--champions", default=str(Path(__file__).resolve().parent.parent / "data" / "champions.json"))
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/deeparam-sim"))
    ap.add_argument("--clips", action="store_true", help="download and join Riot's ability clips")
    ap.add_argument("--width", type=int, default=320, help="clip width in pixels")
    ap.add_argument("--jobs", type=int, default=6)
    args = ap.parse_args()

    from PIL import Image  # only needed here

    cache, out = Path(args.cache), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pool = json.load(open(args.champions))
    version = pool["meta"].get("game_version", "")

    combos_path = Path(args.champions).with_name("combos.json")
    combos = json.load(open(combos_path)) if combos_path.exists() else {}
    traces, champs = {}, []
    for c in pool["champions"]:
        tpath = Path(args.traces) / f"{c['id']}.json"
        if not tpath.exists():
            print(f"no trace for {c['id']}, skipped", file=sys.stderr)
            continue
        traces[c["id"]] = json.loads(tpath.read_text())
        gd = client_champion(c["champion_id"], cache)
        if gd is None:
            print(f"{c['id']} has no client champion file, skipped", file=sys.stderr)
            continue
        champs.append({
            "id": c["id"], "name": c["name"], "key": int(c["champion_id"]), "title": gd.get("title", ""),
            "role": c.get("role", ""), "combo": combos.get(c["id"], "QWER"),
            "radius": c["stats"].get("gameplay_radius", 65),
            "passive": gd["passive"]["name"],
            "spells": {s: gd["spells"][i]["name"] for i, s in enumerate(SLOTS)},
            "dash": "".join(s for i, s in enumerate(SLOTS) if DASH.search(gd["spells"][i]["description"].split(". ")[0])),
            "_icons": [asset_path(gd["squarePortraitPath"]), asset_path(gd["passive"]["abilityIconPath"])] +
                      [asset_path(gd["spells"][i]["abilityIconPath"]) for i in range(4)],
        })

    # Icon atlas: one row per champion.
    def icon(rel):
        p = fetch(ASSET_ROOT + rel, cache / "icons" / "client" / rel)
        return Image.open(p).convert("RGBA").resize((ICON, ICON), Image.LANCZOS) if p else None

    atlas = Image.new("RGBA", (ICON * 6, ICON * len(champs)), (0, 0, 0, 0))
    with cf.ThreadPoolExecutor(args.jobs) as ex:
        rows = list(ex.map(lambda c: [icon(r) for r in c["_icons"]], champs))
    for row, (c, icons) in enumerate(zip(champs, rows)):
        c["row"] = row
        for col, im in enumerate(icons):
            if im is not None:
                atlas.paste(im, (col * ICON, row * ICON))
        c["icons"] = c.pop("_icons")  # paths under icon_base, for pages without the atlas
    atlas.save(out / "sprites.webp", quality=88, method=6)

    if args.clips:
        done = 0

        def job(c):
            return c["id"], build_clip(c, cache, out, args.width)

        with cf.ThreadPoolExecutor(args.jobs) as ex:
            for cid, segs in ex.map(job, champs):
                done += 1
                next(c for c in champs if c["id"] == cid)["clip"] = segs
                print(f"\rclips {done}/{len(champs)} {cid:<14}", end="", file=sys.stderr, flush=True)
        print(file=sys.stderr)

    json.dump({"game_version": version, "icon_base": SITE_ICON_BASE, "icon_size": ICON, "local_clips": args.clips,
               "champions": champs}, open(out / "index.json", "w"), separators=(",", ":"))
    json.dump(traces, open(out / "traces.json", "w"), separators=(",", ":"))
    missing = [c["id"] for c in champs if args.clips and not c.get("clip")]
    print(f"{len(champs)} champions, {len(traces)} traces" + (f", no clips for: {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
