"""Is a new live patch out today? Used by .github/workflows/patch-day.yml.

Riot's published schedule (data/patch-schedule.json, "26.21" = game version 16.21) says which patch should be
live by today, Pacific Time. The site's own version is /assets/manifest.json "ddragon_version". When the
schedule says a newer patch is due, this checks whether the official version list and the client files
already carry it, since the release time of day isn't published.

Prints one line and, under GitHub Actions, writes `status` (current, waiting or ready) and `version` to
$GITHUB_OUTPUT. Usage: python3 web/scripts/patch_day.py [--now 2026-10-21T18:00:00Z]
"""
import argparse, json, os, sys, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
UA = {"User-Agent": "deeparam-patch-day"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def key(version):
    """A comparable (season, patch): game version 16.21.1 and schedule name 26.21 are both (16, 21)."""
    major, patch = (int(x) for x in str(version).split(".")[:2])
    return (major - 10 if major >= 20 else major, patch)


def due_patch(schedule, now):
    """The newest scheduled patch whose date and time (in the schedule's time zone, so daylight saving is
    handled) have come. "time" is the schedule's update time, 06:30; a patch can override it."""
    local = now.astimezone(ZoneInfo(schedule["timeZone"])).strftime("%Y-%m-%d %H:%M")
    due = [p for p in schedule["patches"] if f"{p['date']} {p.get('time') or schedule.get('time', '00:00')}" <= local]
    return max(due, key=lambda p: p["date"]) if due else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", help="pretend it is this UTC time (ISO 8601), for testing")
    args = ap.parse_args()
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(timezone.utc)

    schedule = json.load(open(os.path.join(REPO, "data", "patch-schedule.json")))
    manifest = json.load(open(os.path.join(REPO, "web", "public", "assets", "manifest.json")))
    site = manifest["ddragon_version"]
    due = due_patch(schedule, now)
    status, version = "current", site
    if due and key(due["patch"]) > key(site):
        official = get_json("https://ddragon.leagueoflegends.com/api/versions.json")[0]
        client = get_json("https://raw.communitydragon.org/latest/content-metadata.json").get("version", "0.0")
        # Both have to be out: pages use the official art and names, the guide and champion data the client files.
        if key(official) >= key(due["patch"]) and key(client) == key(official):
            status, version = "ready", official
        else:
            status = "waiting"
        print(f"Patch {due['patch']} was due {due['date']}; site {site}, official {official}, client {client or '?'}: {status}")
    else:
        print(f"Site is on {site}; next scheduled patch isn't due yet: {status}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"status={status}\nversion={version}\n")


if __name__ == "__main__":
    sys.exit(main())
