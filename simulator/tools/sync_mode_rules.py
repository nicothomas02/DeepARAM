#!/usr/bin/env python3
"""Copy the mode rules the guide and the simulator share from guide/mode_rules.json into
data/mayhem_rules.json, so both read the same numbers.

    python3 tools/sync_mode_rules.py           # update data/mayhem_rules.json
    python3 tools/sync_mode_rules.py --check   # exit 1 if it is out of date
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODE_RULES = os.path.join(HERE, "..", "..", "guide", "mode_rules.json")
RULES = os.path.join(HERE, "..", "data", "mayhem_rules.json")


def shared_values(mode):
    """mayhem_rules.json key -> value, from the guide's mode rules."""
    lr, crit = mode["longRange"], mode["critConversion"]
    return {
        "attack_speed_cap": mode["attackSpeedCap"],
        "crit_overflow_ad_per_percent": crit["adPerPercent"],
        "crit_overflow_adaptive_per_percent": crit["apPerPercent"],  # adaptive force counts as AP
        "long_range_start": lr["range"],
        "long_range_damage_near": round(1 - lr["reductionMin"], 4),
        "long_range_damage_far": round(1 - lr["reductionMax"], 4),
    }


def stale(rules, mode):
    """The shared keys whose value in mayhem_rules.json differs from the guide's."""
    have = rules["rules"]
    return {k: v for k, v in shared_values(mode).items() if k not in have or have[k]["value"] != v}


def main():
    with open(MODE_RULES, encoding="utf-8") as f:
        mode = json.load(f)
    with open(RULES, encoding="utf-8") as f:
        text = f.read()
    todo = stale(json.loads(text), mode)
    if "--check" in sys.argv:
        for k, v in todo.items():
            print(f"{k}: should be {v}")
        return 1 if todo else 0
    for k, v in todo.items():
        text, n = re.subn(rf'("{k}": \{{"value": )[^,}}]+', lambda m: m.group(1) + json.dumps(v), text)
        if not n:
            sys.exit(f"{k} is missing from {RULES}; add it by hand first")
    with open(RULES, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"updated {len(todo)} rule(s)" if todo else "already in sync")
    return 0


if __name__ == "__main__":
    sys.exit(main())
