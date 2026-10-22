import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { setOf } from "../../src/lib/sets";
import { awaitingData, type PatchSchedule } from "../../src/lib/patch-schedule";
import { patchName, patchVersion } from "../../src/lib/patch-name";

// Every main page: loads, shows the header and the legal notice, throws no script errors,
// loads every image and script it asks for from the site, and never scrolls sideways on a phone.
const PAGES = [
  "/",
  "/tier-list",
  "/tier-list?tab=augments",
  "/simulator",
  "/pbe",
  "/info",
  "/kitchen",
  "/info/region-teams",
  "/champions/Ahri",
  "/champions/Yunara",
  "/patches",
  "/tier-list?tab=items",
  "/tier-list?tab=items&itag=crit,as",
  "/tier-list?tag=Mage,Poke",
  "/account",
  "/privacy",
  "/terms",
];

// Data-origin and backend names that must never show on a page (site rule), and the mode's internal name.
const FORBIDDEN = /communitydragon|cdragon|datamin|tencent|101\.qq|riot api|cloudflare|next\.js|github|built with|open full screen|\bkiwi\b/i;

// Files a page looks for first and does without when they aren't there (each falls back or stays optional):
// My Stats' local sync helper and backup, and the Simulator's locally built sprites, models and sounds
// (the models fall back to /assets/models/).
const OPTIONAL = /^\/embed\/(dashboard\/(data|api)\/|simulator\/replay-data\/(sprites\.webp|models\/|sounds\/))/;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`script error: ${e.message}`));
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (url.host === new URL(page.url() || "http://localhost").host || url.hostname === "localhost") {
      if (r.status() >= 400 && /^\/(_next|assets|embed)\//.test(url.pathname) && !OPTIONAL.test(url.pathname)) problems.push(`${r.status()} ${url.pathname}`);
    }
  });
  return problems;
}

for (const path of PAGES) {
  test(`${path} loads cleanly`, async ({ page }) => {
    const problems = watch(page);
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res?.status(), "page status").toBe(200);
    await page.waitForLoadState("load");
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("footer").first()).toContainText("isn't endorsed by Riot Games");
    // let client code and embeds settle, then look for anything that went wrong
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    expect(text, "data-origin or backend wording on the page").not.toMatch(FORBIDDEN);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
    expect(problems).toEqual([]);
  });
}

test("unknown pages get the 404 page", async ({ page }) => {
  const res = await page.goto("/champions/NotAChampion");
  expect(res?.status()).toBe(404);
  const res2 = await page.goto("/this-page-does-not-exist");
  expect(res2?.status()).toBe(404);
  await expect(page.locator("header").first()).toBeVisible();
});

