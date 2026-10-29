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

  it("counts the owner's site-text saves and Contact us deletes as writes, but not their reads", async () => {
    for (let i = 0; i < 10; i++) expect((await middleware(req("7.7.7.7", "/api/admin/content", "POST"))).status).toBe(200);
    expect((await middleware(req("7.7.7.7", "/api/admin/content", "POST"))).status).toBe(429);
    expect((await middleware(req("7.7.7.7", "/api/contact", "DELETE"))).status).toBe(429);
    expect((await middleware(req("7.7.7.7", "/api/admin/content", "GET"))).status).toBe(200);
    expect((await middleware(req("7.7.7.7", "/api/contact", "GET"))).status).toBe(200);
    expect(config.matcher).toContain("/api/admin/content");
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

  it("leaves the 3D Simulator's models, sounds and page public", () => {
    for (const path of ["/assets/models/:path*", "/assets/sounds/:path*", "/embed/simulator/full.html", "/embed/simulator/replay-data/sounds/:path*"])
      expect(config.matcher).not.toContain(path);
  });
});
