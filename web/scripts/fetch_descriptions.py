"""Official augment and item descriptions, shown under the name on augment and item pages.

  English      web/src/data/descriptions.json  {"augments": {id: text}, "items": {id: text}}
  Other langs  web/public/i18n/descriptions/<code>.json, only where the text differs from English

Augments: the Guide's augment text (guide/augment_details.json and guide/i18n/augments/<code>.json), which already
has the game's values filled in. Items: the passives and actives of the client's items.json description (the stats
are on the page already); an item with neither gets Data Dragon's one-line summary. A passive or active's name is
wrapped in § so the page can set it in bold. Paragraphs are separated by a newline.

Usage (from the repo root, after the Guide data is built):
  python3 web/scripts/fetch_descriptions.py
"""
import html, json, os, re, sys, urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
ROOT = os.path.normpath(os.path.join(WEB, ".."))
OUT = os.path.join(WEB, "public", "i18n", "descriptions")
EN_OUT = os.path.join(WEB, "src", "data", "descriptions.json")
LANGS = os.path.join(WEB, "src", "i18n", "languages.json")

CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global"
DD = "https://ddragon.leagueoflegends.com"
UA = {"User-Agent": "deeparam-descriptions"}  # CommunityDragon refuses Python's default User-Agent
ARAM_MAP = "12"


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 2:
                raise


def tidy(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s or ""))
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in s.replace("\r", "").split("\n")]
    return "\n".join(l for l in lines if l)


def item_text(desc):
    """The passives and actives of an item description, each as '§Name§ what it does'."""
    body = re.sub(r"<stats>.*?</stats>", "", desc or "", flags=re.S)
    body = re.sub(r"<(rules|flavorText)>.*?</\1>", "", body, flags=re.S)
    body = re.sub(r"<(passive|active)>(.*?)</\1>\s*(?:<br\s*/?>\s*)*", lambda m: f"\n§{tidy(m.group(2))}§ ", body, flags=re.S)
    body = re.sub(r"<br\s*/?>", "\n", body)
    out = tidy(body)
    return "\n".join(l for l in out.split("\n") if not re.fullmatch(r"§[^§]*§", l))


def augments(code):
    if code == "en":
        d = json.load(open(os.path.join(ROOT, "guide", "augment_details.json"), encoding="utf-8"))["augments"]
    else:
        d = json.load(open(os.path.join(ROOT, "guide", "i18n", "augments", f"{code}.json"), encoding="utf-8"))["augments"]
    # The short description, else the tooltip where the description had only numbers the client doesn't hold.
    out = {k: tidy(v.get("text")) or tidy(v.get("tooltip")) for k, v in d.items()}
    return {k: v for k, v in out.items() if v}


def items(riot, version, aram):
    lo = "default" if riot == "en_US" else riot.lower()
    cd = {str(i["id"]): item_text(i.get("description")) for i in get(f"{CD}/{lo}/v1/items.json")}
    dd = get(f"{DD}/cdn/{version}/data/{riot}/item.json")["data"]
    out = {}
    for k in aram:
        text = cd.get(k) or tidy(dd.get(k, {}).get("plaintext"))
        if text:
            out[k] = text
    return out


def main():
    langs = json.load(open(LANGS, encoding="utf-8"))
    version = get(f"{DD}/api/versions.json")[0]
    dd_en = get(f"{DD}/cdn/{version}/data/en_US/item.json")["data"]
    aram = sorted(k for k, v in dd_en.items() if (v.get("maps") or {}).get(ARAM_MAP))
    en = {"augments": augments("en"), "items": items("en_US", version, aram)}
    with open(EN_OUT, "w", encoding="utf-8") as f:
        json.dump(en, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f"en: {len(en['augments'])} augments, {len(en['items'])} items")
    os.makedirs(OUT, exist_ok=True)

    def one(lang):
        local = {"augments": augments(lang["code"]), "items": items(lang["riot"], version, aram)}
        out = {kind: {k: v for k, v in sorted(local[kind].items()) if k in en[kind] and v != en[kind][k]} for kind in local}
        with open(os.path.join(OUT, f"{lang['code']}.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return lang["code"], sum(len(v) for v in out.values())

    failed = 0
    with cf.ThreadPoolExecutor(6) as pool:
        for fut in cf.as_completed([pool.submit(one, l) for l in langs if l["code"] != "en"]):
            try:
                code, n = fut.result()
                print(f"{code}: {n} descriptions")
            except Exception as e:
                failed += 1
                print(f"failed: {e}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