test("old addresses redirect to the current tabs", async ({ page }) => {
  for (const [from, to] of [
    ["/guide", "/info"],
    ["/tools/guide", "/info"],
    ["/tools/simulator", "/simulator"],
    ["/china", "/tier-list"],
    ["/tools/fun", "/kitchen"],
    ["/lab", "/kitchen"],
    ["/stats", "/account"],
    ["/status", "/"],
    ["/simulator/infinite-ryze", "/kitchen?tab=infinite-ryze"],
    ["/simulator?tab=infinite-ryze", "/kitchen?tab=infinite-ryze"],
  ]) {
    await page.goto(from);
    expect(new URL(page.url()).pathname + new URL(page.url()).search, from).toBe(to);
  }
  // Pages merged into the Tier List: the tab is picked and the old query kept.
  for (const [from, path, tab, keep] of [
    ["/augments?tab=duos&q=Jinx", "/tier-list", "champions", "cview"],
    ["/tier-list?tab=duos", "/tier-list", "champions", "cview"],
    // Augments by icon and Draft practice were removed: their old addresses open the augment tier list.
    ["/draft", "/tier-list", "augments", null],
    ["/augments?tab=draft", "/tier-list", "augments", null],
    ["/tier-list?tab=draft", "/tier-list", "augments", null],
    ["/augments?tab=groups", "/tier-list", "augments", null],
    ["/tier-list?tab=groups", "/tier-list", "augments", null],
    ["/items", "/tier-list", "items", null],
    ["/items?tag=crit,as", "/tier-list", "items", "itag"],
  ]) {
    await page.goto(from!);
    const url = new URL(page.url());
    expect(url.pathname, from!).toBe(path);
    expect(url.searchParams.get("tab"), from!).toBe(tab);
    if (keep) expect(url.searchParams.get(keep), from!).toBeTruthy();
  }
  // What to build moved to champion pages, and the augment tier list to the Tier List.
  for (const [from, to] of [
    ["/builds?champ=Jinx", "/champions/Jinx"],
    ["/what-to-build?champ=Jinx", "/champions/Jinx"],
    ["/builds?tab=helper", "/tier-list"],
    ["/augments?tab=tiers", "/tier-list"],
    ["/augments?rarity=gold&style=ap", "/tier-list"],
    ["/augments", "/tier-list"],
    // Compare was removed.
    ["/compare?a=Jinx", "/tier-list"],
    ["/builds?tab=compare&a=Jinx&b=Ezreal", "/tier-list"],
    // The build tools were removed.
    ["/builds", "/tier-list"],
    ["/builds?tab=editor&champ=Jinx", "/tier-list"],
    ["/builder", "/tier-list"],
    ["/synergy", "/tier-list"],
  ]) {
    await page.goto(from);
    expect(new URL(page.url()).pathname, from).toBe(to);
    if (to === "/tier-list" && from.startsWith("/augments")) expect(new URL(page.url()).searchParams.getAll("tab"), from).toEqual(["augments"]);
  }
  // The Lab is The Kitchen now; a deep link keeps its #hash.
  await page.goto("/lab#chefs-special");
  expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe("/kitchen#chefs-special");
});

test("clicking a champion on the Tier List opens its page, with no favorites or compare buttons", async ({ page }) => {
  await page.goto("/tier-list");
  const row = page.locator(".data-table tbody tr").first();
  await expect(row.locator(".fav-star, .cmp-toggle, .champ-open")).toHaveCount(0);
  const link = row.locator('a[href^="/champions/"]').first();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator(".fav-star, .cmp-toggle")).toHaveCount(0);
});

test("the Tier List shows every stat in one table, with no separate advanced section", async ({ page }) => {
  await page.goto("/tier-list");
  const main = page.locator(".data-table").first();
  await expect(main.locator("thead")).toContainText("Damage share");
  await expect(page.locator(".advanced-stats")).toHaveCount(0);
  // Changes read in percentage points, never as a negative zero.
  await expect(main.locator("tbody").first()).not.toContainText("-0.0");
});

test("the Augments and Items tabs follow the Champions layout: filters folded above one sortable table", async ({ page }) => {
  await page.goto("/tier-list?tab=augments");
  const augs = page.locator(".atiers .data-table").first();
  await expect(augs.locator("tbody tr").first()).toBeVisible();
  await expect(page.locator(".atiers-rows, .view-switch")).toHaveCount(0);
  // The filter chips sit under a closed "Filter by tags" button.
  const prismatic = page.locator(".atiers .chip-toggle", { hasText: "Prismatic" });
  await expect(prismatic).toBeHidden();
  await expect(async () => {
    if (!(await prismatic.isVisible())) await page.locator("#panel-augments .items-filter-menu > summary").click();
    await expect(prismatic).toBeVisible({ timeout: 1000 });
  }).toPass();
  await prismatic.click();
  await expect(page).toHaveURL(/rarity=prismatic/);
  await expect(page.locator("#panel-augments .items-filter-n")).toHaveText("1");

  await page.goto("/tier-list?tab=items");
  const table = page.locator(".items-index .data-table").first();
  await expect(table.locator('a[href^="/items/"]').first()).toBeVisible();
  await expect(page.locator(".item-card")).toHaveCount(0);
  // No sort menu on any screen: the column headers sort (phones hide Cost, so they sort by win rate).
  await expect(page.locator(".table-sort")).toHaveCount(0);
  const col = test.info().project.name === "phone" ? "Est. win rate" : "Cost";
  await table.locator("thead button", { hasText: col }).click();
  await expect(table.locator("th[aria-sort]")).toContainText(col);
});

