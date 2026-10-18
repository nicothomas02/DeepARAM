import { expect, test, type Page } from "@playwright/test";

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
    ["/simulator/infinite-ryze", "/simulator?tab=infinite-ryze"],
  ]) {
    await page.goto(from);
    expect(new URL(page.url()).pathname + new URL(page.url()).search, from).toBe(to);
  }
  // Pages merged into the Tier List: the tab is picked and the old query kept.
  for (const [from, path, tab, keep] of [
    ["/augments?tab=duos&q=Jinx", "/tier-list", "duos", "q"],
    // Augments by icon and Draft practice were removed: their old addresses open the augment tier list.
    ["/draft", "/tier-list", "augments", null],
    ["/augments?tab=draft&champ=Jinx", "/tier-list", "augments", null],
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

test("new visitors start in dark mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("owner-only files stay private without the owner's sign-in", async ({ request }) => {
  for (const path of ["/assets/models/aphelios/523000/model.glb", "/assets/sounds/sounds.m4a", "/embed/simulator/full.html"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
  }
  // The old owner page now sends everyone to /simulator, where only the owner gets the 3D switch.
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

// Contact us: the footer box offers a message box and an email link; a message sends and says thanks.
test("Contact us sends a message or opens email", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/contact", async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ status: 201, contentType: "application/json", body: '{"ok":true}' });
  });
  // Home's first-visit tour would cover the footer.
  await page.addInitScript(() => localStorage.setItem("deeparam-tour", "done"));
  await page.goto("/");
  const box = page.locator(".feedback-box");
  await box.getByRole("button", { name: "Email admin@deeparam.com" }).click();
  await expect(box.getByRole("radio", { name: "Gmail (new tab)" })).toBeChecked();
  await expect(box.getByRole("link", { name: "Open email" })).toHaveAttribute("href", /^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
  await box.getByRole("radio", { name: /Mail app/ }).check();
  await expect(box.getByRole("link", { name: "Open email" })).toHaveAttribute("href", /^mailto:admin@deeparam\.com/);
  await box.getByRole("button", { name: "Write to us" }).click();
  await box.locator("textarea").fill("The Duos tab is great.");
  await box.getByRole("button", { name: "Send" }).click();
  await expect(box.getByRole("status")).toContainText("Thanks!");
  expect(sent).toMatchObject({ message: "The Duos tab is great.", page: "/" });
});
