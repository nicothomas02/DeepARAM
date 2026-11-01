"""Official translated names for the site's other languages, written to web/public/i18n/names/<code>.json.

For each language in web/src/i18n/languages.json (English is the site's own text and is skipped):
  champions  Data Dragon champion.json for the live version, keyed by champion id (AurelionSol)
  titles     each champion's title ("the Nine-Tailed Fox") from the same file, keyed the same way
  items      the client's items.json (live), keyed by item id
  augments   the client's Mayhem augment list (live), keyed by augment id
  mode       the mode's own name in that language, from the client's queue list (queue 2400)
Only names that differ from English are kept; pages fall back to the English name.

Usage (from the repo root):
  python3 web/scripts/fetch_names.py
fetch_assets.py --refresh runs it too, so the names follow each patch.
"""
import json, os, re, sys, urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(WEB, "public", "i18n", "names")
LANGS = os.path.join(WEB, "src", "i18n", "languages.json")

CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global"
DD = "https://ddragon.leagueoflegends.com"
UA = {"User-Agent": "deeparam-names"}  # CommunityDragon refuses Python's default User-Agent
MODE_QUEUE = 2400
TAGS = re.compile(r"<[^>]+>")


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 2:
                raise


def clean(s):
    return TAGS.sub("", s or "").strip()


def names(riot, version):
    lo = "default" if riot == "en_US" else riot.lower()  # the client's English is its default locale
    champs = get(f"{DD}/cdn/{version}/data/{riot}/champion.json")["data"]
    items = get(f"{CD}/{lo}/v1/items.json")
    augs = get(f"{CD}/{lo}/v1/cherry-augments.json")
    queues = get(f"{CD}/{lo}/v1/queues.json")
    queue = queues.get(str(MODE_QUEUE)) if isinstance(queues, dict) else next((q for q in queues if q.get("id") == MODE_QUEUE), None)
    return {
        "mode": clean((queue or {}).get("name")),
        "champions": {k: clean(v["name"]) for k, v in champs.items()},
        "titles": {k: clean(v.get("title")) for k, v in champs.items()},
        "items": {str(i["id"]): clean(i.get("name")) for i in items},
        "augments": {str(a["id"]): clean(a.get("nameTRA")) for a in augs},
    }


def add_english_augments(augs):
    """Adds the English name of every augment new this patch to src/data/augment-names.json, which the pages read.
    Existing names stay as they are, so ids the client has since dropped keep theirs for older patches."""
    path = os.path.join(WEB, "src", "data", "augment-names.json")
    known = json.load(open(path, encoding="utf-8"))
    new = {k: v for k, v in augs.items() if v and k not in known}
    if new:
        known.update(new)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(known.items())), f, ensure_ascii=False, indent=0)
    print(f"en: {len(new)} new augment names")


def main():
    langs = json.load(open(LANGS, encoding="utf-8"))
    version = get(f"{DD}/api/versions.json")[0]
    en = names("en_US", version)
    os.makedirs(OUT, exist_ok=True)
    add_english_augments(en["augments"])

    def one(lang):
        local = names(lang["riot"], version)
        out = {"version": version, "mode": local["mode"] if local["mode"] != en["mode"] else ""}
        for kind in ("champions", "titles", "items", "augments"):
            out[kind] = {k: v for k, v in sorted(local[kind].items()) if v and v != en[kind].get(k)}
        with open(os.path.join(OUT, f"{lang['code']}.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return lang["code"], sum(len(out[k]) for k in ("champions", "items", "augments"))

    failed = 0
    with cf.ThreadPoolExecutor(6) as pool:
        for fut in cf.as_completed([pool.submit(one, l) for l in langs if l["code"] != "en"]):
            try:
                code, n = fut.result()
                print(f"{code}: {n} names")
            except Exception as e:
                failed += 1
                print(f"failed: {e}", file=sys.stderr)
    print(f"done: version {version}" + (f", {failed} failed" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
