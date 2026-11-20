#!/usr/bin/env python3
"""Build the replay's Howling Abyss sounds: the map's ambience, the announcer's lines and a few Mayhem sounds.

Reads the Wwise banks in a client export (dump_map_assets.py output) and writes, into web/public/assets/sounds:

    ambience.m4a   the map's ambience, a loop (stereo)
    map.m4a        every other sound joined (mono)
    map.json       {"ambience": {file, length}, "file": "map.m4a",
                    "clips": {name: [start, length]},                     Mayhem sounds
                    "announcers": {voice: {line: [start, length]}}}       announcer lines

    python3 simulator/tools/build_map_sounds.py EXPORT_DIR [--vgmstream PATH] [--out DIR] [--dry-run]

Needs: pip install cdtb zstandard xxhash, vgmstream-cli (decodes Wwise audio) and ffmpeg (encodes AAC).
Event names are FNV-1 hashes in the banks; they are recovered from the strings in the export's game data,
plus the announcer's naming pattern (Play_vo_Announcer_<voice>_<line>).
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_game_sounds import Bank, embedded_wems, fnv1, wpk_wems  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
RATE = 44100
SOUNDS = "assets/sounds/wwise2016"
AMBIENCE = ("sfx/shared/env_map12_sfx", "Play_sfx_Env_Map12_Ambience_base")
# Mayhem sounds the replay plays: a champion kill, the Poro Charge waves and Hellbent's revive.
MAX_CLIP = 3.0  # seconds kept of each (the Poro missile's sound runs as long as its flight), faded out
CLIPS = {
    "kill": ("sfx/shared/mode_kiwi_sfx", "Play_sfx_Kiwi_Satisfaction_ChampionKill"),
    "poro": ("sfx/shared/mode_kiwi_sfx", "Play_sfx_Kiwi_Augment_PoroCharge_PoroMissile_Big"),
    "porohit": ("sfx/shared/mode_kiwi_sfx", "Play_sfx_Kiwi_Augment_PoroCharge_NormalHit"),
    "revive": ("sfx/shared/mode_kiwi_sfx", "Play_sfx_Kiwi_Augment_Hellbent_Revive_End"),
}
# Announcer voices: (bank, the voice's event prefixes). The first is the game's default.
VOICES = {
    "female1": ("vo/en_us/shared/announcer_global_female1_vo", ["Play_vo_Announcer_Female1_", "Play_vo_Announcer_Global_Female1_"]),
    "male1": ("vo/en_us/shared/announcer_global_male1_vo", ["Play_vo_Announcer_Male1_", "Play_vo_Announcer_Global_Male1_"]),
    "pyke": ("vo/en_us/shared/announcer_global_pyke_vo", ["Play_vo_Announcer_Global_Pyke_"]),
    "rhaast": ("vo/en_us/shared/announcer_global_kaynrhaast_vo", ["Play_vo_Announcer_Global_RhaastKayn_"]),
    "maverick": ("vo/en_us/shared/announcer_map12_crepe_vo", ["Play_vo_Announcer_Maverick_", "Play_vo_Announcer_Global_Maverick_"]),
    "pundit": ("vo/en_us/shared/announcer_map12_crepe_vo", ["Play_vo_Announcer_Pundit_", "Play_vo_Announcer_Global_Pundit_"]),
}
# Each line: the event endings to try, best first (after the voice's prefix).
LINES = {
    "first": ["FirstBloodYouYourTeam", "OnFirstBlood", "FirstBloodHeroYourTeam"],
    "kill": ["KillChampionYouHeroYourTeam", "OnChampionKillYouHeroYourTeam"],
    "slain": ["KillChampionHeroYouEnemyTeam", "OnChampionKillHeroYouEnemyTeam"],
    "double": ["DoubleKillYouYourTeam", "OnChampionDoubleKillYouYourTeam", "OnChampionDoubleKillYourTeam"],
    "triple": ["TripleKillYouYourTeam", "OnChampionTripleKillYouYourTeam", "OnChampionTripleKillYourTeam"],
    "quadra": ["QuadraKillYouYourTeam", "OnChampionQuadraKillYouYourTeam", "OnChampionQuadraKillYourTeam"],
    "penta": ["PentaKillYouYourTeam", "OnChampionPentaKillYouYourTeam", "OnChampionPentaKillYourTeam"],
    "ace": ["AceYourTeam", "OnAce", "OnAcepurple"],
    "victory": ["OnVictory"],
    "defeat": ["OnDefeat"],
}


class Banks:
    """An events bank and the media its sounds play, from <path>_events.bnk and <path>_audio.bnk/.wpk."""

    def __init__(self, export, path):
        base = os.path.join(export, SOUNDS, path)
        self.bank = Bank(open(base + "_events.bnk", "rb").read())
        self.media = {}
        for ext, read in ((".bnk", embedded_wems), (".wpk", wpk_wems)):
            if os.path.exists(base + "_audio" + ext):
                self.media.update(read(open(base + "_audio" + ext, "rb").read()))

    def has(self, name):
        return fnv1(name) in self.bank.objs

    def variations(self, name):
        return [[self.media[w] for w in v if w in self.media] for v in self.bank.variations(fnv1(name))]


def decode(vgm, wem, tmp, channels):
    """Raw 16-bit PCM at RATE with `channels` channels."""
    src, wav = os.path.join(tmp, "in.wem"), os.path.join(tmp, "out.wav")
    open(src, "wb").write(wem)
    subprocess.run([vgm, "-o", wav, src], capture_output=True, check=True)
    return subprocess.run(["ffmpeg", "-v", "error", "-i", wav, "-ac", str(channels), "-ar", str(RATE), "-f", "s16le", "-"],
                          capture_output=True, check=True).stdout


def loud(pcm):
    import array
    a = array.array("h", pcm[: len(pcm) // 2 * 2])
    s = a[::16]
    return len(s) > 0 and (sum(x * x for x in s) / len(s)) ** 0.5 > 150


def render(vgm, banks, name, tmp, channels=1):
    """The first variation of the event that isn't silent, its layers mixed."""
    for wems in banks.variations(name):
        try:
            layers = [decode(vgm, w, tmp, channels) for w in wems]
        except subprocess.CalledProcessError:
            continue
        if layers and any(loud(p) for p in layers):
            return mix(layers)
    return None


