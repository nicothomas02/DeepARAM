import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
import { visitorKey } from "@/lib/visitor-key";

// Outside Cloudflare there are no rate-limit bindings, so these exercise the in-memory fallback.
const req = (ip: string, path = "/api/log", method = "POST") =>
  new NextRequest(`https://deeparam.com${path}`, { method, headers: { "cf-connecting-ip": ip } });

describe("the visitor a rate limit counts", () => {
  it("is the /64 network of an IPv6 address, however the address is spelled", () => {
    for (const address of [
      "2001:db8:0:1::7",
      "2001:DB8:0:1::7", // upper case
      "2001:0db8:0000:0001:0000:0000:0000:0007", // leading zeros, nothing shortened
      "2001:db8:0:1:0:0:0:7",
      "2001:db8::1:0:0:0:7", // "::" in the network half
      "2001:db8:0:1::0.0.0.7", // last 32 bits written as IPv4
      "2001:db8:0:1::", // the two ends of the /64
      "2001:db8:0:1:ffff:ffff:ffff:ffff",
      "2001:0DB8:0:1:FFFF:ffff:FFFF:ffff",
    ])
      expect(visitorKey(address), address).toBe("2001:db8:0:1::/64");
  });

  it("tells neighbouring /64s apart", () => {
    for (const [address, key] of [
      ["2001:db8:0:0:ffff:ffff:ffff:ffff", "2001:db8:0:0::/64"], // one address below 2001:db8:0:1::
      ["2001:db8:0:2::", "2001:db8:0:2::/64"], // one address above 2001:db8:0:1:ffff:ffff:ffff:ffff
      ["2001:db8:1::7", "2001:db8:1:0::/64"],
      ["2001:db8:0:10::7", "2001:db8:0:10::/64"],
    ])
      expect(visitorKey(address), address).toBe(key);
  });

  it("fills in \"::\" wherever it stands", () => {
    for (const [address, key] of [
      ["::", "0:0:0:0::/64"],
      ["::1", "0:0:0:0::/64"],
      ["1::", "1:0:0:0::/64"],
      ["fe80::1", "fe80:0:0:0::/64"],
      ["2001:db8::", "2001:db8:0:0::/64"],
      ["2001:db8:1::2:3", "2001:db8:1:0::/64"], // not 2001:db8:1:2
      ["2001:db8::1:2:3:4:5", "2001:db8:0:1::/64"], // "::" is a single group here
      ["::2001:db8:1:2:3:4:5", "0:2001:db8:1::/64"],
      ["1:2:3:4:5:6:7::", "1:2:3:4::/64"],
      ["64:ff9b::203.0.113.9", "64:ff9b:0:0::/64"],
    ])
      expect(visitorKey(address), address).toBe(key);
  });

  it("leaves IPv4 addresses as they are", () => {
    for (const address of ["203.0.113.9", "1.1.1.1", "0.0.0.0", "255.255.255.255", "10.0.0.1"])
      expect(visitorKey(address), address).toBe(address);
  });

  it("counts an IPv4 address carried inside IPv6 as that IPv4 address", () => {
    for (const address of [
      "::ffff:203.0.113.9",
      "::FFFF:203.0.113.9",
      "0:0:0:0:0:ffff:203.0.113.9",
      "::ffff:cb00:7109", // the same 32 bits in hex
      "0000:0000:0000:0000:0000:ffff:cb00:7109",
    ])
      expect(visitorKey(address), address).toBe("203.0.113.9");
    // only ::ffff:0:0/96 is IPv4; these are ordinary IPv6 addresses
    for (const address of ["::203.0.113.9", "::fffe:203.0.113.9", "::ffff:0:203.0.113.9"])
      expect(visitorKey(address), address).toBe("0:0:0:0::/64");
    expect(visitorKey("1::ffff:203.0.113.9")).toBe("1:0:0:0::/64");
  });

  it("returns anything that is not an address unchanged", () => {
    for (const text of [
      "unknown", // what the middleware uses when no header names the visitor
      "",
      "not an address",
      "fe80::1%eth0", // zone id
      "[2001:db8::1]",
      "[2001:db8::1]:443",
      "2001:db8::1/64",
      "2001:db8::1, 10.0.0.1",
      " 2001:db8::1",
      "2001:db8:::1",
      "2001:db8::1::2", // "::" twice
      ":",
      ":::",
      ":1",
      "1:",
      "1:2:3:4:5:6:7", // seven groups
      "1:2:3:4:5:6:7:8:9", // nine
      "1:2:3:4::5:6:7:8", // "::" with nothing left to fill
      "12345::1", // five hex digits
      "2001:db8::g",
      "::ffff:203.0.113", // three bytes
      "::ffff:203.0.113.256",
      "::ffff:203.0.113.09",
      "::ffff:203.0.113.9.1",
      "203.0.113.9::", // IPv4 anywhere but the end
      "::203.0.113.9:1",
      "1:2:3:4:5:6:7:203.0.113.9", // too long by 16 bits
      "203.0.113",
      "999.0.113.9",
    ])
      expect(visitorKey(text), JSON.stringify(text)).toBe(text);
  });
});

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

  it("counts an IPv6 visitor by their /64 network: 14 addresses in one /64 share one budget", async () => {
    for (let i = 1; i <= 14; i++) {
      const r = await middleware(req(`2001:db8:a:1::${i.toString(16)}`, "/api/contact"));
      expect(r.status, `address ${i}`).toBe(i <= 10 ? 200 : 429);
    }
    // the far end of the same /64, spelled in full and in upper case, is the same visitor
    expect((await middleware(req("2001:0DB8:000A:0001:FFFF:FFFF:FFFF:FFFF", "/api/contact"))).status).toBe(429);
    // and still counted apart from error reports, like any visitor
    expect((await middleware(req("2001:db8:a:1::1"))).status).toBe(200);
  });

  it("gives another /64 and each IPv4 address a budget of their own", async () => {
    for (let i = 0; i < 10; i++) expect((await middleware(req(`2001:db8:b:1::${i}`, "/api/contact"))).status).toBe(200);
    expect((await middleware(req("2001:db8:b:1::a", "/api/contact"))).status).toBe(429);
    // the /64s on either side are other visitors, each with all 10 sends
    expect((await middleware(req("2001:db8:b:0:ffff:ffff:ffff:ffff", "/api/contact"))).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await middleware(req(`2001:db8:b:2::${i}`, "/api/contact"))).status).toBe(200);
    expect((await middleware(req("2001:db8:b:2::a", "/api/contact"))).status).toBe(429);
    // IPv4 visitors are still counted by their whole address
    for (let i = 0; i < 10; i++) expect((await middleware(req("9.9.9.9", "/api/contact"))).status).toBe(200);
    expect((await middleware(req("9.9.9.9", "/api/contact"))).status).toBe(429);
    expect((await middleware(req("9.9.9.8", "/api/contact"))).status).toBe(200);
    // also when the address arrives wrapped in IPv6
    expect((await middleware(req("::ffff:9.9.9.9", "/api/contact"))).status).toBe(429);
    expect((await middleware(req("::ffff:9.9.9.7", "/api/contact"))).status).toBe(200);
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
