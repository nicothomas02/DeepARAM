import { expect, test } from "@playwright/test";

// Bugs that were fixed once and must stay fixed.

// #91: the sign-in box overflowed its card on phones (then a Riot ID box; now the account sign-in).
test("account sign-in fits on the screen", async ({ page }) => {
  await page.goto("/account");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  const vw = page.viewportSize()!.width;
  for (const sel of ['input[type="email"]', 'input[type="password"]', 'form button[type="submit"]']) {
    const box = (await page.locator(sel).first().boundingBox())!;
    expect(box, sel).not.toBeNull();
    expect(box.x, sel).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, sel).toBeLessThanOrEqual(vw);
  }
});

// #84: a saved account the server couldn't answer for crashed the header (then a Riot ID; now a sign-in).
test("a signed-in browser whose account can't load doesn't break the page", async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([{ name: "deeparam-signed-in", value: "1", url: baseURL! }]);
  await page.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
  for (const path of ["/", "/account"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await expect(page.locator("header").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

// #73: a client-side error shows a recoverable message, not a blank "Application error".
test("a broken settings save doesn't blank the site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("deeparam-settings", "{broken");
    localStorage.setItem("deeparam-favorites", "{broken");
    localStorage.setItem("deeparam-theme", "purple");
  });
  await page.goto("/tier-list");
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
  expect(errors).toEqual([]);
});

// The site fills the screen: no fixed-width page container on a wide desktop (#64, #82).
test("pages fill wide screens", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto("/tier-list");
  const width = await page.locator("main").first().evaluate((m) => m.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(1800);
});

// Champion pages were very long: Simple view cuts lists at 5 rows and folds the bulky panels, which a
// section link still opens; Detailed view shows everything with no "Show more" buttons.
test("champion page: Simple view folds, section links open them, Detailed shows all", async ({ page }) => {
  await page.goto("/champions/Swain");
  const stats = page.locator("#stats");
  await expect(stats).toBeHidden();
  await expect(page.locator(".cp-side .cp-best").first()).toBeVisible();
  const rows = page.locator("#builds ~ .cp-panel").first().locator(".cp-row");
  await expect(rows.nth(4)).toBeVisible();
  await expect(rows.nth(5)).toBeHidden();
  await page.locator('.cp-rail a[href="#details"]').click();
  await expect(stats).toBeVisible();

  await page.addInitScript(() => localStorage.setItem("deeparam-settings", JSON.stringify({ view: "detailed" })));
  await page.goto("/champions/Swain");
  await expect(stats).toBeVisible();
  await expect(page.locator(".cp-fold-btn").first()).toBeHidden();
});

// The Tier List on a phone: the champion table fits the screen (win rate in view without scrolling sideways),
// sorts from its column headers, and a tap anywhere on a row opens the champion.
test("tier list table fits a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto("/tier-list");
  const scroll = page.locator("#panel-champions .table-scroll").first();
  await expect(scroll.locator("tbody tr").first()).toBeVisible();
  const [sw, cw] = await scroll.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  // Names show in full: a long one wraps instead of being cut, and the name column gets the room the numbers leave.
  const cut = await scroll.locator("td .nm").evaluateAll((names) => names.filter((n) => n.scrollWidth > n.clientWidth + 1).length);
  expect(cut).toBe(0);
  const nameCol = await scroll.locator("thead th.pin").evaluate((th) => th.getBoundingClientRect().width);
  expect(nameCol).toBeGreaterThan(130);
  // Every stat is one table now; the extra columns drop out on phones, the measured win rate stays.
  await expect(scroll.locator("thead th", { hasText: "Raw win rate" })).toBeInViewport();

  // No separate sort menu: the column headers sort, both ways.
  await expect(page.locator("#panel-champions .table-sort")).toHaveCount(0);
  await scroll.locator("thead th", { hasText: "Raw win rate" }).click();
  await expect(page).toHaveURL(/sort=win_rate\.(desc|asc)/);
  const desc = /sort=win_rate\.desc/.test(page.url());
  const rates = await scroll.locator("tbody tr").evaluateAll((rows) =>
    rows.slice(0, 5).map((r) => parseFloat([...r.querySelectorAll("td")].find((td) => /wr-/.test(td.className))?.textContent ?? "0")),
  );
  expect(rates).toEqual([...rates].sort((a, b) => (desc ? b - a : a - b)));

  await scroll.locator("tbody tr").first().locator("td.rank-col").click();
  await expect(page).toHaveURL(/\/champions\//);
});

// Next.js 16 loads every link in view in the background; the home page's champion grid alone fetched 32
// pages (about 600 kB on a phone). List links only load when pointed at or touched.
test("pages don't load every listed champion in the background", async ({ page }) => {
  for (const path of ["/", "/champions"]) {
    const loaded: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("_rsc=") && new URL(r.url()).pathname.startsWith("/champions/")) loaded.push(r.url());
    });
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.waitForTimeout(1500);
    expect(loaded.length, path).toBeLessThanOrEqual(2);
    page.removeAllListeners("request");
  }
});

// A Home page kept from yesterday showed yesterday's Chef Special while The Kitchen showed today's.
// When the current special differs from the one on the page, Home reloads its data (a non-prefetch RSC
// request for "/"; prefetches of the Home link don't count).
const homeRefresh = (r: { url(): string; headers(): Record<string, string> }) =>
  new URL(r.url()).pathname === "/" && !!r.headers()["rsc"] && !r.headers()["next-router-prefetch"];

test("Home refreshes a Chef Special kept from an earlier day", async ({ page }) => {
  await page.route("**/data/chef-special.json*", (r) => r.fulfill({ json: { id: "a-newer-special" } }));
  const refreshed = page.waitForRequest(homeRefresh, { timeout: 15_000 });
  await page.goto("/");
  await expect(page.locator(".chef-special")).toBeVisible();
  await refreshed;
});

test("Home keeps a current Chef Special as it is", async ({ page }) => {
  const refreshes: string[] = [];
  page.on("request", (r) => homeRefresh(r) && refreshes.push(r.url()));
  const checked = page.waitForResponse((r) => new URL(r.url()).pathname === "/data/chef-special.json");
  await page.goto("/");
  await checked;
  await page.waitForTimeout(1000);
  expect(refreshes).toEqual([]);
});
