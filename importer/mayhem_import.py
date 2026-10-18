#!/usr/bin/env python3
"""Import ARAM Mayhem match history from the League client on macOS.

The approach follows mayhem-tracker (https://github.com/Yhprum/mayhem-tracker,
MIT, by Ryan Murphy): the client's own match list (LCU) only ever returns the
last 20 games, so match ids come from Riot's match-history service (SGP), the
same one the client uses, filtered to the Mayhem queues. Each id is then
fetched in full through the local client.

Riot only serves an account's last 1000 matches across all queues, so that is
as far back as any run can reach. Older games survive only in an archive you
already have: this script merges into it and never removes games, so running
it regularly keeps a complete history.

Needs only macOS's built-in python3 and curl. League must be running and
signed in. Usage:

    python3 mayhem_import.py -o ~/Downloads/mayhem-backup.json

Riot documents the League client's local API as "not officially supported for
use with third party applications". It's the only way to read Mayhem games
(Riot's public match API leaves them out), so this keeps using it, but any
client patch can change or remove an endpoint without warning. If an import
suddenly fails after a League update, check the endpoints below first.

With --serve, the helper also records the Live Client Data API that League
runs on 127.0.0.1:2999 during a game (see LIVE_FORMAT). It only reads and
saves what the game reports; it never shows anything during the game.
"""

import argparse
import atexit
import base64
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

CONSTANTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "constants")


def mayhem_queue_ids():
    """Mayhem queues from Riot's official queue list (data/constants/queues.json).
    2450 also serves Mayhem games but isn't on the list yet, so it's always included."""
    ids = {2400, 2450}
    try:
        with open(os.path.join(CONSTANTS_DIR, "queues.json")) as f:
            ids |= {q["queueId"] for q in json.load(f) if "mayhem" in (q.get("description") or "").lower()}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return tuple(sorted(ids))


MAYHEM_QUEUE_IDS = mayhem_queue_ids()

LOCKFILE_CANDIDATES = [
    "/Applications/League of Legends.app/Contents/LoL/lockfile",
    os.path.expanduser("~/Applications/League of Legends.app/Contents/LoL/lockfile"),
]

SGP_HOSTS = [
    "https://usw2-red.pp.sgp.pvp.net",
    "https://euc1-red.pp.sgp.pvp.net",
    "https://apne1-red.pp.sgp.pvp.net",
    "https://apse1-red.pp.sgp.pvp.net",
]
SGP_HOST_BY_REGION = {
    **dict.fromkeys(["NA", "BR", "LAN", "LAS", "LA1", "LA2"], SGP_HOSTS[0]),
    **dict.fromkeys(["EUW", "EUNE", "EUN", "TR", "RU", "ME"], SGP_HOSTS[1]),
    **dict.fromkeys(["KR", "JP"], SGP_HOSTS[2]),
    **dict.fromkeys(["OCE", "OC1", "PH", "SG", "TH", "TW", "VN"], SGP_HOSTS[3]),
}
# The service clamps count to 200, so asking for more just gets 200
SGP_PAGE_SIZE = 200
SGP_HISTORY_CAP = 1000
# Safety bound; paging normally ends on a short page well before this
SGP_MAX_PAGES = 25
SGP_MAYHEM_TAGS = "&".join(f"tag=q_{q}" for q in MAYHEM_QUEUE_IDS) + "&tagsQueryType=OR"
SGP_ALL_TAGS = "tagsQueryType=AND"

# Riot's root for the certificate the client serves on localhost (valid to 2043)
RIOT_ROOT_CA = """-----BEGIN CERTIFICATE-----
MIIEIDCCAwgCCQDJC+QAdVx4UDANBgkqhkiG9w0BAQUFADCB0TELMAkGA1UEBhMC
VVMxEzARBgNVBAgTCkNhbGlmb3JuaWExFTATBgNVBAcTDFNhbnRhIE1vbmljYTET
MBEGA1UEChMKUmlvdCBHYW1lczEdMBsGA1UECxMUTG9MIEdhbWUgRW5naW5lZXJp
bmcxMzAxBgNVBAMTKkxvTCBHYW1lIEVuZ2luZWVyaW5nIENlcnRpZmljYXRlIEF1
dGhvcml0eTEtMCsGCSqGSIb3DQEJARYeZ2FtZXRlY2hub2xvZ2llc0ByaW90Z2Ft
ZXMuY29tMB4XDTEzMTIwNDAwNDgzOVoXDTQzMTEyNzAwNDgzOVowgdExCzAJBgNV
BAYTAlVTMRMwEQYDVQQIEwpDYWxpZm9ybmlhMRUwEwYDVQQHEwxTYW50YSBNb25p
Y2ExEzARBgNVBAoTClJpb3QgR2FtZXMxHTAbBgNVBAsTFExvTCBHYW1lIEVuZ2lu
ZWVyaW5nMTMwMQYDVQQDEypMb0wgR2FtZSBFbmdpbmVlcmluZyBDZXJ0aWZpY2F0
ZSBBdXRob3JpdHkxLTArBgkqhkiG9w0BCQEWHmdhbWV0ZWNobm9sb2dpZXNAcmlv
dGdhbWVzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKoJemF/
6PNG3GRJGbjzImTdOo1OJRDI7noRwJgDqkaJFkwv0X8aPUGbZSUzUO23cQcCgpYj
21ygzKu5dtCN2EcQVVpNtyPuM2V4eEGr1woodzALtufL3Nlyh6g5jKKuDIfeUBHv
JNyQf2h3Uha16lnrXmz9o9wsX/jf+jUAljBJqsMeACOpXfuZy+YKUCxSPOZaYTLC
y+0GQfiT431pJHBQlrXAUwzOmaJPQ7M6mLfsnpHibSkxUfMfHROaYCZ/sbWKl3lr
ZA9DbwaKKfS1Iw0ucAeDudyuqb4JntGU/W0aboKA0c3YB02mxAM4oDnqseuKV/CX
8SQAiaXnYotuNXMCAwEAATANBgkqhkiG9w0BAQUFAAOCAQEAf3KPmddqEqqC8iLs
lcd0euC4F5+USp9YsrZ3WuOzHqVxTtX3hR1scdlDXNvrsebQZUqwGdZGMS16ln3k
WObw7BbhU89tDNCN7Lt/IjT4MGRYRE+TmRc5EeIXxHkQ78bQqbmAI3GsW+7kJsoO
q3DdeE+M+BUJrhWorsAQCgUyZO166SAtKXKLIcxa+ddC49NvMQPJyzm3V+2b1roP
SvD2WV8gRYUnGmy/N0+u6ANq5EsbhZ548zZc+BI4upsWChTLyxt2RxR7+uGlS1+5
EcGfKZ+g024k/J32XP4hdho7WYAS2xMiV83CfLR/MNi8oSMaVQTdKD8cpgiWJk3L
XWehWA==
-----END CERTIFICATE-----
"""


