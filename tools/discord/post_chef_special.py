"""Posts a Chef Special to a Discord webhook once the special's page is live.

Usage: post_chef_special.py [--before SHA] [--date YYYY-MM-DD] [--dry-run]
With --before, posts every Chef Special date that is in data/cook-builds/builds.json now but was
not at that commit, so each date is posted once, when it first lands on main. With --date, posts
that date (for a manual re-post). The webhook URL comes from DISCORD_CHEF_WEBHOOK.
"""
import argparse, json, os, subprocess, sys, time, urllib.request

SITE = "https://deeparam.com"
BUILDS = "data/cook-builds/builds.json"
GOLD = 0xE0A83C


def chefs(text):
    data = json.loads(text)
    data = data if isinstance(data, list) else data.get("builds", [])
    return {b["chef"]: b for b in data if b.get("chef")}


def get(url, method="GET"):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "deeparam-chef-bot"})
    return urllib.request.urlopen(req, timeout=20)


def wait_live(date, build, minutes):
    urls = [f"{SITE}/kitchen/{date}", f"{SITE}/embed/fun/cook-builds/share/{build['id']}.png"]
    for _ in range(minutes * 2):
        try:
            if all(get(u).status == 200 for u in urls):
                return True
        except Exception:
            pass
        time.sleep(30)
    return False


def embed(date, build, champ_name):
    return {
        "title": f"Chef Special: {build['title']}",
        "url": f"{SITE}/kitchen/{date}",
        "description": f"**{champ_name}** · {date}\n\n{build['why']}\n\n**How to play:** {build['play']}",
        "color": GOLD,
        "fields": [
            {"name": "Augments", "value": " · ".join(build["augments"]), "inline": False},
            {"name": "Items", "value": " · ".join(build["items"]), "inline": False},
        ],
        "image": {"url": f"{SITE}/embed/fun/cook-builds/share/{build['id']}.png"},
        "footer": {"text": "DeepARAM · The Kitchen"},
    }


def trim(e):
    e["description"] = e["description"][:4000]
    for f in e["fields"]:
        f["value"] = f["value"][:1000]
    return e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before")
    ap.add_argument("--date")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--wait-minutes", type=int, default=30)
    a = ap.parse_args()
    now = chefs(open(BUILDS).read())
    if a.date:
        dates = [a.date]
    else:
        old = {}
        if a.before and set(a.before) != {"0"}:
            try:
                old = chefs(subprocess.check_output(["git", "show", f"{a.before}:{BUILDS}"], text=True))
            except subprocess.CalledProcessError:
                pass
        dates = sorted(set(now) - set(old))
    if not dates:
        print("No new Chef Special.")
        return
    hook = os.environ.get("DISCORD_CHEF_WEBHOOK", "")
    if not hook and not a.dry_run:
        print("::notice::DISCORD_CHEF_WEBHOOK is not set; nothing posted.")
        return
    names = json.load(open("data/cook-builds/chefs-special.json"))
    for d in dates:
        b = now.get(d)
        if not b:
            sys.exit(f"No Chef Special on {d}")
        champ = names["champion_name"] if names.get("chef") == d else b["champion"]
        payload = {"username": "The Kitchen", "embeds": [trim(embed(d, b, champ))]}
        if a.dry_run:
            print(json.dumps(payload, indent=1))
            continue
        if not wait_live(d, b, a.wait_minutes):
            sys.exit(f"The {d} page was not live after {a.wait_minutes} minutes; not posting.")
        req = urllib.request.Request(hook, json.dumps(payload).encode(), {
            "Content-Type": "application/json", "User-Agent": "deeparam-chef-bot"})
        urllib.request.urlopen(req, timeout=20)
        print(f"Posted {d}: {b['title']}")


main()
