import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";

// Outside Cloudflare there are no rate-limit bindings, so these exercise the in-memory fallback.
const req = (ip: string, path = "/api/log", method = "POST") =>
  new NextRequest(`https://deeparam.com${path}`, { method, headers: { "cf-connecting-ip": ip } });

describe("rate limits", () => {
  it("allows 30 error reports a minute per visitor, then answers 429 with Retry-After", async () => {
    for (let i = 0; i < 30; i++) expect((await middleware(req("1.1.1.1"))).status).toBe(200);
    const blocked = await middleware(req("1.1.1.1"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/Too many/);
    // another visitor is unaffected
    expect((await middleware(req("2.2.2.2"))).status).toBe(200);
  });

  it("allows 10 profile or Contact sends a minute, counted apart from error reports", async () => {
    for (let i = 0; i < 10; i++) expect((await middleware(req("3.3.3.3", "/api/profile", "POST"))).status).toBe(200);
    expect((await middleware(req("3.3.3.3", "/api/contact", "POST"))).status).toBe(429);
    expect((await middleware(req("3.3.3.3"))).status).toBe(200);
  });

  it("allows 10 sign-in tries a minute, but never limits reading your account", async () => {
    for (let i = 0; i < 10; i++) expect((await middleware(req("6.6.6.6", "/api/account/signin", "POST"))).status).toBe(200);
    expect((await middleware(req("6.6.6.6", "/api/account/signup", "POST"))).status).toBe(429);
    for (let i = 0; i < 20; i++) expect((await middleware(req("6.6.6.6", "/api/account", "GET"))).status).toBe(200);
    // Saving Favorites and settings is counted on its own, more generous limit.
    expect((await middleware(req("6.6.6.6", "/api/account", "PUT"))).status).toBe(200);
  });

  it("never limits reading public profiles", async () => {
    for (let i = 0; i < 50; i++) expect((await middleware(req("4.4.4.4", "/api/profile", "GET"))).status).toBe(200);
  });

  it("lets My Stats share a 1,000-game archive in one go", async () => {
    for (let i = 0; i < 20; i++) expect((await middleware(req("5.5.5.5", "/api/games", "POST"))).status).toBe(200);
  });

  it("never limits reading Home's shared-games count", async () => {
    for (let i = 0; i < 80; i++) expect((await middleware(req("7.7.7.7", "/api/games", "GET"))).status).toBe(200);
  });

  it("allows 10 Kitchen sends or removals a minute, but never limits reading the community list", async () => {
    for (let i = 0; i < 30; i++) expect((await middleware(req("8.8.8.8", "/api/kitchen/community", "GET"))).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await middleware(req("8.8.8.8", "/api/kitchen/submissions", "POST"))).status).toBe(200);
    expect((await middleware(req("8.8.8.8", "/api/kitchen/submissions/abc", "DELETE"))).status).toBe(200);
    expect((await middleware(req("8.8.8.8", "/api/kitchen/submissions", "POST"))).status).toBe(429);
  });

  it("guards error reports, sign-in and the write routes", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/api/log", "/api/profile", "/api/games", "/api/account", "/api/account/:path*", "/api/kitchen/:path*", "/api/contact"]));
    expect(config.matcher).not.toContain("/api/sim-scores"); // the Simulator leaderboard was removed
  });

  it("allows 60 live-game reports a minute, counted with the same visitor's uploads", async () => {
    for (let i = 0; i < 60; i++) expect((await middleware(req("10.10.10.10", "/api/widget/live"))).status).toBe(200);
    expect((await middleware(req("10.10.10.10", "/api/widget/live"))).status).toBe(429);
    expect((await middleware(req("10.10.10.10", "/api/games"))).status).toBe(429);
    expect((await middleware(req("10.10.10.11", "/api/widget/live"))).status).toBe(200);
  });

  // config.matcher decides which requests reach the middleware at all, and the tests above call middleware()
  // directly, so they cannot tell when a path with a rule is missing from the matcher.
  it("reaches every path a rule names", () => {
    // Paths a rule names that the matcher is known not to reach. None today: keep it empty.
    const knownGaps: string[] = [];

    // The middleware is read as text: every quoted path above the matcher counts as a path a rule names. "/api/x"
    // on its own is one path, startsWith("/api/x") a whole branch. A message that starts "Update this test" means
    // the code changed shape and can no longer be read here, not that a route lost its limit.
    const source = readFileSync(new URL("../../src/middleware.ts", import.meta.url), "utf8");
    const end = source.indexOf("export const config");
    expect(end, 'Update this test: it reads src/middleware.ts up to "export const config", which it can no longer find.').toBeGreaterThan(0);
    const code = source.slice(0, end).replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, "");
    expect(/\.(test|match|exec)\(|RegExp/.test(code), "Update this test: src/middleware.ts now uses a regular expression. A rule written as one cannot be read here.").toBe(false);
    const named = [...code.matchAll(/(startsWith\(\s*)?(["'`])(\/[^"'`\s]*)\2/g)].map((m) => ({ path: m[3], branch: Boolean(m[1]) }));
    expect(
      named.map((n) => n.path),
      "Update this test: it no longer finds the rules' paths in src/middleware.ts. If the rules moved to another file, read that file here.",
    ).toEqual(expect.arrayContaining(["/api/log", "/api/widget/live"]));

    // What Next does with a matcher entry, for the forms used here: ":name" is one segment, "/:name*" any number.
    for (const entry of config.matcher)
      expect(entry, `Update this test: it cannot read the matcher entry "${entry}". It knows plain paths, ":name" and "/:name*".`).toMatch(/^(\/[\w-]+|\/:\w+\*?)+$/);
    const reaches = (path: string) =>
      config.matcher.some((entry) => new RegExp(`^${entry.replace(/\/:\w+\*/g, "(/.+)?").replace(/:\w+/g, "[^/]+")}$`).test(path));

    for (const { path, branch } of named) {
      const base = path.replace(/\/$/, "");
      const samples = branch ? [...(path === base ? [base] : []), `${base}/x`, `${base}/x/y`] : [path];
      const missed = samples.filter((sample) => !reaches(sample));
      if (knownGaps.includes(path)) expect(missed.length, `"${path}" is now matched: take it off the list of known gaps in this test.`).toBeGreaterThan(0);
      else
        expect(
          missed,
          `config.matcher does not reach ${missed.join(", ")}, so the rule for "${path}" never runs on the site: add the path to config.matcher. If "${path}" in src/middleware.ts is not a rule's path, update this test instead.`,
        ).toEqual([]);
    }
    for (const gap of knownGaps)
      expect(named.some((n) => n.path === gap), `"${gap}" is on this test's list of known gaps, but nothing in src/middleware.ts names it: take it off the list.`).toBe(true);
  });

  it("leaves the 3D Simulator's models, sounds and page public", () => {
    for (const path of ["/assets/models/:path*", "/assets/sounds/:path*", "/embed/simulator/full.html", "/embed/simulator/replay-data/sounds/:path*"])
      expect(config.matcher).not.toContain(path);
  });
});

describe("near-miss page addresses", () => {
  const get = (path: string) => middleware(new NextRequest(`https://deeparam.com${path}`));

  it("sends lower-case, display-name and punctuated champion links to the real page", async () => {
    for (const [from, to] of [
      ["/champions/ahri", "/champions/Ahri"],
      ["/champions/wukong", "/champions/MonkeyKing"],
      ["/champions/kai'sa", "/champions/Kaisa"],
      ["/champions/Aurelion%20Sol", "/champions/AurelionSol"],
    ]) {
      const r = await get(from);
      expect(r.status, from).toBe(308);
      expect(new URL(r.headers.get("location")!).pathname, from).toBe(to);
    }
  });

  it("lower-cases item and augment addresses and keeps the query", async () => {
    const r = await get("/augments/Titans-Resolve?x=1");
    expect(r.status).toBe(308);
    const u = new URL(r.headers.get("location")!);
    expect(u.pathname + u.search).toBe("/augments/titans-resolve?x=1");
    expect((await get("/items/Infinity-Edge")).status).toBe(308);
  });

  it("sends item and augment names typed with spaces and apostrophes to their page", async () => {
    for (const [from, to] of [
      ["/items/Infinity%20Edge", "/items/infinity-edge"],
      ["/items/rabadon's%20deathcap", "/items/rabadons-deathcap"],
      ["/augments/Titan's%20Resolve", "/augments/titans-resolve"],
    ]) {
      const r = await get(from);
      expect(r.status, from).toBe(308);
      expect(new URL(r.headers.get("location")!).pathname, from).toBe(to);
    }
  });

  it("leaves real pages and unknown names alone", async () => {
    for (const p of ["/champions/Ahri", "/champions/MonkeyKing", "/champions/Nobody", "/augments/titans-resolve", "/items/nope"])
      expect((await get(p)).status, p).toBe(200);
  });

  it("matches the routes it fixes", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/champions/:alias", "/items/:slug", "/augments/:slug"]));
  });
});
