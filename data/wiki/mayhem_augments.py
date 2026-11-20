#!/usr/bin/env python3
"""Mayhem augment descriptions from the official League wiki (Module:MayhemAugmentData/data), as plain text.

The game's own tooltips leave some augments blank or half-filled ({{Augment_..._Tooltip}} placeholders, values
the client fills in live). This file is the fallback for designers (data/checks/champion_pool.py) and for
the Chef Special rules. Writes data/wiki/mayhem_augments.json. Kept under data/wiki because it names its source.

    python3 data/wiki/mayhem_augments.py
"""
import json
import re
import urllib.request
from pathlib import Path

URL = ("https://wiki.leagueoflegends.com/en-us/api.php?action=parse&page=Module:MayhemAugmentData/data"
       "&prop=wikitext&format=json")
OUT = Path(__file__).with_name("mayhem_augments.json")


def plain(s):
    """Wiki template markup -> readable text: {{as|X|...}} -> X, {{pp|a to b}} -> a to b (by level), links -> label."""
    s = s.replace("\\n", " ").replace("<br>", " ")
    for _ in range(6):
        s = re.sub(r"\{\{pp\|([^{}|]+)(\|[^{}]*)?\}\}", lambda m: m.group(1).replace(";", "/") + " (by level)", s)
        s = re.sub(r"\{\{rd\|([^{}|]+)\|([^{}|]+)\}\}", r"\1 (melee) / \2 (ranged)", s)
        s = re.sub(r"\{\{fd\|([^{}|]+)\}\}", r"\1", s)
        s = re.sub(r"\{\{g\|([^{}|]+)\}\}", r"\1 gold", s)
        s = re.sub(r"\{\{tip\|[^{}|]+\|icononly\s*=\s*true\}\}", "", s)
        s = re.sub(r"\{\{(?:tip|ii|nie|ui|sbc|ai|cai|as|ci)\|([^{}|]+)(?:\|([^{}|]+))?[^{}]*\}\}",
                   lambda m: m.group(2) if m.group(2) and "=" not in m.group(2) and m.group(0).startswith(("{{tip", "{{ii")) else m.group(1), s)
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", s)
    s = s.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", s).strip()


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "deeparam-data/1.0"})
    text = json.load(urllib.request.urlopen(req, timeout=60))["parse"]["wikitext"]["*"]
    out = {}
    for m in re.finditer(r'\["([^"]+)"\]\s*=\s*\{(.*?)\n\s*\},', text, re.S):
        d = re.search(r'\["description"\]\s*=\s*"((?:[^"\\]|\\.)*)"', m.group(2), re.S)
        if d:
            out[m.group(1)] = plain(d.group(1))
    OUT.write_text(json.dumps(dict(sorted(out.items())), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(out)} augments -> {OUT}")


if __name__ == "__main__":
    main()