class ImportFailed(Exception):
    """A problem the person can fix (League closed, wrong archive...). The message says how."""


class HttpError(Exception):
    def __init__(self, status, url):
        super().__init__(f"HTTP {status} from {url}")
        self.status = status


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------- HTTP via curl ----------
# curl uses the macOS keychain for Riot's public hosts, which python.org builds
# of Python don't. Secrets go in through stdin, never on the command line where
# other processes could see them.

def curl_json(url, *, auth_header=None, cacert=None, timeout=30):
    config = f'url = "{url}"\n' + (f'header = "Authorization: {auth_header}"\n' if auth_header else "")
    cmd = ["curl", "-sS", "--max-time", str(timeout), "-w", "\n%{http_code}", "-K", "-"]
    if cacert:
        cmd += ["--cacert", cacert]
    res = subprocess.run(cmd, input=config, capture_output=True, text=True)
    if res.returncode != 0:
        raise ConnectionError(f"{url}: {res.stderr.strip() or 'curl exit ' + str(res.returncode)}")
    body, _, status = res.stdout.rpartition("\n")
    status = int(status or 0)
    if status < 200 or status >= 300:
        raise HttpError(status, url)
    return json.loads(body) if body.strip() else None


_riot_ca = None


def riot_ca():
    """A file holding Riot's root certificate, which signs the client's and the game's local APIs."""
    global _riot_ca
    ca = os.environ.get("MAYHEM_LCU_CA")  # tests point this at their own CA
    if ca:
        return ca
    if not _riot_ca:
        fd, _riot_ca = tempfile.mkstemp(suffix=".pem")
        with os.fdopen(fd, "w") as f:
            f.write(RIOT_ROOT_CA)
        atexit.register(os.unlink, _riot_ca)
    return _riot_ca


class Lcu:
    """The League client's local API, read-only, on 127.0.0.1."""

    def __init__(self, port, password):
        self.base = f"https://127.0.0.1:{port}"
        token = base64.b64encode(f"riot:{password}".encode()).decode()
        self.auth = f"Basic {token}"
        self.cacert = riot_ca()

    def get(self, path):
        return curl_json(self.base + path, auth_header=self.auth, cacert=self.cacert)