test("Champions: tags behind a Filter button, Duos as a view, and Show more opens every row", async ({ page }) => {
  await page.goto("/tier-list");
  const champs = page.locator("#panel-champions");
  await expect(champs.locator(".arch-tag").first()).toBeHidden();
  // A click before the page finishes loading can be undone by it, so retry until the fold stays open.
  await expect(async () => {
    if (!(await champs.locator(".arch-tag").first().isVisible())) await champs.locator(".items-filter-menu > summary").first().click();
    await expect(champs.locator(".arch-tag").first()).toBeVisible({ timeout: 1000 });
  }).toPass();

  const more = champs.locator(".show-more").first();
  if (await more.count()) {
    await more.click();
    await expect(champs.locator(".show-more")).toHaveCount(0);
  }

  // Duos are a view of the Champions tab, not a tab of their own.
  await expect(page.locator("#tab-duos")).toHaveCount(0);
  await champs.locator(".champ-view button", { hasText: "Duos" }).click();
  await expect(page).toHaveURL(/cview=duos/);
  await expect(champs.locator(".data-table th", { hasText: "Win rate boost" }).first()).toBeVisible();
});

test("champion quests show on both champions' pages and under Duos", async ({ page }) => {
  await page.goto("/champions/Viktor");
  const quest = page.locator("#quests");
  await expect(quest).toContainText("Our Shared Dream");
  await expect(quest).toContainText("Viktor must take down Jayce 5 times.");
  await expect(quest.locator('a[href="/champions/Jayce"]')).toBeVisible();
  await page.goto("/champions/Ekko");
  await expect(page.locator("#quests")).toContainText("Echoes of Innocence");
  await page.goto("/tier-list?cview=duos");
  await expect(page.locator(".duo-quest").first()).toContainText("Echoes of Innocence");
});

