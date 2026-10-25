"""Write i18n/en.json for the Info page (guide/) and the champion pages (champions/): every English string the page
shows that doesn't come from the game in each language. Each other language's i18n/<code>.json maps the same keys.

Usage: python3 guide/i18n_keys.py   (after build_data.py and build_history.py; also run by tests/data to check the files)

Where the keys come from:
  index.html          elements marked data-t (their text), attributes named in data-t-attr, the <title>
  app.js              literals passed to t(), and the capitalised English labels in its tables (tab, rule and stat names)
  build_data.py       text written by hand: the mode's story, track notes, fast travel, units, set fallbacks
  data.js, history.js internal value names ("BaseDamage" shown as "Base Damage")
  profile.js          region names and difficulty levels (champion pages)
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "guide"))


def words(n):
    """The page's words(): CamelCase and snake_case value names as words."""
    n = re.sub(r"([a-z])([A-Z])", r"\1 \2", n)
    return re.sub(r"([A-Z])([A-Z][a-z])", r"\1 \2", n).replace("_", " ")


def load_js(path):
    with open(path, encoding="utf-8") as f:
        s = f.read()
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))


def literal(src, i):
    """The string literal starting at src[i] (a quote) and the index after it; template literals with ${} give None."""
    q, j, out = src[i], i + 1, []
    while src[j] != q:
        if src[j] == "\\":
            out.append({"n": "\n", "t": "\t"}.get(src[j + 1], src[j + 1]))
            j += 2
            continue
        if q == "`" and src.startswith("${", j):
            depth, j = 1, j + 2
            while depth:
                depth += {"{": 1, "}": -1}.get(src[j], 0)
                j += 1
            out = None  # a template with ${} isn't a fixed key
            continue
        if out is not None:
            out.append(src[j])
        j += 1
    return ("".join(out) if out is not None else None), j + 1


def t_calls(src):
    """String literals in the first argument of every t(...) call (both sides of a ternary count)."""
    keys = []
    for m in re.finditer(r"(?<![\w.$])t\(", src):
        i, depth = m.end(), 0
        while i < len(src):
            c = src[i]
            if c in "\"'`":
                s, i = literal(src, i)
                if depth == 0 and s is not None:
                    keys.append(s)
                continue
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif c == "," and depth == 0:
                break
            i += 1
    return keys


def labels(src):
    """Capitalised double-quoted labels (and "{n} word" ones): tab, rule, fact and stat names that reach t() through a
    variable."""
    out = []
    for m in re.finditer(r'"([A-Z{][^"\\]*)"', src):
        s = m.group(1)
        if s.startswith("{") and not re.match(r"^\{\w+\} \w", s):
            continue  # "{xp} XP per day" is a label; other strings starting with { aren't
        if re.search(r"[a-z]", s) and not re.match(r"^[A-Z][a-z]+[A-Z]\w*$", s) and s not in SKIP:
            out.append(s)
    return out


SKIP = {"ARAM: ", "IntersectionObserver", "DOMContentLoaded"}


def html_keys(path):
    with open(path, encoding="utf-8") as f:
        html = f.read()
    keys = [re.sub(r"\s+", " ", re.sub(r"&amp;", "&", m.group(1))).strip()
            for m in re.finditer(r"<[a-z0-9]+\b[^>]*\bdata-t\b(?!-)[^>]*>([^<]*)<", html)]
    for m in re.finditer(r"<[^>]*\bdata-t-attr=\"([^\"]+)\"[^>]*>", html):
        for a in m.group(1).split(","):
            v = re.search(rf'\b{re.escape(a)}="([^"]*)"', m.group(0))
            if v:
                keys.append(v.group(1))
    keys.append(re.search(r"<title>([^<]+)</title>", html).group(1))
    return keys


def guide_keys():
    import build_data as B
    keys = []
    for e in B.STORY:
        keys += [e["date"], e["text"]] if not re.match(r"^\d{4}-\d{2}$", e["date"]) else [e["text"]]
    O = B.OFFICIAL_TRACK
    keys += list(O["names"].values()) + list(O["notes"].values()) + [o["text"] for o in O["objectives"]] + [O["guaranteed"]]
    for f in B.WIKI_MECHANICS["fastTravel"]:
        keys += [f["map"], f["name"], f["text"]]
    keys += [n for n, _, _, _ in B.SUMMONS] + [t for _, _, _, t in B.SUMMONS]
    keys += ["Augment", "Emote", "Icon", "Title", "Reward", "A title", "Profile icon"]
    D = load_js(os.path.join(REPO, "guide", "data.js"))
    keys += [c["group"] for c in D["challenges"]]
    keys += [words(c["name"]) for it in D["itemChanges"] for c in it["changes"]]
    return keys


def champion_keys():
    D = load_js(os.path.join(REPO, "champions", "data.js"))
    keys = [words(m["name"]) for c in D["champions"] for m in c["mayhem"]]
    keys += [st["label"] for c in D["champions"] if c.get("builds") for st in c["builds"].get("styles") or []]
    keys += ["Mana", "Energy", "Mana regen (per 5s)", "Energy regen (per 5s)"]
    P = load_js(os.path.join(REPO, "champions", "profile.js"))
    keys += sorted({p["region"] for p in P.values() if p.get("region")} | {p["difficulty"] for p in P.values() if p.get("difficulty")})
    return keys


FOLDERS = {"guide": guide_keys, "champions": champion_keys}


def keys_for(folder):
    base = os.path.join(REPO, folder)
    with open(os.path.join(base, "app.js"), encoding="utf-8") as f:
        src = f.read()
    keys = html_keys(os.path.join(base, "index.html")) + t_calls(src) + labels(src) + FOLDERS[folder]()
    return list(dict.fromkeys(k for k in keys if k and k.strip()))


def main():
    for folder in FOLDERS:
        keys = keys_for(folder)
        out = os.path.join(REPO, folder, "i18n")
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "en.json"), "w", encoding="utf-8") as f:
            json.dump({k: k for k in keys}, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"{folder}: {len(keys)} strings")


if __name__ == "__main__":
    main()
