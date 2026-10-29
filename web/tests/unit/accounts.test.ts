import { describe, expect, it } from "vitest";
import { checkPasswordHash, cleanData, cleanEmail, cleanPassword, hashPassword } from "@/lib/accounts";
import { ownerFromCookie } from "@/lib/admin-session";

describe("account passwords", () => {
  it("stores a salted hash that checks only the right password", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^pbkdf2\$100000\$/);
    expect(stored).not.toContain("correct horse");
    expect(await hashPassword("correct horse battery")).not.toBe(stored); // a new salt each time
    expect(await checkPasswordHash("correct horse battery", stored)).toBe(true);
    expect(await checkPasswordHash("correct horse batterY", stored)).toBe(false);
    expect(await checkPasswordHash("anything", null)).toBe(false);
  });

  it("asks for a real email and a long enough password", () => {
    expect(cleanEmail("  Nico@Example.com ")).toBe("nico@example.com");
    expect(() => cleanEmail("not an email")).toThrow(/valid email/);
    expect(() => cleanPassword("short")).toThrow(/10 characters/);
    expect(cleanPassword("long enough pw")).toBe("long enough pw");
  });
});

describe("synced account data", () => {
  it("keeps only known settings of the right type", () => {
    const d = cleanData({
      favorites: ["Ahri"],
      settings: { sound: false, motion: "reduce", graphics: 3, evil: "x" },
      extra: "dropped",
    });
    // Favorites are no longer synced, so they're dropped.
    expect(d).toEqual({ settings: { sound: false, motion: "reduce" } });
    expect(cleanData(null)).toEqual({ settings: {} });
  });

  it("drops a setting whose value the site can't use, so it can't reach every browser the account syncs to", () => {
    const d = cleanData({ settings: { view: "compact", motion: "reduce", text: "huge", tierRange: "last3", graphics: "low" } });
    expect(d).toEqual({ settings: { motion: "reduce", tierRange: "set", graphics: "low" } });
  });
});

describe("owner-only files", () => {
  it("stay closed without a signed-in owner session", async () => {
    expect(await ownerFromCookie(undefined)).toBe(false);
    expect(await ownerFromCookie("not-a-session")).toBe(false);
    expect(await ownerFromCookie("x".repeat(43))).toBe(false); // no accounts database outside Cloudflare
  });
});

describe("connecting a Riot account through My Stats", async () => {
  const { isPlatform, tokenOwner } = await import("@/lib/profiles");
  it("knows the League servers and nothing else", () => {
    expect(isPlatform("euw1")).toBe(true);
    expect(isPlatform("na1")).toBe(true);
    expect(isPlatform("xx1")).toBe(false);
    expect(isPlatform("toString")).toBe(false);
  });
  it("turns away a malformed client token without asking anyone", async () => {
    expect(await tokenOwner("short", "na1")).toBeNull();
    expect(await tokenOwner("has spaces in it and is long enough", "na1")).toBeNull();
  });
});

