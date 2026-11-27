"""Add a patch's ARAM: Mayhem notes to data/official/patch_notes.json from the official patch notes page.

The pooling rule (data/aramhex/common.py, POOL_DRIFT_CHANGED) fades augments these notes changed faster, and the
tier list's "{live}+" keeps champions they changed on the live patch alone (web/src/lib/pool-change.ts), so each new
patch needs its entry. Runs on patch day (.github/workflows/patch-day.yml); safe to re-run (replaces that patch's
entry, keeps everything else).

Usage: python3 data/official/patch_notes.py 16.24[.1]       (game version; the page is patch-26-24-notes)
       python3 data/official/patch_notes.py 16.24 --html page.html   (parse a saved page instead of fetching)"""
import argparse
import html
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "patch_notes.json")
URL = "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-{season}-{patch}-notes/"


def clean(x):
    return re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", x)).replace("\xa0", " ")).strip()


def section(page, sid):
    i = page.find(f'id="{sid}"')
    if i < 0:
        return ""
    j = page.find("<h2", i + 10)
    return page[i: j if j > 0 else len(page)]


def blocks(seg):
    parts = re.split(r"<h4[^>]*>(.*?)</h4>", seg, flags=re.S)
    return [(clean(a), b) for a, b in zip(parts[1::2], parts[2::2])], parts[0]


def named(body, new_heading=False):
    """Entries written as <p><strong>Name</strong></p> followed by <ul><li> change lines or a blockquote (new or
    reworked effect)."""
    out, cur = [], None
    for m in re.finditer(r"<p>(.*?)</p>|<ul>(.*?)</ul>|<blockquote[^>]*>(.*?)</blockquote>", body, re.S):
        if m.group(1) is not None:
            inner, t = m.group(1), clean(m.group(1))
            if "<strong>" in inner and t and len(t) < 70 and not t.endswith("."):
                new = t.startswith("NEW") or new_heading
                cur = {"name": re.sub(r"^NEW\s*", "", t).strip(), "changes": [], "new": new}
                out.append(cur)
            elif cur is not None and t:
                cur["changes"].append(t)
        elif m.group(2) is not None and cur is not None:
            cur["changes"] += [clean(x) for x in re.findall(r"<li>(.*?)</li>", m.group(2), re.S) if clean(x)]
        elif m.group(3) is not None and cur is not None:
            t = clean(m.group(3))
            if t:
                cur["changes"].append(t)
    for e in out:
        if e.pop("new"):
            e["changes"] = [c if c.startswith("NEW") else "NEW Effect: " + c for c in e["changes"]] or ["NEW Augment"]
    return out


def lines(body):
    return [clean(x) for x in re.findall(r"<li>(.*?)</li>", body, re.S) if clean(x)] or \
           [clean(x) for x in re.findall(r"<p>(.*?)</p>", body, re.S) if clean(x)]


def parse(page, game_version, url, date=""):
    """One patch_notes.json entry from the page's HTML."""
    major, minor = game_version.split(".")[:2]
    m = re.search(r'<time[^>]*datetime="([0-9-]{10})', page)
    seg = section(page, "patch-aram:-mayhem")
    bl, head = blocks(seg)
    intro = " ".join(clean(x) for x in re.findall(r"<blockquote[^>]*>(.*?)</blockquote>", head, re.S))
    e = {"patch": f"{int(major) + 10}.{int(minor)}", "gameVersion": f"{major}.{minor}", "url": url,
         "date": m.group(1) if m else date, "noMayhemSection": not seg, "intro": intro, "champions": [],
         "augments": [], "items": [], "systems": [], "bugfixes": [], "aram": {}}
    for title, body in bl:
        t = title.lower()
        if t == "champions":
            e["champions"] = named(body)
        elif "augment" in t:
            if "removed" in t:
                e["augments"] += [{"name": n, "changes": ["REMOVED Augment: removed from the pool"]} for n in lines(body)]
            else:
                e["augments"] += named(body, new_heading="new" in t)
        elif t == "items":
            e["items"] = named(body)
        elif t == "headliners":
            ents = named(body)
            e["systems"] += [f"Headliner {x['name']}: {c}" for x in ents for c in (x["changes"] or ["NEW Headliner"])]
            if not ents:
                e["systems"] += [f"Headliners: {x}" for x in lines(body)]
        elif t == "systems":
            ents = named(body)
            e["systems"] += [f"{x['name']}: {c}" for x in ents for c in x["changes"]] if ents else lines(body)
        elif "bug" in t:
            e["bugfixes"] = lines(body)
        else:
            e["systems"] += [f"{title}: {x}" for x in lines(body)]
    ab, _ = blocks(section(page, "patch-aram"))
    for title, body in ab:
        if title.lower() == "champions":
            e["aram"] = {"champions": named(body)}
    return e


def schedule_date(game_version):
    """Riot's release date for the patch (data/patch-schedule.json), or ""."""
    major, minor = (int(x) for x in game_version.split(".")[:2])
    try:
        with open(os.path.join(HERE, "..", "patch-schedule.json"), encoding="utf-8") as f:
            rows = json.load(f)["patches"]
    except (OSError, ValueError, KeyError):
        return ""
    for r in rows:
        s, n = (int(x) for x in r["patch"].split(".")[:2])
        if (s, n) == (major + 10, minor):
            return r.get("date", "")
    return ""


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (patch notes reader)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def save(entry):
    with open(OUT, encoding="utf-8") as f:
        d = json.load(f)
    old = [p for p in d["patches"] if p["patch"] == entry["patch"]]
    if old and not entry["champions"] and not entry["augments"] and (old[0]["champions"] or old[0]["augments"]):
        print(f"{entry['patch']}: page parsed empty, keeping the saved entry")
        return False
    d["patches"] = [entry] + [p for p in d["patches"] if p["patch"] != entry["patch"]]
    d["patches"].sort(key=lambda p: tuple(int(x) for x in p["patch"].split(".")), reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
        f.write("\n")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("version", help="game version, e.g. 16.24 or 16.24.1")
    ap.add_argument("--html", help="parse this saved page instead of fetching")
    a = ap.parse_args()
    major, minor = a.version.split(".")[:2]
    url = URL.format(season=int(major) + 10, patch=int(minor))
    try:
        page = open(a.html, encoding="utf-8").read() if a.html else fetch(url)
    except Exception as err:  # the page may not be up yet: keep what's saved
        print(f"could not read {url}: {err}")
        return 1
    e = parse(page, a.version, url, schedule_date(a.version))
    if save(e):
        print(f"{e['patch']}: {len(e['champions'])} champions, {len(e['augments'])} augments, "
              f"{len(e['systems'])} system lines{' (no Mayhem section)' if e['noMayhemSection'] else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
