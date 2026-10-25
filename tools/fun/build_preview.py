"""Bundle the Fun Tools tab into one self-contained HTML file (for an artifact preview).

Usage: python3 build_preview.py OUT.html
Inlines styles, scripts and data, and embeds every CommunityDragon icon as a data: URI,
because the preview page can't load anything from other sites. Python 3 standard library only.
"""
import base64, html, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = [("cook-builds", "Chef Specials", "The Kitchen: today's Chef Special and every earlier one by date."),
         ("ryze-calculator", "Infinite Ryze", "Moving to the Simulator tab: how far Ryze's AP to Mana loop goes."),
         ("region-teams", "Region Teams", "Moving to the Info tab: the strongest Mayhem team from each region of Runeterra.")]
SWAP_ICONS = ("<script>(function(){var M=parent.FUN_ICONS||{};function w(o){for(var k in o){var v=o[k];"
              "if(typeof v==='string'){if(M[v])o[k]=M[v];}else if(v&&typeof v==='object')w(v);}}"
              "Object.keys(window).forEach(function(k){if(/_DATA$/.test(k))w(window[k]);});})();</script>")
ICON = re.compile(r"/assets/cd/[^\"']+?\.png")
# The site serves icons and fonts itself (/assets/...); the preview page can't reach those, so it
# fetches the same files from CommunityDragon and loads the fonts from Google Fonts.
FONTS = ('/assets/fonts/fonts.css', "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;"
         "12..96,700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap")


def fetch(url):
    req = urllib.request.Request(url.replace("/assets/cd/", "https://raw.communitydragon.org/", 1), headers={"User-Agent": "deeparam-fun-tools"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return url, "data:image/png;base64," + base64.b64encode(r.read()).decode()
        except Exception as e:  # a missing icon just shows the empty frame
            if attempt == 2:
                print("icon failed:", url, e)
    return url, ""


def read(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return f.read()


def local_icons(folder):
    """Cook Builds keeps its icons next to the page (icons/...); its app.js reads them from COOK_ICONS."""
    root = os.path.join(HERE, folder, "icons")
    if not os.path.isdir(root):
        return ""
    found = {}
    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            path = os.path.join(dirpath, name)
            with open(path, "rb") as f:
                found[os.path.relpath(path, os.path.join(HERE, folder))] = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    return "<script>window.COOK_ICONS = " + json.dumps(found) + ";</script>"


def inline_page(folder, icons):
    """One tool's index.html with its CSS, data and scripts inlined."""
    page = read(f"{folder}/index.html")
    page = page.replace('<link rel="stylesheet" href="../style.css">', "<style>" + read("style.css").replace(*FONTS) + "\n#share{display:none}</style>")
    if '<link rel="stylesheet" href="style.css">' in page:  # a page with its own stylesheet (Cook Builds)
        page = page.replace('<link rel="stylesheet" href="style.css">', "<style>" + read(f"{folder}/style.css").replace(*FONTS) + "</style>")

    def script(m):
        js = read(f"{folder}/{m.group(1)}")
        if m.group(1) == "data.js":
            # Icons are shared by many tools, so the shell holds each one once (FUN_ICONS) and the
            # page swaps its data's icon URLs for them right after the data loads.
            return "<script>" + js.replace("</script", "<\\/script") + "</script>" + SWAP_ICONS + local_icons(folder)
        js = ICON.sub(lambda u: icons.get(u.group(0), u.group(0)), js)
        return "<script>" + js.replace("</script", "<\\/script") + "</script>"

    page = re.sub(r'<script src="([^"]+)"></script>', script, page)
    # The eyebrow links back to the hub; inside the preview that is the parent's job.
    return page


def main(out):
    urls = set()
    for folder, _, _ in TOOLS:
        urls |= set(ICON.findall(read(f"{folder}/data.js")))
    with ThreadPoolExecutor(16) as ex:
        icons = dict(ex.map(fetch, sorted(urls)))
    pages = {folder: inline_page(folder, icons) for folder, _, _ in TOOLS}
    shell = read("preview_shell.html")
    cards = "\n".join(
        f'<button class="tool-card" type="button" data-go="{f}"><span class="tool-name">{html.escape(n)}</span>'
        f'<span class="tool-desc">{html.escape(d)}</span></button>' for f, n, d in TOOLS)
    tabs = "\n".join(f'<button class="tab" type="button" role="tab" id="tab-{f}" data-go="{f}">{html.escape(n)}</button>' for f, n, _ in TOOLS)
    frames = "\n".join(f'<section class="panel" id="panel-{f}" role="tabpanel" hidden><iframe title="{html.escape(n)}" data-src="{f}"></iframe></section>'
                       for f, n, _ in TOOLS)
    shell = (shell.replace("<!--CARDS-->", cards).replace("<!--TABS-->", tabs).replace("<!--FRAMES-->", frames)
             .replace("/*PAGES*/null", json.dumps(pages).replace("</", "<\\/"))
             .replace("<script>\n(function", "<script>window.FUN_ICONS = " + json.dumps({u: d for u, d in icons.items() if d}) + ";</script>\n<script>\n(function", 1))
    with open(out, "w", encoding="utf-8") as f:
        f.write(shell)
    print(f"wrote {out}: {len(shell) / 1e6:.1f} MB, {sum(1 for v in icons.values() if v)} icons")


if __name__ == "__main__":
    main(sys.argv[1])
