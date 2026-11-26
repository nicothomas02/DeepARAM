import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CHALLENGE_COOKIE } from "@/lib/account-cookies";
import { POST } from "@/app/api/account/passkey/route";

// The passkey route (api/account/passkey) run against SimpleWebAuthn itself. The "device" is a real key made
// here that builds and signs its answers the way an authenticator does, so every check the library makes
// (challenge, site, signature, counter, key type) is the real one. Only the accounts database, the session
// and the browser's copy of the challenge cookie are stand-ins.

const HOST = "deeparam.test";
const SITE = `https://${HOST}`;

type Row = { id: string; account: string; public_key: string; counter: number; transports: string | null; label: string };
const h = vi.hoisted(() => {
  // Newer servers can check ML-DSA-44 signatures, and on those SimpleWebAuthn 14's own defaults offer and accept
  // that key type as well. Every test here runs as if on such a server, where the defaults and the site differ.
  // Set here so it is in place before SimpleWebAuthn is loaded.
  Object.defineProperty(SubtleCrypto, "supports", { configurable: true, value: () => true });
  return {
    jar: new Map<string, string>(),
    accounts: [] as { id: string; email: string }[],
    passkeys: [] as Row[],
    sessions: [] as string[],
    signedIn: null as { id: string; email: string | null } | null,
  };
});

// Just the statements this route sends.
function query(sql: string, v: unknown[]): unknown[] {
  if (sql.startsWith("SELECT id, transports FROM passkeys WHERE account = ?")) return h.passkeys.filter((k) => k.account === v[0]);
  if (sql.startsWith("SELECT p.*, a.owner FROM passkeys p")) return h.passkeys.filter((k) => k.id === v[0]).map((k) => ({ ...k, owner: 0 }));
  if (sql.startsWith("SELECT 1 FROM accounts WHERE email = ?")) return h.accounts.filter((a) => a.email === v[0]);
  if (sql.startsWith("INSERT INTO accounts")) h.accounts.push({ id: String(v[0]), email: String(v[1]) });
  else if (sql.startsWith("INSERT INTO passkeys")) h.passkeys.push({ id: String(v[0]), account: String(v[1]), public_key: String(v[2]), counter: Number(v[3]), transports: v[4] as string | null, label: String(v[5]) });
  else if (sql.startsWith("UPDATE passkeys SET counter = ? WHERE id = ?")) h.passkeys.filter((k) => k.id === v[1]).forEach((k) => (k.counter = Number(v[0])));
  else throw new Error(`The stand-in database doesn't know: ${sql}`);
  return [];
}
type Stmt = { bind(...v: unknown[]): Stmt; run(): Promise<void>; first(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
const stmt = (sql: string, v: unknown[] = []): Stmt => ({
  bind: (...b) => stmt(sql, b),
  run: async () => void query(sql, v),
  first: async () => query(sql, v)[0] ?? null,
  all: async () => ({ results: query(sql, v) }),
});
const database = {
  prepare: (sql: string) => stmt(sql),
  batch: async (all: Stmt[]) => {
    for (const s of all) await s.run();
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name) } : undefined) }),
}));
vi.mock("@/lib/bot-check", () => ({ passesBotCheck: async () => true }));
vi.mock("@/lib/accounts", async (original) => {
  const real = await original<typeof import("@/lib/accounts")>();
  return {
    ...real,
    db: async () => database,
    requireAccount: async () => {
      if (!h.signedIn) throw new real.AccountError("Sign in first.", 401);
      return h.signedIn;
    },
    startSession: async (_res: unknown, account: { id: string }) => void h.sessions.push(account.id),
  };
});

// What the route writes to the log when SimpleWebAuthn refuses an answer.
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

// ---- Bytes ----