describe("Sign in with Google or Apple", async () => {
  const { readIdToken } = await import("@/lib/oauth");
  const token = (claims: Record<string, unknown>) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.y`;
  const good = { iss: "accounts.google.com", aud: "client", exp: Date.now() / 1000 + 60, nonce: "n1", sub: "123", email: "A@Example.com", email_verified: true };

  it("reads who signed in, keeping only a verified email", () => {
    expect(readIdToken("google", token(good), "client", "n1")).toEqual({ subject: "123", email: "a@example.com" });
    expect(readIdToken("google", token({ ...good, email_verified: false }), "client", "n1").email).toBeNull();
    expect(readIdToken("apple", token({ ...good, iss: "https://appleid.apple.com", email_verified: "true" }), "client", "n1").email).toBe("a@example.com");
  });

  it("rejects a token for another site, another sign-in, another issuer or one that expired", () => {
    expect(() => readIdToken("google", token(good), "other-client", "n1")).toThrow();
    expect(() => readIdToken("google", token(good), "client", "n2")).toThrow();
    expect(() => readIdToken("apple", token(good), "client", "n1")).toThrow();
    expect(() => readIdToken("google", token({ ...good, exp: 1 }), "client", "n1")).toThrow();
    expect(() => readIdToken("google", "garbage", "client", "n1")).toThrow();
  });
});

describe("Sign in with Apple's client secret", () => {
  it("is an ES256 token signed with the .p8 key", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
    Object.assign(process.env, { APPLE_CLIENT_ID: "com.example.web", APPLE_TEAM_ID: "TEAM", APPLE_KEY_ID: "KEY", APPLE_PRIVATE_KEY: pem });
    let secret = "";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      secret = new URLSearchParams(String(init.body)).get("client_secret") ?? "";
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    try {
      const { exchange } = await import("@/lib/oauth");
      await expect(exchange("apple", { origin: "https://example.com", code: "code", nonce: "n" })).rejects.toThrow(); // no id token in the fake answer
    } finally {
      globalThis.fetch = realFetch;
    }
    const [head, body, sig] = secret.split(".");
    const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
    expect(dec(head)).toEqual({ alg: "ES256", kid: "KEY" });
    expect(dec(body)).toMatchObject({ iss: "TEAM", sub: "com.example.web", aud: "https://appleid.apple.com" });
    const raw = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(sig.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, raw, new TextEncoder().encode(`${head}.${body}`))).toBe(true);
  });
});

describe("other sign-in services", async () => {
  const { readIdToken, steamIdentity, exchange, authorizeUrl } = await import("@/lib/oauth");
  const token = (claims: Record<string, unknown>) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.y`;
  const base = { aud: "client", exp: Date.now() / 1000 + 60, nonce: "n1", sub: "abc", email: "a@b.co", email_verified: true };

  it("accepts Twitch and any Microsoft tenant, and never trusts Microsoft's email", () => {
    expect(readIdToken("twitch", token({ ...base, iss: "https://id.twitch.tv/oauth2" }), "client", "n1").email).toBe("a@b.co");
    const ms = readIdToken("microsoft", token({ ...base, iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0" }), "client", "n1");
    expect(ms).toEqual({ subject: "abc", email: null });
    expect(() => readIdToken("microsoft", token({ ...base, iss: "https://evil.example/v2.0" }), "client", "n1")).toThrow();
  });

  it("asks X for PKCE with the nonce as the verifier", () => {
    const url = new URL(authorizeUrl("x", "https://deeparam.com", "s1", "v".repeat(64)));
    expect(url.searchParams.get("code_challenge")).toBe("v".repeat(64));
    expect(url.searchParams.get("redirect_uri")).toBe("https://deeparam.com/api/account/oauth/x/callback");
  });

  it("reads Discord's user, keeping the email only when Discord confirmed it", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      String(url).includes("/token")
        ? new Response(JSON.stringify({ access_token: "t" }))
        : new Response(JSON.stringify({ id: "42", email: "P@Q.io", verified: false }))) as typeof fetch;
    try {
      expect(await exchange("discord", { origin: "https://deeparam.com", code: "c", nonce: "n" })).toEqual({ subject: "42", email: null });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("checks a Steam answer with Steam and reads the Steam id", async () => {
    const q = new URLSearchParams({
      state: "s1",
      "openid.mode": "id_res",
      "openid.return_to": "https://deeparam.com/api/account/oauth/steam/callback?state=s1",
      "openid.claimed_id": "https://steamcommunity.com/openid/id/76561197960287930",
      "openid.sig": "x",
    });
    const realFetch = globalThis.fetch;
    let sent = "";
    let valid = true;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
    }) as typeof fetch;
    try {
      expect(await steamIdentity("https://deeparam.com", q, "s1")).toEqual({ subject: "76561197960287930", email: null });
      expect(sent).toContain("openid.mode=check_authentication");
      valid = false;
      await expect(steamIdentity("https://deeparam.com", q, "s1")).rejects.toThrow();
      valid = true;
      await expect(steamIdentity("https://deeparam.com", q, "other-state")).rejects.toThrow();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
