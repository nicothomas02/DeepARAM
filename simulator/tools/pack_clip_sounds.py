#!/usr/bin/env python3
"""Packs each ability's sound from the site's ability preview clips into one small audio file for the
owner's 3D replay, so the replay needs no video clips.

Reads `sound` ({slot: [start, length]} in seconds) for every champion in viewer/replay-data/index.json and
cuts that stretch of audio from the clip /assets/clips/<k>/ability_<k>_<slot>1.webm. Writes
  OUT/sounds.m4a   every cut back to back (mono AAC)
  OUT/sounds.json  {"file": "sounds.m4a", "clips": {championId: {slot: [offset, length]}}}
the format replay.js already plays (the same as tools/build_game_sounds.py writes). Riot audio: the site
serves it to the owner only (web/src/middleware.ts).

  python3 tools/pack_clip_sounds.py --clips ../web/public/assets/clips --out ../web/public/assets/sounds
Needs ffmpeg.
"""
import argparse
import json
import os
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RATE = 44100


def cut(src, start, length, dst):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(length), "-i", src, "-vn", "-ac", "1",
                    "-ar", str(RATE), "-f", "s16le", dst], check=True)
    return os.path.getsize(dst) / 2 / RATE


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--index", default=os.path.join(HERE, "..", "viewer", "replay-data", "index.json"))
    ap.add_argument("--clips", required=True, help="folder of <k>/ability_<k>_<slot>1.webm")
    ap.add_argument("--out", required=True)
    ap.add_argument("--bitrate", default="64k")
    args = ap.parse_args()
    index = json.load(open(args.index))
    os.makedirs(args.out, exist_ok=True)
    clips, offset, missing = {}, 0.0, 0
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "all.raw")
        with open(raw, "wb") as all_pcm:
            for c in index["champions"]:
                k = str(c["key"]).zfill(4)
                for slot, (start, length) in sorted((c.get("sound") or {}).items()):
                    src = os.path.join(args.clips, k, f"ability_{k}_{slot}1.webm")
                    if not os.path.exists(src):
                        missing += 1
                        continue
                    part = os.path.join(tmp, "part.raw")
                    got = cut(src, start, length, part)
                    if got <= 0:
                        missing += 1
                        continue
                    all_pcm.write(open(part, "rb").read())
                    clips.setdefault(c["id"], {})[slot] = [round(offset, 3), round(got, 3)]
                    # A short gap of silence so a cut never runs into the next one.
                    gap = int(RATE * 0.05)
                    all_pcm.write(b"\0\0" * gap)
                    offset += got + gap / RATE
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", raw,
                        "-c:a", "aac", "-b:a", args.bitrate, "-movflags", "+faststart", os.path.join(args.out, "sounds.m4a")],
                       check=True)
    json.dump({"file": "sounds.m4a", "clips": clips}, open(os.path.join(args.out, "sounds.json"), "w"), separators=(",", ":"))
    print(f"{sum(len(v) for v in clips.values())} sounds for {len(clips)} champions, {offset:.0f} s"
          + (f", {missing} missing" if missing else ""))


if __name__ == "__main__":
    main()