const utf8 = (s: string) => new TextEncoder().encode(s);
const join = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const b64url = (b: ArrayLike<number>) => btoa(String.fromCharCode(...Array.from(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sha256 = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));

// Enough CBOR for a passkey's public key and an attestation that carries no statement.
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function cbor(v: Cbor): number[] {
  const head = (major: number, n: number) => (n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return [...head(3, utf8(v).length), ...utf8(v)];
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
}

// WebCrypto signs ECDSA as r then s; authenticators send the same two numbers as ASN.1.
function der(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const body = b[i] & 0x80 ? [0, ...b.slice(i)] : [...b.slice(i)];
    return [0x02, body.length, ...body];
  };
  const both = [...int(raw.slice(0, raw.length / 2)), ...int(raw.slice(raw.length / 2))];
  return Uint8Array.from([0x30, both.length, ...both]);
}

// ---- The device ----

type Passkey = { id: Uint8Array; publicKey: number[]; counter: number; sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> };
const newId = () => crypto.getRandomValues(new Uint8Array(16));

/** ES256, what nearly every passkey uses. */
async function passkey(): Promise<Passkey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    id: newId(),
    publicKey: cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, unb64url(jwk.x!)], [-3, unb64url(jwk.y!)]])),
    counter: 0,
    sign: async (data) => der(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data))),
  };
}

/** An RSA key type the site never offers: RS384 (-258) or RSA with SHA-1 (-65535). */
async function rsaPasskey(alg: -258 | -65535): Promise<Passkey> {
  const hash = alg === -258 ? "SHA-384" : "SHA-1";
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    id: newId(),
    publicKey: cbor(new Map<number, Cbor>([[1, 3], [3, alg], [-1, unb64url(jwk.n!)], [-2, unb64url(jwk.e!)]])),
    counter: 0,
    sign: async (data) => new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, data)),
  };
}

/** ML-DSA-44: a public key of the right shape is all saving a passkey looks at. */
const mlDsaPasskey = (): Passkey => ({
  id: newId(),
  publicKey: cbor(new Map<number, Cbor>([[1, 7], [3, -48], [-1, new Uint8Array(1312)]])),
  counter: 0,
  sign: async () => new Uint8Array(),
});

type Twist = { origin?: string; rpId?: string; challenge?: string; crossOrigin?: boolean; topOrigin?: string; counter?: number; signer?: Passkey };

/** What the browser sends back after making a passkey. User presence only: the site doesn't insist on a PIN or fingerprint. */
async function made(k: Passkey, options: { challenge: string }, twist: Twist = {}) {
  const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: twist.origin ?? SITE, crossOrigin: false }));
  const authData = join(await sha256(utf8(twist.rpId ?? HOST)), [0x41], [0, 0, 0, 0], new Uint8Array(16), [0, k.id.length], k.id, k.publicKey);
  const attestationObject = cbor(new Map<string, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
  return {
    id: b64url(k.id),
    rawId: b64url(k.id),
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal", "hybrid"] },
  };
}

/** What the browser sends back when signing in with a passkey. */
async function signed(k: Passkey, options: { challenge: string }, twist: Twist = {}) {
  const clientDataJSON = utf8(
    JSON.stringify({ type: "webauthn.get", challenge: twist.challenge ?? options.challenge, origin: twist.origin ?? SITE, crossOrigin: twist.crossOrigin ?? false, ...(twist.topOrigin ? { topOrigin: twist.topOrigin } : {}) }),
  );
  const count = twist.counter ?? ++k.counter;
  const authData = join(await sha256(utf8(twist.rpId ?? HOST)), [0x01], [count >>> 24, (count >>> 16) & 255, (count >>> 8) & 255, count & 255]);
  const signature = await (twist.signer ?? k).sign(join(authData, await sha256(clientDataJSON)));
  return {
    id: b64url(k.id),
    rawId: b64url(k.id),
    type: "public-key",
    clientExtensionResults: {},
    response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
  };
}

// ---- The browser ----

async function post(payload: Record<string, unknown>) {
  const res = await POST(new NextRequest(`${SITE}/api/account/passkey`, { method: "POST", body: JSON.stringify(payload) }));
  // The stand-in for the browser's cookie holds the last challenge the route sent.
  const cookie = res.cookies.get(CHALLENGE_COOKIE);
  if (cookie?.value) h.jar.set(CHALLENGE_COOKIE, cookie.value);
  return { status: res.status, data: await res.json() };
}