test("new visitors start in dark mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the 3D Simulator's page, models and sounds are public", async ({ request }) => {
  for (const path of ["/assets/models/aphelios/523000/model.glb", "/assets/sounds/sounds.m4a", "/embed/simulator/full.html"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
  }
  // The old owner page sends everyone to /simulator.
  const res = await request.get("/account/simulator", { maxRedirects: 0 });
  expect([307, 308]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/simulator$/);
});

test("the Tier List's Items tab filters items and links to item pages", async ({ page }) => {
  await page.goto("/tier-list?tab=items&itag=crit");
  const index = page.locator(".items-index");
  await expect(index).toBeVisible();
  await expect(index.locator('[aria-pressed="true"]').first()).toBeVisible();
  const first = index.locator('a[href^="/items/"]').first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("augment and item pages show the official description under the name, and best champions their win rate boost and the list the best champ", async ({ page }) => {
  await page.goto("/items/zhonyas-hourglass");
  await expect(page.locator(".champ-hero .official-desc")).toContainText("Time Stop");
  await page.goto("/tier-list?tab=augments");
  // The augment list shows the best champion's icon and no longer the rank columns.
  const heads = page.locator("#augments thead th, [role=tabpanel] thead th");
  await expect(heads.filter({ hasText: "Best champ" })).toHaveCount(1);
  await expect(heads.filter({ hasText: /Win rank|Pick rank/ })).toHaveCount(0);
  // On phones the simple view hides the column, so only check the icon is there.
  await expect(page.locator("td img.champ-icon").first()).toBeAttached();
  const aug = page.locator('a[href^="/augments/"]').first();
  await aug.click();
  await expect(page.locator(".champ-hero .official-desc")).not.toBeEmpty();
  await expect(page.locator(".card", { hasText: "Best champions for it" }).locator(".card-note")).toContainText("Win rate boost");
});

test("share links for a Chef Special and a build give link previews their card", async ({ page, request }) => {
  const special = await request.get("/kitchen/2026-10-17");
  expect(special.status()).toBe(200);
  const html = await special.text();
  expect(html).toMatch(/<meta property="og:image" content="[^"]*\/embed\/fun\/cook-builds\/share\/tryndamere-bloodlust-doctor\.png"/);
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect((await request.get("/kitchen/2001-01-01")).status()).toBe(404);

  const build = await request.get("/share/builds?champ=Jinx&items=berserkers,infinity_edge&augs=deft&to=sim");
  const image = (await build.text()).match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  expect(image).toContain("/share/builds/image?champ=Jinx");
  const png = await request.get(new URL(image!).pathname + new URL(image!).search);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");

  // A visitor goes on to the build in the Simulator's fight replay.
  await page.goto("/share/builds?champ=Jinx&items=berserkers,infinity_edge&augs=deft&to=sim");
  await expect(page).toHaveURL(/\/simulator\?tab=replays#Jinx&items=berserkers,infinity_edge&augs=deft$/);
});

// Contact us: the footer box offers a message box and a mailto line; a message sends and says thanks.
test("Contact us sends a message and shows the email line", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/contact", async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ status: 201, contentType: "application/json", body: '{"ok":true}' });
  });
  // Home's first-visit tour would cover the footer.
  await page.addInitScript(() => localStorage.setItem("deeparam-tour", "done"));
  await page.goto("/");
  const box = page.locator(".feedback-box");
  await expect(box.getByRole("link", { name: "admin@deeparam.com" })).toHaveAttribute("href", "mailto:admin@deeparam.com");
  await box.getByRole("button", { name: "Write to us" }).click();
  await box.locator("textarea").fill("The Duos tab is great.");
  await box.getByRole("button", { name: "Send" }).click();
  await expect(box.getByRole("status")).toContainText("Thanks!");
  expect(sent).toMatchObject({ message: "The Duos tab is great.", page: "/" });
});

test("the Simulator opens in 3D even with the old owner switch's saved 2D pick", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("deeparam-sim-view", "2d"));
  await page.goto("/simulator");
  const toggle = page.getByRole("switch", { name: "Performance mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("iframe").first()).toHaveAttribute("src", /^\/embed\/simulator\/full\.html/);
  await toggle.click();
  await expect(page.locator("iframe").first()).toHaveAttribute("src", /^\/embed\/simulator\/index\.html/);
});

test("patch history groups by set, recaps list added and removed augments only where a patch has them, and the champion list offers the set", async ({ page }) => {
  // The live patch's set, from the same patch list the pages read
  const patches = readFileSync("../data/cn/history/patches.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[0]);
  const live = setOf(patches[patches.length - 1]);
  const inSet = patches.filter((p) => setOf(p).name === live.name);
  // A patch that is out but has no stats yet heads the list as Live, in its own set, with no recap link yet
  const schedule = JSON.parse(readFileSync("../data/patch-schedule.json", "utf8")) as PatchSchedule;
  const waiting = awaitingData(schedule, patches[patches.length - 1]);
  await page.goto("/patches");
  await expect(page.locator(".recap-set-head").first()).toContainText(waiting ? setOf(patchVersion(waiting.patch)).name : live.name);
  if (waiting) {
    await expect(page.locator(".recap-row").first()).toContainText(patchName(waiting.patch));
    await expect(page.locator(".recap-row").first()).toContainText("Live");
  }
  await expect(page.locator(".recap-set-head", { hasText: live.name })).toHaveCount(1);
  await expect(page.locator(".recap-set-head", { hasText: "Launch" })).toHaveCount(1);
  await page.locator("a.recap-row").first().click();
  await expect(page.locator(".champ-hero .eyebrow")).toContainText(live.name);
  // Patch 16.21 (26.21) removed augments and added none; 16.12 did both.
  await page.goto("/patches/26.21");
  await expect(page.locator("main h2", { hasText: "Augments removed" })).toHaveCount(1);
  await expect(page.locator("main h2", { hasText: "Augments added" })).toHaveCount(0);
  await page.goto("/patches/26.12");
  await expect(page.locator("main h2", { hasText: "Augments added" })).toHaveCount(1);
  await expect(page.locator("main h2", { hasText: "Augments removed" })).toHaveCount(1);
  await page.goto("/patches/26.20");
  await expect(page.locator("main h2", { hasText: /Augments (added|removed)/ })).toHaveCount(0);

  await page.goto("/tier-list");
  const set = page.getByRole("button", { name: /This set/ });
  if (inSet.length > 1)
    await expect(async () => {
      await set.click();
      await expect(page).toHaveURL(new RegExp(`patches=${inSet[0].replace(".", "\\.")}(,|%2C)`), { timeout: 1000 });
    }).toPass();
  await page.locator(".patch-pick > summary").click();
  await expect(page.locator(".patch-pick-set-head").first()).toContainText(live.name);
});
