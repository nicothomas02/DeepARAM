#!/usr/bin/env python3
"""Collect the Simulator's English page text into web/public/i18n/simulator/en.json, the dictionary the
site's languages are translated from (viewer/i18n.js looks text up by its English wording).

Reads the viewer's HTML (text, title, aria-label, placeholder), every T("...") in its scripts, the word
lists the scripts translate at run time (badges, damage sources, setting names and choices), and the
engine's setting descriptions (mayhem_sim --list --json).

    python3 tools/i18n_strings.py           # rewrite en.json
    python3 tools/i18n_strings.py --check   # exit 1 if en.json is out of date, or a language misses a key
"""
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.join(HERE, "..")
VIEWER = os.path.join(SIM, "viewer")
OUT_DIR = os.path.join(SIM, "..", "web", "public", "i18n", "simulator")
PAGES = ["index.html", "full.html", "team.html"]
SCRIPTS = ["replay.js", "sim-panel.js", "team.js"]
# The site's own Simulator components that use this dictionary (useT("simulator")).
SITE = [os.path.join(SIM, "..", "web", "src", "components", n) for n in ("SimReplayEmbed.tsx",)]
# Site code that adds text inside the Simulator page (the Pop out button), which i18n.js translates there.
INJECTED = [os.path.join(SIM, "..", "web", "src", "lib", "replay-pip.ts")]
ATTRS = {"title", "aria-label", "placeholder"}
# Words the scripts pass to T() through a variable.
SOURCES = ["Basic attacks", "Items and augments", "Passive"]


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip, self.out = 0, set()

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        for k, v in attrs:
            if k in ATTRS and v and re.search("[A-Za-z]{2}", v):
                self.out.add(" ".join(v.split()))

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, data):
        t = " ".join(data.split())
        if not self.skip and t and re.search("[A-Za-z]{2}", t):
            self.out.add(t)


def js_strings(src):
    out = set(m.group(2).encode().decode("unicode_escape").encode("latin-1").decode("utf-8")
              for m in re.finditer(r'\bT\((["`])((?:[^"\\`]|\\.)*)\1', src))
    # LABELS values, ADVANCED group names, CHOICES and ENEMY_STATS labels, CC badges, rarities.
    for block in ("LABELS", "CHOICES", "ENEMY_STATS", "ADVANCED", "CC_LOOK"):
        m = re.search(r"const %s = ([\[{].*?\n  [\]}]);" % block, src, re.S)
        if m:
            out.update(s for s in re.findall(r'"([^"]*[A-Za-z]{2}[^"]*)"', m.group(1))
                       if not re.fullmatch(r"[a-z_]+|#[0-9a-fA-F]+", s))
    m = re.search(r'\{ S: "Silver", G: "Gold", P: "Prismatic" \}', src)
    if m:
        out.update(["Silver", "Gold", "Prismatic"])
    return out


def settings():
    exe = os.path.join(SIM, "mayhem_sim")
    d = json.loads(subprocess.run([exe, "--list", "--json"], capture_output=True, text=True, check=True, cwd=SIM).stdout)
    return {s["description"][:1].upper() + s["description"][1:] for s in d["settings"]}


def collect():
    keys = set(SOURCES)
    for p in PAGES:
        t = Text()
        with open(os.path.join(VIEWER, p), encoding="utf-8") as f:
            t.feed(f.read())
        keys |= t.out
    for s in SCRIPTS:
        with open(os.path.join(VIEWER, s), encoding="utf-8") as f:
            keys |= js_strings(f.read())
    for p in SITE:
        with open(p, encoding="utf-8") as f:
            keys |= set(re.findall(r'\bt\(\s*"((?:[^"\\]|\\.)*)"', f.read()))
    for p in INJECTED:
        with open(p, encoding="utf-8") as f:
            keys |= set(re.findall(r'\.(?:textContent|title) = "([^"]+)"', f.read()))
    keys |= settings()
    return {k: k for k in sorted(keys)}


def main():
    en = collect()
    path = os.path.join(OUT_DIR, "en.json")
    if "--check" in sys.argv:
        with open(path, encoding="utf-8") as f:
            have = json.load(f)
        bad = sorted(set(en) ^ set(have))
        for k in bad:
            print(("missing from" if k in en else "stale in") + " en.json:", k)
        return 1 if bad else 0
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(en, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(en)} strings -> {os.path.relpath(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