const OK = { status: 200, data: { ok: true } };
const NOT_SAVED = { status: 400, data: { error: "The passkey couldn't be saved. Try again." } };
const NOT_SIGNED_IN = { status: 401, data: { error: "That passkey didn't work. Try again." } };
const algs = (options: { pubKeyCredParams: { alg: number }[] }) => options.pubKeyCredParams.map((p) => p.alg);

async function signUp(k: Passkey, email = "ahri@example.com") {
  const options = (await post({ step: "signup-options", email })).data;
  return post({ step: "signup", response: await made(k, options), label: "Windows PC" });
}

async function signIn(k: Passkey, twist: Twist = {}) {
  const options = (await post({ step: "signin-options" })).data;
  return post({ step: "signin", response: await signed(k, options, twist) });
}

beforeEach(() => {
  h.jar.clear();
  h.accounts.length = h.passkeys.length = h.sessions.length = 0;
  h.signedIn = null;
  warn.mockClear();
});

describe("passkeys", () => {
  it("creates an account with a passkey, then signs in with it", async () => {
    const options = (await post({ step: "signup-options", email: "Ahri@Example.com" })).data;
    expect(options.rp).toEqual({ name: "DeepARAM", id: HOST });
    expect(options.user.name).toBe("ahri@example.com");
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });

    const k = await passkey();
    expect(await post({ step: "signup", response: await made(k, options), label: "Windows PC" })).toEqual(OK);
    expect(h.accounts).toEqual([{ id: expect.any(String), email: "ahri@example.com" }]);
    expect(h.passkeys).toEqual([{ id: b64url(k.id), account: h.accounts[0].id, public_key: b64url(k.publicKey), counter: 0, transports: "internal,hybrid", label: "Windows PC" }]);
    expect(h.sessions).toEqual([h.accounts[0].id]);

    const ask = (await post({ step: "signin-options" })).data;
    expect(ask).toMatchObject({ rpId: HOST, userVerification: "preferred" });
    expect(await post({ step: "signin", response: await signed(k, ask) })).toEqual(OK);
    expect(h.passkeys[0].counter).toBe(1);
    expect(h.sessions).toEqual([h.accounts[0].id, h.accounts[0].id]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds a second passkey to a signed-in account, and names the first so it isn't made twice", async () => {
    const first = await passkey();
    await signUp(first);
    h.signedIn = { id: h.accounts[0].id, email: "ahri@example.com" };

    const options = (await post({ step: "add-options" })).data;
    expect(options.excludeCredentials).toEqual([{ id: b64url(first.id), type: "public-key", transports: ["internal", "hybrid"] }]);
    const second = await passkey();
    expect(await post({ step: "add", response: await made(second, options), label: "Android phone" })).toEqual(OK);
    expect(h.passkeys.map((p) => [p.id, p.account, p.label])).toEqual([
      [b64url(first.id), h.accounts[0].id, "Windows PC"],
      [b64url(second.id), h.accounts[0].id, "Android phone"],
    ]);
    expect(await signIn(second)).toEqual(OK);
  });

  it("offers EdDSA, ES256 and RS256, in that order, whatever else the server could check", async () => {
    expect(algs((await post({ step: "signup-options", email: "ahri@example.com" })).data)).toEqual([-8, -7, -257]);
    h.signedIn = { id: "an-account", email: null };
    expect(algs((await post({ step: "add-options" })).data)).toEqual([-8, -7, -257]);
  });

  it.each<[string, () => Passkey | Promise<Passkey>]>([
    ["ML-DSA-44", mlDsaPasskey],
    ["RS384", () => rsaPasskey(-258)],
    ["RSA with SHA-1", () => rsaPasskey(-65535)],
  ])("doesn't save a passkey whose key type wasn't offered (%s), new account or added", async (_type, make) => {
    const k = await make();
    expect(await signUp(k)).toEqual(NOT_SAVED);
    h.signedIn = { id: "an-account", email: null };
    const options = (await post({ step: "add-options" })).data;
    expect(await post({ step: "add", response: await made(k, options) })).toEqual(NOT_SAVED);
    expect([h.accounts, h.passkeys, h.sessions]).toEqual([[], [], []]);
  });

  it("still signs in with a passkey saved earlier whose key type new passkeys can't use (RS384)", async () => {
    const k = await rsaPasskey(-258);
    h.accounts.push({ id: "an-account", email: "ahri@example.com" });
    h.passkeys.push({ id: b64url(k.id), account: "an-account", public_key: b64url(k.publicKey), counter: 0, transports: "internal", label: "Windows PC" });
    expect(await signIn(k)).toEqual(OK);
    expect(h.passkeys[0].counter).toBe(1);
    expect(h.sessions).toEqual(["an-account"]);
  });

  it.each<[string, Twist]>([
    ["made for another site", { origin: "https://deeparam.test.example" }],
    ["made for another site's passkeys", { rpId: "example.com" }],
  ])("doesn't save a passkey %s", async (_why, twist) => {
    const options = (await post({ step: "signup-options", email: "ahri@example.com" })).data;
    expect(await post({ step: "signup", response: await made(await passkey(), options, twist) })).toEqual(NOT_SAVED);
    expect([h.accounts, h.passkeys, h.sessions]).toEqual([[], [], []]);
  });

  it.each<[string, (other: Passkey) => Twist]>([
    ["made for another site", () => ({ origin: "https://deeparam.test.example" })],
    ["made for another site's passkeys", () => ({ rpId: "example.com" })],
    ["answering a different challenge", () => ({ challenge: b64url(utf8("not the one that was sent")) })],
    ["signed by a different key", (other) => ({ signer: other })],
    ["that replays a counter already seen", () => ({ counter: 1 })],
    // SimpleWebAuthn 14 refuses these three because the browser reports a top-level page (topOrigin) at all.
    ["that reports a top-level page on another site", () => ({ crossOrigin: true, topOrigin: "https://example.com" })],
    ["that reports the site itself as the top-level page of a frame", () => ({ crossOrigin: true, topOrigin: SITE })],
    ["that reports a top-level page without being cross-origin", () => ({ topOrigin: "https://example.com" })],
  ])("refuses a sign-in %s", async (_why, twist) => {
    const k = await passkey();
    await signUp(k);
    expect(await signIn(k)).toEqual(OK); // the counter is 1 from here

    expect(await signIn(k, twist(await passkey()))).toEqual(NOT_SIGNED_IN);
    expect(h.passkeys[0].counter).toBe(1);
    expect(h.sessions).toHaveLength(2);

    k.counter = 1;
    expect(await signIn(k)).toEqual(OK); // the same passkey, used honestly, still works
  });

  it("logs a refusal by the error's name and code, and nothing from the answer", async () => {
    const elsewhere = { origin: "https://deeparam.test.example" };
    const k = await passkey();
    const options = (await post({ step: "signup-options", email: "ahri@example.com" })).data;
    await post({ step: "signup", response: await made(k, options, elsewhere) });
    await signUp(k);
    h.signedIn = { id: h.accounts[0].id, email: "ahri@example.com" };
    const more = (await post({ step: "add-options" })).data;
    await post({ step: "add", response: await made(await passkey(), more, elsewhere) });
    await signIn(k, elsewhere);
    expect(warn.mock.calls).toEqual([
      ["passkey signup refused", "SimpleWebAuthnError", "UNEXPECTED_ORIGIN"],
      ["passkey add refused", "SimpleWebAuthnError", "UNEXPECTED_ORIGIN"],
      ["passkey signin refused", "SimpleWebAuthnError", "UNEXPECTED_ORIGIN"],
    ]);

    // The library's message for a wrong challenge quotes both challenges; neither reaches the log.
    warn.mockClear();
    const ask = (await post({ step: "signin-options" })).data;
    const other = b64url(utf8("not the one that was sent"));
    expect(await post({ step: "signin", response: await signed(k, ask, { challenge: other }) })).toEqual(NOT_SIGNED_IN);
    expect(warn.mock.calls).toHaveLength(1);
    expect(warn.mock.calls[0]).toHaveLength(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ask.challenge);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(other);
  });
});
