"""Collects every English string The Kitchen, Infinite Ryze and Region Teams show and writes i18n/en.json (key = value), the list each
language file translates. Run after changing any Lab page, script or data:

    python3 tools/fun/i18n/build_keys.py

Sources: the static text and labelled attributes of each page, T("...") / tr("...") calls in the
scripts (both branches of a `cond ? "a" : "b"` first argument), the labels the scripts keep in tables,
and the data the pages render (cook build titles and text, augment text, regions, classes, Ryze's
item and augment tooltips). Champion, item and augment names are not keys: they come from the site's
official name files (web/public/i18n/names/<code>.json).
"""
import html.parser, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
FUN = os.path.dirname(HERE)
PAGES = ["index.html", "cook-builds/index.html", "region-teams/index.html", "ryze-calculator/index.html"]
SCRIPTS = ["index.html", "cook-builds/app.js", "region-teams/app.js", "ryze-calculator/app.js", "ryze-calculator/calc.js"]
STR = r'"((?:[^"\\]|\\.)*)"'


class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip, self.title = [], 0, False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        self.title = tag == "title"
        a = dict(attrs)
        for k in ("aria-label", "title", "placeholder"):
            if a.get(k):
                self.out.append(a[k])
        if tag == "meta" and a.get("name") == "description":
            self.out.append(a["content"])

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1
        self.title = False

    def handle_data(self, data):
        if self.skip:
            return
        t = re.sub(r"\s+", " ", data).strip()
        if not t or not re.search(r"[A-Za-z]", t):
            return
        self.out.extend(p.strip() for p in t.split(" · ")) if self.title else self.out.append(t)


def js_data(path, var):
    s = open(os.path.join(FUN, path), encoding="utf-8").read()
    return json.loads(s[s.index("{"):s.rstrip().rstrip(";").rindex("}") + 1])


def unescape(s):
    return json.loads('"' + s + '"')


def main():
    keys = []
    for p in PAGES:
        t = Text()
        t.feed(open(os.path.join(FUN, p), encoding="utf-8").read())
        keys += t.out
    for p in SCRIPTS:
        s = open(os.path.join(FUN, p), encoding="utf-8").read()
        keys += [unescape(m) for m in re.findall(r"\b(?:T|tr)\(\s*" + STR, s)]
        keys += [unescape(m) for pair in re.findall(r"\b(?:T|tr)\(\s*[^\"()]*\?\s*" + STR + r"\s*:\s*" + STR, s) for m in pair]
        keys += [unescape(m) for m in re.findall(r"\blabel: " + STR, s)]
    ryze = open(os.path.join(FUN, "ryze-calculator/app.js"), encoding="utf-8").read()
    keys += [unescape(m) for m in re.findall(r'\[' + STR + r', (?:fmt|pct|`)', ryze)]      # stats rows
    keys += [unescape(m) for m in re.findall(r'\["[QWE]", ' + STR + r'\]', ryze)]          # spell names

    cook = js_data("cook-builds/data.js", "COOK_DATA")
    for b in cook["builds"]:
        keys += [b["title"], b["why"], b["play"]]
        for a in b["augments"]:
            keys += [a["text"], a["rarity"]]
    regions = js_data("region-teams/data.js", "REGION_DATA")
    for r in regions["regions"]:
        keys.append(r["name"])
        for c in r["champions"]:
            keys += c["classes"]
    ryze_data = js_data("ryze-calculator/data.js", "RYZE_DATA")
    keys += [i["text"] for i in ryze_data["items"] if i.get("text")]
    keys += [a["text"] for a in ryze_data["augments"] if a.get("text")] + [a["tier"] for a in ryze_data["augments"]]

    seen, out = set(), {}
    for k in keys:
        if k and k not in seen and re.search(r"[A-Za-z]", k):
            seen.add(k)
            out[k] = k
    with open(os.path.join(HERE, "en.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} keys, {sum(len(k) for k in out)} characters")


if __name__ == "__main__":
    main()
