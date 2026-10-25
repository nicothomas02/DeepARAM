"""Keep the PBE tab's translation files in step with its data.

    python3 tools/datamine/pbe_i18n.py          # rewrite pbe-data/en.json, drop stale keys, list what's missing
    python3 tools/datamine/pbe_i18n.py --check  # only list what's missing (exit 1 if anything is)

The page's own wording lives in web/public/i18n/pbe/ and the countdown's in patch-countdown/ (both
edited by hand). Every change line, description and note from data/pbe/kiwi-s3.json and tracker.json
is a key in web/public/i18n/pbe-data/en.json, and each other language maps the same keys. After a data
update, translate the keys this lists as missing into each language file, keeping {placeholders},
numbers and champion/item/augment names exactly as written; the site's unit tests fail until every
language has every key.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
I18N = os.path.join(ROOT, "web", "public", "i18n")
LANGS = [l["code"] for l in json.load(open(os.path.join(ROOT, "web", "src", "i18n", "languages.json"))) if l["code"] != "en"]


def data_keys():
    d = json.load(open(os.path.join(ROOT, "data", "pbe", "kiwi-s3.json")))
    tracker_file = os.path.join(ROOT, "data", "pbe", "tracker.json")
    t = json.load(open(tracker_file)) if os.path.exists(tracker_file) else {"entries": []}
    out = []

    def add(*xs):
        out.extend(x for x in xs if isinstance(x, str) and x.strip())

    m = d["meta"]
    add(m["label"], f"Mayhem {m['label']} on the test server.", m["caveat"], *m["notes"])
    add(d["headliners"]["summary"], *(h["effect"] for h in d["headliners"]["list"]))
    add(d["fame"]["summary"], *(o for b in d["fame"]["bands"] for o in b["sampleObjectives"]))
    for a in d["augments"]["added"]:
        add(a.get("description"))
    for a in d["augments"]["changed"]:
        for c in a["changes"]:
            add(c["stat"], c["live"], c["pbe"])
    for o in d["championOverrides"]:
        add(o["live"], o["pbe"], o.get("note"))
    add(d["championChanges"]["summary"], *(x for c in d["championChanges"]["list"] for x in c["changes"]))
    add(d["itemChanges"]["summary"], *(x for c in d["itemChanges"]["list"] for x in c["changes"]), *d["itemChanges"].get("outsideMayhemShop", []))
    add(*d["modeChanges"])
    add(*(l["text"] for e in t["entries"] for l in e["lines"]))
    return sorted(set(out))


def load(ns, code):
    p = os.path.join(I18N, ns, f"{code}.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def save(ns, code, d):
    os.makedirs(os.path.join(I18N, ns), exist_ok=True)
    with open(os.path.join(I18N, ns, f"{code}.json"), "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def main():
    check = "--check" in sys.argv
    if not check:
        keys = data_keys()
        save("pbe-data", "en", {k: k for k in keys})
        for code in LANGS:
            d = load("pbe-data", code)
            save("pbe-data", code, {k: v for k, v in d.items() if k in keys})
    missing = 0
    for ns in ("pbe", "pbe-data", "patch-countdown"):
        en = load(ns, "en")
        for code in LANGS:
            gap = [k for k in en if not load(ns, code).get(k, "").strip()]
            if gap:
                missing += len(gap)
                print(f"{ns}/{code}.json: {len(gap)} missing")
    print(f"{missing} translations missing" if missing else "All languages complete")
    sys.exit(1 if check and missing else 0)


if __name__ == "__main__":
    main()
