"""Merge `mayhem_sim --all --json` runs made with MAYHEM_ALL_SLICE into one best-builds file.

Usage: python3 tools/merge_best_builds.py OUT.json PART.json [PART.json ...]

Rows are sorted by mean DPS (highest first) and the Spearman against real damage share is recomputed the
way the engine does it (champions with real data and a good parse), so the result matches a single run (champions tied on damage share can move the last digit, as the engine's own sort leaves ties in no set order).
"""
import json
import sys


def spearman(a, b):
    def ranks(v):
        r = [0.0] * len(v)
        for pos, i in enumerate(sorted(range(len(v)), key=lambda i: v[i])):
            r[i] = float(pos)
        return r
    ra, rb, n = ranks(a), ranks(b), len(a)
    return 1.0 - 6.0 * sum((x - y) ** 2 for x, y in zip(ra, rb)) / (n * (n * n - 1.0))


def main(out, parts):
    raw = {}  # champion id -> its row exactly as the engine wrote it
    for p in parts:
        text = open(p).read()
        rows = json.loads(text)["champions"]
        lines = [l.rstrip(",") for l in text.splitlines()[1:-1]]
        for row, line in zip(rows, lines):
            assert json.loads(line)["champion"] == row["champion"], p
            raw[row["champion"]] = (row, line)
    rows = sorted(raw.values(), key=lambda x: -x[0]["summary"]["mean_dps"])
    good = [r for r, _ in rows if r["cn_damage_share"] is not None and r["parse_quality"] == "good"]
    rho = spearman([r["summary"]["mean_dps"] for r in good], [r["cn_damage_share"] for r in good]) if len(good) > 2 else 0.0
    with open(out, "w") as f:
        f.write('{"spearman_vs_cn_damage_share": %.3f, "champions": [\n' % rho)
        f.write(",\n".join(line for _, line in rows))
        f.write("\n]}\n")
    print(f"{out}: {len(rows)} champions, spearman {rho:.3f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