def find_client(lockfile=None):
    paths = [lockfile] if lockfile else LOCKFILE_CANDIDATES
    for p in paths:
        try:
            text = open(p).read().strip()
        except OSError:
            continue
        # "LeagueClient:<pid>:<port>:<password>:<protocol>"
        m = re.match(r"^[^:]+:(\d+):(\d+):(.+):https?$", text)
        if m:
            return Lcu(m.group(2), m.group(3))
    if lockfile:
        raise ImportFailed(f"Couldn't read a League lockfile at {lockfile}.")
    # Fall back to the running client's command line, for installs elsewhere
    out = subprocess.run(["ps", "-A", "-o", "args="], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "LeagueClientUx" not in line:
            continue
        port = re.search(r"--app-port=(\d+)", line)
        pw = re.search(r"--remoting-auth-token=([\w-]+)", line)
        if port and pw:
            return Lcu(port.group(1), pw.group(1))
    raise ImportFailed("League isn't running. Start it, sign in, and run this again.")


# ---------- Riot match-history service (SGP) ----------

def sgp_token(lcu):
    # The RSO access token is what the service accepts now; the league-session
    # token is the older fallback
    try:
        rso = lcu.get("/lol-rso-auth/v1/authorization/access-token")
        token = rso if isinstance(rso, str) else (rso or {}).get("token")
        if token:
            return token
    except (HttpError, ConnectionError):
        pass
    token = lcu.get("/lol-league-session/v1/league-session-token")
    if not isinstance(token, str) or not token:
        raise ImportFailed("The League client hasn't finished signing in. Try again in a moment.")
    return token


def sgp_url(host, puuid, start, count, tags=SGP_ALL_TAGS):
    return (f"{host}/match-history-query/v1/products/lol/player/{puuid}"
            f"?startIndex={start}&count={count}&{tags}")


def sgp_get(host, puuid, token, start, count, tags=SGP_ALL_TAGS, timeout=30):
    return curl_json(sgp_url(host, puuid, start, count, tags),
                     auth_header=f"Bearer {token}", timeout=timeout)


def find_sgp_host(lcu, puuid, token, override=None):
    if override:
        return override
    guess = None
    try:
        region = (lcu.get("/riotclient/region-locale") or {}).get("region", "")
        guess = SGP_HOST_BY_REGION.get(str(region).upper())
    except (HttpError, ConnectionError):
        pass
    # Sharded by geography, not game region, so the guess is only a first try
    for host in ([guess] if guess else []) + [h for h in SGP_HOSTS if h != guess]:
        try:
            sgp_get(host, puuid, token, 0, 1, timeout=8)
            return host
        except (HttpError, ConnectionError):
            continue
    raise ImportFailed("Couldn't reach match history for your region.")


def walk_ids(host, puuid, token, tags, known, full):
    """Match ids newest first. Unless full, stops at the first page we already have."""
    ids = []
    for page in range(SGP_MAX_PAGES):
        body = sgp_get(host, puuid, token, page * SGP_PAGE_SIZE, SGP_PAGE_SIZE, tags)
        if not isinstance(body, list) or not body:
            return ids, "exhausted"
        # Ids arrive platform-prefixed, e.g. "NA1_5616465966"
        page_ids = []
        for raw in body:
            try:
                page_ids.append(int(str(raw).split("_")[-1]))
            except ValueError:
                pass
        ids += page_ids
        if len(body) < SGP_PAGE_SIZE:
            return ids, "exhausted"
        if not full and known and all(i in known for i in page_ids):
            return ids, "known"
    return ids, "page-limit"


def history_window_full(host, puuid, token):
    # History right up to the cap and nothing past it means Riot cut it off
    try:
        inside = sgp_get(host, puuid, token, SGP_HISTORY_CAP - 10, SGP_PAGE_SIZE)
        if not inside:
            return False
        return sgp_get(host, puuid, token, SGP_HISTORY_CAP, SGP_PAGE_SIZE) == []
    except (HttpError, ConnectionError):
        return False


# ---------- archive file ----------

def game_puuids(game):
    for pi in game.get("participantIdentities") or []:
        p = (pi.get("player") or {}).get("puuid")
        if p:
            yield p


def load_archive(path):
    """Returns (container, games). container is whatever shape the file had."""
    if not os.path.exists(path):
        return None, []
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, data
    for key in ("games", "matches", "data"):
        if isinstance(data.get(key), list):
            return data, data[key]
    raise ImportFailed(f"{path} isn't a match archive this script recognizes. Pick a different -o file.")


def archive_owner(container, games):
    if isinstance(container, dict) and container.get("puuid"):
        return container["puuid"]
    counts = collections.Counter(p for g in games for p in game_puuids(g))
    return counts.most_common(1)[0][0] if counts else None


def save_archive(path, container, games, summoner, owned=None):
    games.sort(key=lambda g: g.get("gameCreation") or 0, reverse=True)
    if isinstance(container, list):
        out = games
    else:
        out = container if isinstance(container, dict) else {}
        key = next((k for k in ("games", "matches", "data") if isinstance(out.get(k), list)), "games")
        out.setdefault("puuid", summoner["puuid"])
        out.setdefault("gameName", summoner.get("gameName"))
        out.setdefault("tagLine", summoner.get("tagLine"))
        out["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        out[key] = games
        if owned:
            out["owned"] = owned
    # Write beside the target, then swap, so a failed save never eats the archive
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".mayhem-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(out, f, indent=1)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


# ---------- collection ----------
# Champions and skins the account owns (not rentals or the free rotation), for My Stats' banner picker and
# the site's "Champions I own" filter. Kept in the archive as {"champions": [ids], "skins": [ids]}.

def fetch_collection(lcu, summoner):
    sid = summoner.get("summonerId")
    if not sid:
        return None
    try:
        champs = lcu.get(f"/lol-champions/v1/inventories/{sid}/champions-minimal") or []
        skins = lcu.get(f"/lol-champions/v1/inventories/{sid}/skins-minimal") or []
    except (HttpError, ConnectionError, ValueError):
        return None
    owned = lambda x: bool((x.get("ownership") or {}).get("owned"))
    return {
        "champions": sorted(c["id"] for c in champs if c.get("id", -1) > 0 and owned(c)),
        "skins": sorted(k["id"] for k in skins if isinstance(k.get("id"), int) and owned(k)),
    }


# ---------- kill positions ----------
# The client keeps a timeline for each game; its CHAMPION_KILL events carry map
# positions, which the dashboard's kill map draws. Each game stores a compact
# list under "killMap": [seconds, x, y, killerId, victimId] per kill, with
# participant ids as in the game. None means the client had no timeline.

FETCH_WORKERS = 6  # games asked of the League client at once
TIMELINES_PER_RUN = 200


def compact_kills(timeline):
    kills = []
    for frame in (timeline or {}).get("frames") or []:
        for ev in frame.get("events") or []:
            if str(ev.get("type", "")).upper() != "CHAMPION_KILL":
                continue
            pos = ev.get("position") or {}
            if pos.get("x") is None or pos.get("y") is None:
                continue
            kills.append([round((ev.get("timestamp") or 0) / 1000), pos["x"], pos["y"],
                          ev.get("killerId") or 0, ev.get("victimId") or 0])
    return kills


def fill_kill_maps(lcu, games, progress=log, limit=TIMELINES_PER_RUN):
    """Adds "killMap" to games that don't have one yet. Returns how many changed."""
    todo = [g for g in games if "killMap" not in g and g.get("gameId")][:limit]
    if not todo:
        return 0
    progress(f"Fetching kill positions for {len(todo)} games.")

    def fetch(game):
        try:
            return lcu.get(f"/lol-match-history/v1/game-timelines/{game['gameId']}")
        except (HttpError, ConnectionError) as e:
            return e

    changed = 0
    with ThreadPoolExecutor(FETCH_WORKERS) as pool:
        for n, (game, timeline) in enumerate(zip(todo, pool.map(fetch, todo)), 1):
            if isinstance(timeline, HttpError):
                if timeline.status == 404:
                    game["killMap"] = None
                    changed += 1
            elif not isinstance(timeline, ConnectionError):  # a later run retries those
                game["killMap"] = compact_kills(timeline)
                changed += 1
            if n % 25 == 0 or n == len(todo):
                progress(f"  [{n}/{len(todo)}] kill positions")
    return changed


# ---------- import ----------

def my_pick(game, puuid):
    """The champion this player played in a game and whether they won, for the import animation."""
    me = next((pi.get("participantId") for pi in game.get("participantIdentities") or []
               if (pi.get("player") or {}).get("puuid") == puuid), None)
    p = next((p for p in game.get("participants") or [] if p.get("participantId") == me), None)
    return {"champion": p.get("championId"), "win": bool((p.get("stats") or {}).get("win"))} if p else None


def run_import(out, full=False, lockfile=None, sgp_host=None, progress=log, on_game=None):
    """Merge new Mayhem games from the signed-in client into `out`. Returns a summary dict."""
    container, games = load_archive(out)
    lcu = find_client(lockfile)
    try:
        summoner = lcu.get("/lol-summoner/v1/current-summoner")
    except (HttpError, ConnectionError) as e:
        raise ImportFailed(f"Couldn't talk to the League client ({e}). Is it fully signed in?")
    puuid = summoner["puuid"]
    name = f"{summoner.get('gameName', '?')}#{summoner.get('tagLine', '?')}"

    owner = archive_owner(container, games)
    if owner and owner != puuid:
        raise ImportFailed(f"{out} belongs to a different account than {name}. Use a different archive.")

    known = {g.get("gameId") for g in games}
    progress(f"Signed in as {name}. {len(known)} games already in {out}.")

    token = sgp_token(lcu)
    host = find_sgp_host(lcu, puuid, token, sgp_host)
    ids, stop = walk_ids(host, puuid, token, SGP_MAYHEM_TAGS, known, full)
    if not ids:
        # An empty filtered walk could mean Riot renamed the queue tags, so
        # check every game the slow way before believing there are none
        progress("No Mayhem games by queue filter; checking all recent games instead.")
        ids, stop = walk_ids(host, puuid, token, SGP_ALL_TAGS, known, full)

    pending = [i for i in dict.fromkeys(ids) if i not in known]
    progress(f"Found {len(ids)} matching games; {len(pending)} are new.")
    if on_game:
        on_game(0, len(pending), 0, None)

    def fetch(game_id):
        try:
            return lcu.get(f"/lol-match-history/v1/games/{game_id}")
        except (HttpError, ConnectionError) as e:
            return e

    added = failed = 0
    pool = ThreadPoolExecutor(FETCH_WORKERS)
    try:
        # Several games at once: the client answers each in a fraction of a second, so waiting on them one by
        # one was most of an import's time. Results still come back in order.
        for n, (game_id, game) in enumerate(zip(pending, pool.map(fetch, pending)), 1):
            if isinstance(game, Exception):
                failed += 1
                progress(f"  [{n}/{len(pending)}] game {game_id}: {game}; a later run will retry it")
                continue
            pick = None
            if game.get("queueId") in MAYHEM_QUEUE_IDS:
                games.append(game)
                known.add(game_id)
                added += 1
                pick = my_pick(game, puuid)
            if on_game:
                on_game(n, len(pending), added, pick)
            if n % 25 == 0 or n == len(pending):
                progress(f"  [{n}/{len(pending)}] {added} added")
    except KeyboardInterrupt:
        progress("Stopped. Saving what was fetched so far.")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    mapped = 0
    try:
        mapped = fill_kill_maps(lcu, games, progress)
    except KeyboardInterrupt:
        mapped = 1  # some games may have changed; save them
        progress("Stopped. Saving what was fetched so far.")

    owned = fetch_collection(lcu, summoner)
    old_owned = container.get("owned") if isinstance(container, dict) else None
    if added or mapped or container is None or (owned and owned != old_owned):
        save_archive(out, container, games, summoner, owned)
    notes = []
    if failed:
        notes.append(f"{failed} games couldn't be fetched. Run again to retry them.")
    if stop == "page-limit":
        notes.append(f"Stopped at the {SGP_MAX_PAGES}-page safety limit; older games weren't checked.")
    elif stop == "exhausted" and history_window_full(host, puuid, token):
        notes.append(f"Only your last {SGP_HISTORY_CAP} matches (all queues) can be fetched. Older games can't be "
                     "fetched, but any already in the archive are kept.")
    progress(f"Done: {added} new Mayhem games added, {len(games)} in the archive.")
    for note in notes:
        progress(note)
    return {"added": added, "total": len(games), "failed": failed, "account": name, "notes": notes}


# ---------- local server for the dashboard's Sync button ----------
# A web page can't talk to the League client itself (its certificate and
# password are local), so this serves the dashboard and runs imports for it.
# It listens on 127.0.0.1 only and accepts sync requests only from its own
# pages: a POST needs the X-Mayhem header, which other sites can't send.

DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard")
# The page loads names, fonts and the minimap from the site's /assets/; when it's
# served from here those come from deeparam.com and are kept for next time.
SITE = "https://deeparam.com"
ASSET_CACHE = os.path.expanduser("~/Library/Caches/Mayhem Stats")


def site_asset(path):
    """Bytes for a /assets/... or /i18n/... path, cached on disk; None if the site doesn't have it.
    Translations change with the site, so they're fetched fresh and the cached copy is only for offline use."""
    rel = path.lstrip("/")
    if ".." in rel.split("/") or not rel.startswith(("assets/", "i18n/")):
        return None
    base = os.path.realpath(ASSET_CACHE)
    cached = os.path.realpath(os.path.join(base, rel))
    if not cached.startswith(base + os.sep):
        return None
    if os.path.exists(cached) and not rel.startswith("i18n/"):
        with open(cached, "rb") as f:
            return f.read()
    res = subprocess.run(["curl", "-sSf", "--max-time", "30", f"{SITE}/{rel}"], capture_output=True)
    if res.returncode != 0:
        if not os.path.exists(cached):
            return None
        with open(cached, "rb") as f:
            return f.read()
    os.makedirs(os.path.dirname(cached), exist_ok=True)
    with open(cached, "wb") as f:
        f.write(res.stdout)
    return res.stdout


# Client region -> server id used in public profile addresses
PLATFORM_BY_REGION = {
    "NA": "na1", "BR": "br1", "LAN": "la1", "LA1": "la1", "LAS": "la2", "LA2": "la2",
    "EUW": "euw1", "EUNE": "eun1", "EUN": "eun1", "TR": "tr1", "RU": "ru", "ME": "me1",
    "KR": "kr", "JP": "jp1", "OCE": "oc1", "OC1": "oc1",
    "SG": "sg2", "PH": "sg2", "TH": "sg2", "TW": "tw2", "VN": "vn2",
}


def site_post(lcu, path, payload):
    """POST to the site with the signed-in client's token, which tells the site whose request it is.
    The body goes on stdin so the token never shows up in the process list."""
    region = str((lcu.get("/riotclient/region-locale") or {}).get("region", "")).upper()
    platform = PLATFORM_BY_REGION.get(region)
    if not platform:
        raise ImportFailed(f"This isn't available for the {region or 'unknown'} region yet.")
    body = json.dumps({**payload, "token": sgp_token(lcu), "platform": platform})
    res = subprocess.run(["curl", "-sS", "--max-time", "60", "-X", "POST", "-H", "Content-Type: application/json",
                          "--data-binary", "@-", "-w", "\n%{http_code}", f"{SITE}{path}"],
                         input=body, capture_output=True, text=True)
    if res.returncode != 0:
        raise ImportFailed("Couldn't reach the site. Check your connection and try again.")
    out, _, status = res.stdout.rpartition("\n")
    try:
        reply = json.loads(out) if out.strip() else {}
    except ValueError:
        reply = {}
    if not 200 <= int(status or 0) < 300:
        raise ImportFailed(reply.get("error") or f"The site answered {status}.")
    return reply


def site_profile(action, data=None, lockfile=None, code=None, pair=None):
    """Publish, remove or check this account's public page on the site, or connect this Riot account to a
    deeparam.com account: "pair" opens the account page in the browser to confirm with one click, and
    "pair-status" asks whether that happened; "link" uses the code shown on the account page instead."""
    payload = {"action": action, "data": data}
    if action == "link":
        payload = {"action": action, "code": code}
    elif action in ("pair", "pair-status"):
        payload = {"action": action, "pair": pair}
    reply = site_post(find_client(lockfile), "/api/profile", payload)
    if reply.get("path"):
        reply["url"] = SITE + reply["path"]
    if action == "pair" and str(reply.get("connect") or "").startswith("/account?connect="):
        import webbrowser
        reply["url"] = SITE + reply["connect"]
        webbrowser.open(reply["url"])
    return reply


# ---------- sharing games ----------
# Off unless the player turns it on in My Stats. Shared games carry no names or account ids: just
# champions, items, augments, runes, spells and results, so the site can build stats across players.

SHARING_FILE = os.path.expanduser("~/Library/Application Support/Mayhem Stats/sharing.json")
SHARE_BATCH = 50


def sharing_settings():
    try:
        with open(SHARING_FILE) as f:
            s = json.load(f)
        return {"enabled": bool(s.get("enabled")), "shared": list(s.get("shared") or [])}
    except (OSError, ValueError):
        return {"enabled": False, "shared": []}


def save_sharing(settings):
    os.makedirs(os.path.dirname(SHARING_FILE), exist_ok=True)
    with open(SHARING_FILE, "w") as f:
        json.dump(settings, f)


def anonymise(game):
    """A game without names, account ids or the player's own place in it; None if it isn't usable."""
    version = str(game.get("gameVersion") or "").split(".")
    created = game.get("gameCreation") or 0
    if len(version) < 2 or not created or not game.get("gameId"):
        return None
    players = []
    for p in game.get("participants") or []:
        s = p.get("stats") or {}
        players.append({
            "team": p.get("teamId"), "champ": p.get("championId"), "win": bool(s.get("win")),
            "k": s.get("kills"), "d": s.get("deaths"), "a": s.get("assists"),
            "dmg": s.get("totalDamageDealtToChampions"), "taken": s.get("totalDamageTaken"), "heal": s.get("totalHeal"),
            "gold": s.get("goldEarned"), "cs": (s.get("totalMinionsKilled") or 0) + (s.get("neutralMinionsKilled") or 0),
            "level": s.get("champLevel"),
            "multi": [s.get(k) or 0 for k in ("doubleKills", "tripleKills", "quadraKills", "pentaKills")],
            "spree": s.get("largestKillingSpree"),
            "augs": [s.get(f"playerAugment{i}") for i in range(1, 7) if s.get(f"playerAugment{i}")],
            "items": [s.get(f"item{i}") for i in range(7) if s.get(f"item{i}")],
            "spells": [p.get("spell1Id"), p.get("spell2Id")],
            "styles": [s.get("perkPrimaryStyle"), s.get("perkSubStyle")],
            "perks": [s.get(f"perk{i}") for i in range(6) if s.get(f"perk{i}")],
        })
    # Players in a fixed order so the uploader can't be picked out by position
    players.sort(key=lambda x: (x["team"] or 0, x["champ"] or 0))
    teams = [{"id": t.get("teamId"), "win": t.get("win") in ("Win", True), "towers": t.get("towerKills"),
              "inhibs": t.get("inhibitorKills"), "firstBlood": bool(t.get("firstBlood")),
              "firstTower": bool(t.get("firstTower"))} for t in game.get("teams") or []]
    return {
        "id": str(game["gameId"]), "platform": str(game.get("platformId") or "").lower(),
        "patch": ".".join(version[:2]), "queue": game.get("queueId"),
        "played": datetime.datetime.fromtimestamp(created / 1000, datetime.timezone.utc).strftime("%Y-%m-%d"),
        "duration": round(game["gameDuration"] / 1000) if (game.get("gameDuration") or 0) > 20000 else game.get("gameDuration"),
        "teams": teams, "players": players,
    }


def share_new_games(out, lockfile=None, progress=log):
    """Sends archive games not shared yet. Returns how many this account has shared in all."""
    settings = sharing_settings()
    if not settings["enabled"]:
        return None
    _, games = load_archive(out)
    done = set(settings["shared"])
    todo = [g for g in games if str(g.get("gameId")) not in done]
    lcu = find_client(lockfile)
    total = None
    for i in range(0, len(todo), SHARE_BATCH):
        batch = todo[i:i + SHARE_BATCH]
        clean = [a for a in map(anonymise, batch) if a]
        total = site_post(lcu, "/api/games", {"action": "share", "games": clean}).get("shared")
        done.update(str(g.get("gameId")) for g in batch)
        settings["shared"] = sorted(done)
        save_sharing(settings)
        progress(f"Shared {min(i + SHARE_BATCH, len(todo))} of {len(todo)} games.")
    if total is None:
        total = site_post(lcu, "/api/games", {"action": "status"}).get("shared")
    return total


def set_sharing(enabled, out, lockfile=None):
    settings = sharing_settings()
    if enabled:
        save_sharing({**settings, "enabled": True})
        return {"enabled": True, "shared": share_new_games(out, lockfile)}
    reply = site_post(find_client(lockfile), "/api/games", {"action": "remove"})
    save_sharing({"enabled": False, "shared": []})
    return {"enabled": False, "shared": reply.get("shared", 0)}


# ---------- saving games to the owner's account ----------
# Off unless turned on in My Stats, and only the site owner's account can use it: the site checks that this
# Riot account is connected to the owner account. Each game keeps this player's own stats and only the
# champion and team of everyone else, with no names or account ids but the player's own Riot ID.

HISTORY_FILE = os.path.expanduser("~/Library/Application Support/Mayhem Stats/history.json")
HISTORY_BATCH = 100
HISTORY_STATS = ("win", "kills", "deaths", "assists", "totalDamageDealtToChampions", "totalDamageTaken", "totalHeal",
                 "largestKillingSpree", "pentaKills", "quadraKills",
                 *(f"playerAugment{i}" for i in range(1, 7)), *(f"item{i}" for i in range(7)))


def history_settings():
    try:
        with open(HISTORY_FILE) as f:
            s = json.load(f)
        return {"enabled": bool(s.get("enabled")), "saved": list(s.get("saved") or [])}
    except (OSError, ValueError):
        return {"enabled": False, "saved": []}


def save_history_settings(settings):
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(settings, f)


def private_game(game, owner):
    """The game as the owner's account keeps it; None if the owner isn't in it."""
    ids = {pi.get("participantId"): (pi.get("player") or {}) for pi in game.get("participantIdentities") or []}
    participants, mine = [], False
    for p in game.get("participants") or []:
        row = {"participantId": p.get("participantId"), "teamId": p.get("teamId"), "championId": p.get("championId")}
        player = ids.get(p.get("participantId")) or {}
        if player.get("puuid") == owner:
            mine = True
            s = p.get("stats") or {}
            row.update(puuid="me", championName=p.get("championName"), riotIdGameName=player.get("gameName"),
                       riotIdTagline=player.get("tagLine"), stats={k: s.get(k) for k in HISTORY_STATS})
        participants.append(row)
    if not mine or not game.get("gameId"):
        return None
    out = {k: game.get(k) for k in ("gameId", "gameCreation", "gameDuration", "queueId", "gameVersion")}
    out["participants"] = participants
    if isinstance(game.get("killMap"), list):
        out["killMap"] = game["killMap"]
    return out


def save_new_history(out, lockfile=None, progress=log):
    """Sends games not saved to the account yet. Returns how many the account holds, or None when off."""
    settings = history_settings()
    if not settings["enabled"]:
        return None
    container, games = load_archive(out)
    owner = archive_owner(container, games)
    done = set(settings["saved"])
    todo = [g for g in games if str(g.get("gameId")) not in done]
    lcu = find_client(lockfile)
    total = None
    for i in range(0, len(todo), HISTORY_BATCH):
        batch = todo[i:i + HISTORY_BATCH]
        clean = [x for x in (private_game(g, owner) for g in batch) if x]
        total = site_post(lcu, "/api/history", {"action": "save", "games": clean}).get("saved")
        done.update(str(g.get("gameId")) for g in batch)
        settings["saved"] = sorted(done)
        save_history_settings(settings)
        progress(f"Saved {min(i + HISTORY_BATCH, len(todo))} of {len(todo)} games to your account.")
    if total is None:
        total = site_post(lcu, "/api/history", {"action": "status"}).get("saved")
    return total


def set_history(enabled, out, lockfile=None):
    if enabled:
        save_history_settings({**history_settings(), "enabled": True})
        return {"enabled": True, "available": True, "saved": save_new_history(out, lockfile)}
    reply = site_post(find_client(lockfile), "/api/history", {"action": "remove"})
    save_history_settings({"enabled": False, "saved": []})
    return {"enabled": False, "available": True, "saved": reply.get("saved", 0)}


def history_status(lockfile=None):
    reply = site_post(find_client(lockfile), "/api/history", {"action": "status"})
    return {"enabled": history_settings()["enabled"], "available": bool(reply.get("available")), "saved": reply.get("saved", 0)}


# ---------- live game recording (Live Client Data API) ----------
# League serves the game in progress on 127.0.0.1:2999 while a match runs. The
# helper polls it and saves one file per game under LIVE_DIR. Record only: it
# never shows anything while the game is running.

LIVE_URL = "https://127.0.0.1:2999/liveclientdata/allgamedata"
LIVE_DIR = os.path.expanduser("~/Library/Application Support/Mayhem Stats/live")
LIVE_EVERY = 10   # seconds between snapshots during a game
LIVE_IDLE = 15    # seconds between checks for a game starting
LIVE_KEEP = 200   # recordings kept on disk, newest first
LIVE_FORMAT = 1

# One recording file (version 1):
# {
#   "version": 1, "complete": true,          # complete once the game ended or closed
#   "startedAt": 1760000000000,              # epoch ms, wall clock at game time 0
#   "gameMode": "KIWI", "map": 12, "mapTerrain": "Default",  # official map id; terrain names the map skin
#   "gameTime": 1104.2,                      # seconds, last seen
#   "player": {"riotId": "Name#TAG", "champion": "Ahri", "team": "ORDER"},
#   "snapshots": [{                          # the recording player, every LIVE_EVERY s
#     "t": 610.1, "level": 14, "gold": 1325.4,
#     "stats": {...championStats as reported: abilityPower, attackDamage, armor,
#               magicResist, maxHealth, currentHealth, attackSpeed, abilityHaste,
#               critChance, critDamage, lifeSteal, omnivamp, physicalLethality,
#               magicPenetrationFlat, magicPenetrationPercent, armorPenetrationPercent,
#               moveSpeed, tenacity, healShieldPower, resourceMax, ...},
#     "abilities": {"Q": 5, "W": 3, "E": 2, "R": 2},
#     "items": [[slot, itemId, count], ...], "augments": [...]  # augments when the game reports them
#     "scores": {"kills": 4, "deaths": 2, "assists": 11, "creepScore": 30, "wardScore": 0}}],
#   "players": [{                            # everyone, as of the last snapshot
#     "riotId": "...", "champion": "Ahri", "team": "ORDER", "level": 18, "bot": false,
#     "items": [[slot, itemId, count]], "augments": [...], "spells": ["SummonerFlash", ...],
#     "keystone": 8112, "scores": {...}}],
#   "events": [{"t": 95.3, "name": "ChampionKill", "killer": "...", "victim": "...", "assisters": [...]}]
# }
# Damage dealt isn't in the live data; the synced match supplies it, matched by
# champion and start time.


def _items(p):
    return [[i.get("slot"), i.get("itemID"), i.get("count", 1)] for i in p.get("items") or []]


def _augments(p):
    out = []
    for k, v in p.items():
        if "augment" in k.lower() and v:
            out += v if isinstance(v, list) else [v]
    return out


def _abilities(a):
    return {k: v.get("abilityLevel", 0) for k, v in (a or {}).items() if k in ("Q", "W", "E", "R")}


def _spell(s):
    # "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" -> "SummonerFlash"
    raw = (s.get("rawDisplayName") or "").split("_")
    return raw[-2] if len(raw) >= 3 else s.get("displayName")


def _riot_id(p):
    return p.get("riotId") or p.get("summonerName") or ""


def live_players(data):
    out = []
    for p in data.get("allPlayers") or []:
        spells = p.get("summonerSpells") or {}
        out.append({
            "riotId": _riot_id(p), "champion": p.get("championName"), "team": p.get("team"),
            "level": p.get("level"), "bot": bool(p.get("isBot")), "items": _items(p), "augments": _augments(p),
            "spells": [_spell(s) for s in (spells.get("summonerSpellOne"), spells.get("summonerSpellTwo")) if s],
            "keystone": ((p.get("runes") or {}).get("keystone") or {}).get("id"),
            "scores": p.get("scores") or {},
        })
    return out


def live_snapshot(data):
    """The recording player's state at this moment, from one allgamedata response."""
    me = data.get("activePlayer") or {}
    me_id = _riot_id(me)
    row = next((p for p in data.get("allPlayers") or [] if _riot_id(p) == me_id), {})
    return {
        "t": round((data.get("gameData") or {}).get("gameTime", 0), 1),
        "level": me.get("level"), "gold": round(me.get("currentGold", 0), 1),
        "stats": me.get("championStats") or {}, "abilities": _abilities(me.get("abilities")),
        "items": _items(row), "augments": _augments(me) or _augments(row), "scores": row.get("scores") or {},
    }


def live_events(data):
    out = []
    for e in (data.get("events") or {}).get("Events") or []:
        ev = {"t": round(e.get("EventTime", 0), 1), "name": e.get("EventName")}
        for src, dst in (("KillerName", "killer"), ("VictimName", "victim"), ("Assisters", "assisters"),
                         ("Result", "result"), ("DragonType", "dragon")):
            if src in e:
                ev[dst] = e[src]
        out.append(ev)
    return out


def live_update(rec, data, now_ms):
    """Folds one allgamedata response into a recording (a new one when rec is None)."""
    game = data.get("gameData") or {}
    t = game.get("gameTime", 0)
    me = data.get("activePlayer") or {}
    if rec is None:
        mine = next((p for p in data.get("allPlayers") or [] if _riot_id(p) == _riot_id(me)), {})
        rec = {"version": LIVE_FORMAT, "complete": False, "startedAt": int(now_ms - t * 1000),
               "gameMode": game.get("gameMode"), "map": game.get("mapNumber"), "mapTerrain": game.get("mapTerrain"),
               "gameTime": 0,
               "player": {"riotId": _riot_id(me), "champion": mine.get("championName"), "team": mine.get("team")},
               "snapshots": [], "players": [], "events": []}
    rec["gameTime"] = round(t, 1)
    rec["snapshots"].append(live_snapshot(data))
    rec["players"] = live_players(data)
    rec["events"] = live_events(data)
    if any(e["name"] == "GameEnd" for e in rec["events"]):
        rec["complete"] = True
    return rec


def save_live(rec, folder=None):
    folder = folder or LIVE_DIR
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{rec['startedAt']}.json")
    with open(path + ".tmp", "w") as f:
        json.dump(rec, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)
    names = sorted((n for n in os.listdir(folder) if n.endswith(".json")), reverse=True)
    for old in names[LIVE_KEEP:]:
        os.remove(os.path.join(folder, old))
    return path


def live_recordings(folder=None):
    """Every saved recording, newest first."""
    folder = folder or LIVE_DIR
    out = []
    try:
        names = sorted((n for n in os.listdir(folder) if n.endswith(".json")), reverse=True)
    except OSError:
        return out
    for n in names:
        try:
            with open(os.path.join(folder, n)) as f:
                out.append(json.load(f))
        except (OSError, ValueError):
            continue
    return out


def live_recorder(stop, status, fetch=None, folder=None, progress=log):
    """Runs until stop is set: waits for a game, snapshots it, saves it when it ends."""
    fetch = fetch or (lambda: curl_json(LIVE_URL, cacert=riot_ca(), timeout=5))
    rec = None
    while not stop.is_set():
        try:
            data = fetch()
        except (ConnectionError, HttpError, ValueError):
            data = None
        # The API answers with an empty game while loading; wait for a player to appear.
        if data and (data.get("activePlayer") or {}).get("championStats"):
            started = rec is None
            rec = live_update(rec, data, time.time() * 1000)
            save_live(rec, folder)
            status["recording"] = rec["player"]["champion"]
            if started:
                progress(f"Recording live game ({rec['player']['champion']}).")
            if rec["complete"]:
                progress("Live game saved.")
                rec = None
                status["recording"] = None
                stop.wait(60)  # the end screen keeps answering for a while
                continue
        elif rec is not None:
            rec["complete"] = True  # the game closed before reporting its end
            save_live(rec, folder)
            progress("Live game saved.")
            rec = None
            status["recording"] = None
        stop.wait(LIVE_EVERY if rec else LIVE_IDLE)


def serve(out, port, lockfile=None, sgp_host=None, open_browser=True, record_live=True):
    import http.server
    import threading
    import webbrowser

    # "progress": how far the import of new games is, and the champions of the latest ones, for the dashboard's
    # import animation.
    state = {"running": False, "log": [], "result": None, "error": None, "progress": None}
    lock = threading.Lock()
    live = {"recording": None, "enabled": record_live}
    stop_live = threading.Event()
    if record_live:
        threading.Thread(target=live_recorder, args=(stop_live, live), daemon=True).start()

    def sync_worker(full):
        def progress(msg):
            log(msg)
            with lock:
                state["log"] = (state["log"] + [msg.strip()])[-50:]
        def on_game(done, total, added, pick):
            with lock:
                p = state["progress"] or {"recent": []}
                recent = (p["recent"] + [pick])[-12:] if pick else p["recent"]
                state["progress"] = {"done": done, "total": total, "added": added, "recent": recent}
        try:
            result = run_import(out, full, lockfile, sgp_host, progress, on_game)
            try:
                shared = share_new_games(out, lockfile, progress)
                if shared is not None:
                    result["shared"] = shared
            except (ImportFailed, HttpError, ConnectionError) as e:
                result["notes"] = result.get("notes", []) + [f"Sharing will retry next import: {e}"]
            try:
                saved = save_new_history(out, lockfile, progress)
                if saved is not None:
                    result["saved"] = saved
            except (ImportFailed, HttpError, ConnectionError) as e:
                result["notes"] = result.get("notes", []) + [f"Saving to your account will retry next import: {e}"]
            with lock:
                state["result"] = result
        except (ImportFailed, HttpError, ConnectionError) as e:
            with lock:
                state["error"] = str(e)
        except Exception as e:  # keep the server up whatever happens
            with lock:
                state["error"] = f"Import failed: {e}"
        finally:
            with lock:
                state["running"] = False

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=DASHBOARD_DIR, **kw)

        def log_message(self, *a):
            pass

        def local_host(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            return host in ("127.0.0.1", "localhost")

        def send_json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.local_host():  # refuse DNS-rebinding lookalikes
                return self.send_json({"error": "forbidden"}, 403)
            path = self.path.split("?")[0]
            if path == "/api/sync":
                with lock:
                    return self.send_json(dict(state))
            if path == "/api/live":
                return self.send_json({**live, "games": live_recordings()})
            if path.startswith(("/assets/", "/i18n/")):
                body = site_asset(path)
                if body is None:
                    return self.send_json({"error": "not found"}, 404)
                self.send_response(200)
                self.send_header("Content-Type", self.guess_type(path))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            if path == "/data/mayhem-backup.json":
                if not os.path.exists(out):
                    return self.send_json({"error": "no archive yet"}, 404)
                with open(out, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            return super().do_GET()

        def do_POST(self):
            if not self.local_host() or self.headers.get("X-Mayhem") != "1":
                return self.send_json({"error": "forbidden"}, 403)
            path, _, query = self.path.partition("?")
            if path == "/api/share":
                try:
                    req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4000)) or b"{}")
                    if "enabled" in req:
                        return self.send_json(set_sharing(bool(req["enabled"]), out, lockfile))
                    return self.send_json({"enabled": sharing_settings()["enabled"],
                                           "shared": len(sharing_settings()["shared"])})
                except ImportFailed as e:
                    return self.send_json({"error": str(e)}, 502)
                except Exception:
                    return self.send_json({"error": "Couldn't reach the League client. Open it, sign in, and try again."}, 502)
            if path == "/api/history":
                try:
                    req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 4000)) or b"{}")
                    if "enabled" in req:
                        return self.send_json(set_history(bool(req["enabled"]), out, lockfile))
                    return self.send_json(history_status(lockfile))
                except ImportFailed as e:
                    return self.send_json({"error": str(e)}, 502)
                except Exception:
                    return self.send_json({"error": "Couldn't reach the League client. Open it, sign in, and try again."}, 502)
            if path == "/api/profile":
                try:
                    req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 64000)) or b"{}")
                    action = req.get("action")
                    if action not in ("publish", "remove", "status", "link", "pair", "pair-status"):
                        return self.send_json({"error": "bad request"}, 400)
                    code = str(req.get("code") or "").strip().upper()
                    if action == "link" and not re.fullmatch(r"[A-Z0-9]{8}", code):
                        return self.send_json({"error": "Enter the 8-character code from your account page."}, 400)
                    pair = str(req.get("pair") or "")
                    if action == "pair-status" and not re.fullmatch(r"[A-Za-z0-9_-]{32}", pair):
                        return self.send_json({"error": "bad request"}, 400)
                    return self.send_json(site_profile(action, req.get("data"), lockfile, code, pair or None))
                except ImportFailed as e:
                    return self.send_json({"error": str(e)}, 502)
                except Exception:
                    return self.send_json({"error": "Couldn't reach the League client. Open it, sign in, and try again."}, 502)
            if path != "/api/sync":
                return self.send_json({"error": "not found"}, 404)
            with lock:
                if not state["running"]:
                    state.update(running=True, log=[], result=None, error=None, progress=None)
                    full = "full=1" in query.split("&")
                    threading.Thread(target=sync_worker, args=(full,), daemon=True).start()
                return self.send_json(dict(state), 202)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    log(f"Mayhem Stats is at {url} (archive: {out}). Press Ctrl+C to stop.")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_live.set()


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(description="Import ARAM Mayhem games from the League client into a JSON archive.")
    ap.add_argument("-o", "--out", default=os.path.expanduser("~/Downloads/mayhem-backup.json"),
                    help="archive to create or merge into (default: ~/Downloads/mayhem-backup.json)")
    ap.add_argument("--full", action="store_true",
                    help="check every game Riot still serves, not just the new ones, to fill gaps")
    ap.add_argument("--lockfile", help="path to League's lockfile, if League isn't in /Applications")
    ap.add_argument("--serve", action="store_true",
                    help="open the stats dashboard with a Sync button instead of importing once")
    ap.add_argument("--port", type=int, default=8787, help="port for --serve (default 8787)")
    ap.add_argument("--no-live", action="store_true", help="with --serve, don't record games while they're played")
    ap.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--sgp-host", help=argparse.SUPPRESS)  # for testing
    args = ap.parse_args()
    out = os.path.expanduser(args.out)

    if args.serve:
        return serve(out, args.port, args.lockfile, args.sgp_host, not args.no_browser, not args.no_live)
    try:
        run_import(out, args.full, args.lockfile, args.sgp_host)
    except ImportFailed as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