def mix(layers):
    import array
    if len(layers) == 1:
        return layers[0]
    tracks = [array.array("h", p[: len(p) // 2 * 2]) for p in layers]
    out = array.array("h", [0] * max(len(t) for t in tracks))
    for t in tracks:
        for i, v in enumerate(t):
            out[i] = max(-32768, min(32767, out[i] + v))
    return out.tobytes()


def fade_out(pcm, seconds=0.25):
    import array
    a = array.array("h", pcm)
    n = min(len(a), int(seconds * RATE))
    for k in range(n):
        a[len(a) - n + k] = int(a[len(a) - n + k] * (1 - k / n))
    return a.tobytes()


def encode(pcm, channels, path, bitrate):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", str(channels), "-i", "-",
                    "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", path], input=pcm, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("export", help="dump_map_assets.py output")
    ap.add_argument("--vgmstream", default=shutil.which("vgmstream-cli"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "assets", "sounds"))
    ap.add_argument("--dry-run", action="store_true", help="only print the events chosen")
    args = ap.parse_args()
    if not args.dry_run and not args.vgmstream:
        sys.exit("vgmstream-cli not found; install it or pass --vgmstream PATH")
    cache = {}

    def banks(path):
        if path not in cache:
            cache[path] = Banks(args.export, path)
        return cache[path]

    plan = {"clips": dict(CLIPS), "announcers": {}}
    for voice, (path, prefixes) in VOICES.items():
        got = {}
        for line, endings in LINES.items():
            name = next((p + e for e in endings for p in prefixes if banks(path).has(p + e)), None)
            if name:
                got[line] = (path, name)
        missing = [l for l in LINES if l not in got]
        print(voice, "missing: " + ", ".join(missing) if missing else "all lines", file=sys.stderr)
        plan["announcers"][voice] = got
    for key, (path, name) in CLIPS.items():
        if not banks(path).has(name):
            sys.exit(f"{name} isn't in {path}_events.bnk")
    if args.dry_run:
        print(json.dumps({"clips": plan["clips"], "announcers": {v: {l: n for l, (_, n) in g.items()} for v, g in plan["announcers"].items()}}, indent=1))
        return

    os.makedirs(args.out, exist_ok=True)
    gap = b"\0\0" * int(0.25 * RATE)
    pcm, at, out = bytearray(), 0, {"clips": {}, "announcers": {}}

    def add(clip):
        nonlocal at
        start = at / RATE
        pcm.extend(clip + gap)
        at += len(clip) // 2 + len(gap) // 2
        return [round(start, 3), round(len(clip) / 2 / RATE, 3)]

    with tempfile.TemporaryDirectory() as tmp:
        amb = render(args.vgmstream, banks(AMBIENCE[0]), AMBIENCE[1], tmp, channels=2)
        encode(amb, 2, os.path.join(args.out, "ambience.m4a"), "96k")
        out["ambience"] = {"file": "ambience.m4a", "length": round(len(amb) / 4 / RATE, 3)}
        for key, (path, name) in CLIPS.items():
            clip = render(args.vgmstream, banks(path), name, tmp)
            if clip:
                out["clips"][key] = add(fade_out(clip[: int(MAX_CLIP * RATE) * 2]))
        for voice, lines in plan["announcers"].items():
            for line, (path, name) in lines.items():
                clip = render(args.vgmstream, banks(path), name, tmp)
                if clip:
                    out["announcers"].setdefault(voice, {})[line] = add(clip)
    encode(bytes(pcm), 1, os.path.join(args.out, "map.m4a"), "64k")
    out["file"] = "map.m4a"
    with open(os.path.join(args.out, "map.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    for n in ("ambience.m4a", "map.m4a"):
        print(f"{n}: {os.path.getsize(os.path.join(args.out, n)) // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
