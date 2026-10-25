// Link preview images for shared cook builds and Chef Specials: share/<id>.png, 1200x630, no stats.
// Run after build_data.py (needs Playwright's Chromium):
//
//     NODE_PATH=$(npm root -g) node data/cook-builds/share_images.js
//
// Stale images (builds no longer in data.js) are removed.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO = path.join(__dirname, "..", "..");
const HERE = path.join(REPO, "tools", "fun", "cook-builds");
const ASSETS = path.join(REPO, "web", "public", "assets");
const OUT = path.join(HERE, "share");
const ORIGIN = "http://lab.local";

const src = fs.readFileSync(path.join(HERE, "data.js"), "utf8");
const data = JSON.parse(src.slice(src.indexOf("{"), src.trimEnd().replace(/;$/, "").lastIndexOf("}") + 1));
const BOOTS = /Greaves|Treads|Boots|Steelcaps|Lucidity|Swiftness|Shoes/;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function page(b) {
  const eyebrow = b.chef ? `Chef Special · ${day(b.chef)}` : "Cook build";
  const augs = b.augments.map((a) => `<li><img src="/cook/${a.icon}" alt=""><span>${esc(a.name)}</span></li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #090b0f; color: #e8ecf2; font: 24px/1.4 "Geist", system-ui, sans-serif; }
  .frame { position: absolute; inset: 0; padding: 56px 64px; display: grid; grid-template-rows: auto 1fr auto; gap: 28px;
    background: radial-gradient(900px 500px at 100% 0%, rgba(236, 90, 166, 0.22), transparent 60%), radial-gradient(700px 420px at 0% 100%, rgba(${b.chef ? "214, 168, 79" : "236, 90, 166"}, 0.14), transparent 60%); }
  .frame::before { content: ""; position: absolute; inset: 0 0 auto; height: 8px; background: linear-gradient(90deg, ${b.chef ? "#d6a84f" : "#ec5aa6"}, rgba(236, 90, 166, 0.3)); }
  .eyebrow { font: 500 22px "Geist Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: ${b.chef ? "#e2bc73" : "#eb86bd"}; }
  .head { display: flex; gap: 36px; align-items: center; }
  .head > img { width: 168px; height: 168px; border-radius: 32px; flex: none; box-shadow: 0 0 0 3px rgba(236, 90, 166, 0.35); }
  h1 { font: 700 76px/1 "Bricolage Grotesque", "Geist", sans-serif; letter-spacing: -.035em; text-wrap: balance; }
  .champ { margin-top: 14px; font-size: 30px; color: #8b94a3; font-weight: 500; }
  ul { list-style: none; padding: 0; display: flex; gap: 18px; flex-wrap: wrap; align-self: center; }
  li { display: flex; align-items: center; gap: 14px; padding: 12px 22px 12px 12px; border-radius: 18px; background: #11151c; border: 1px solid #222936; font-size: 25px; font-weight: 500; }
  li img { width: 52px; height: 52px; border-radius: 12px; }
  .foot { display: flex; justify-content: space-between; align-items: baseline; color: #8b94a3; font-size: 22px; }
  .foot b { font: 700 30px "Bricolage Grotesque", sans-serif; color: #e8ecf2; letter-spacing: -.02em; }
</style></head><body><div class="frame">
  <p class="eyebrow">${esc(eyebrow)}</p>
  <div>
    <div class="head"><img src="/cook/${b.champion_icon}" alt=""><div><h1>${esc(b.title)}</h1><p class="champ">${esc(b.champion_name)} · ${esc(b.items.filter((i) => !BOOTS.test(i)).slice(0, 3).join(", "))}</p></div></div>
  </div>
  <ul>${augs}</ul>
  <div class="foot"><b>DeepARAM</b><span>The Kitchen · deeparam.com</span></div>
</div></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await tab.route(ORIGIN + "/**", (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = p.startsWith("/assets/") ? path.join(ASSETS, p.slice(8)) : p.startsWith("/cook/") ? path.join(HERE, p.slice(6)) : null;
    if (file && fs.existsSync(file)) return route.fulfill({ path: file });
    if (p === "/") return route.fulfill({ contentType: "text/html", body: tab.html });
    return route.fulfill({ status: 404, body: "" });
  });
  const keep = new Set();
  for (const b of data.builds) {
    tab.html = page(b);
    await tab.goto(ORIGIN + "/");
    await tab.evaluate(() => document.fonts.ready);
    const name = b.id + ".png";
    await tab.screenshot({ path: path.join(OUT, name) });
    keep.add(name);
  }
  for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.rmSync(path.join(OUT, f));
  await browser.close();
  console.log(`wrote ${keep.size} share images`);
})();
