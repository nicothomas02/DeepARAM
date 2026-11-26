import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { CHALLENGE_COOKIE } from "@/lib/account-cookies";
import { createAccount, db, deleteAccount, startSession } from "@/lib/accounts";
import { POST } from "@/app/api/account/passkey/route";
import { POST as SIGN_OUT } from "@/app/api/account/signout/route";

// The passkey route (api/account/passkey) run against SimpleWebAuthn itself and the site's own account code.
// The "device" is a real key made here that builds and signs its answers the way an authenticator does, so every
// check the library makes (challenge, site, signature, counter, key type) is the real one. The database is a
// real SQLite one holding the site's own tables, behind the few methods the site uses of Cloudflare D1, and the
// browser's cookies are kept per name and path the way a browser keeps them.

const HOST = "deeparam.test";
const SITE = `https://${HOST}`;
const PASSKEY = "/api/account/passkey";

const h = vi.hoisted(() => {
  // Newer servers can check ML-DSA-44 signatures, and on those SimpleWebAuthn 14's own defaults offer and accept
  // that key type as well. Every test here runs as if on such a server, where the defaults and the site differ.
  // Set here so it is in place before SimpleWebAuthn is loaded.
  Object.defineProperty(SubtleCrypto, "supports", { configurable: true, value: () => true });
  return { d1: null as unknown, path: "/" };
});

// ---- The database ----

type Sqlite = { exec(sql: string): void; prepare(sql: string): { run(...v: unknown[]): unknown; get(...v: unknown[]): unknown; all(...v: unknown[]): unknown[] } };
const { DatabaseSync } = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Sqlite } }).getBuiltinModule("node:sqlite");
const sqlite = new DatabaseSync(":memory:");
const plain = (v: unknown[]) => v.map((x) => (typeof x === "boolean" ? Number(x) : x));
type Stmt = { sql: string; v: unknown[]; bind(...v: unknown[]): Stmt; run(): Promise<unknown>; first(): Promise<unknown>; all(): Promise<{ results: unknown[] }> };
const stmt = (sql: string, v: unknown[] = []): Stmt => ({
  sql,
  v,
  bind: (...b) => stmt(sql, plain(b)),
  run: async () => (sqlite.prepare(sql).run(...v), { success: true }),
  first: async () => sqlite.prepare(sql).get(...v) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...v) }),
});
// A batch is one transaction, as on D1.
h.d1 = {
  prepare: (sql: string) => stmt(sql),
  batch: async (all: Stmt[]) => {
    sqlite.exec("BEGIN");
    try {
      for (const s of all) sqlite.prepare(s.sql).run(...s.v);
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: { PROFILES: h.d1 } }) }));
vi.mock("@/lib/bot-check", () => ({ passesBotCheck: async () => true }));

const rows = <T = Record<string, unknown>>(sql: string, ...v: unknown[]) => sqlite.prepare(sql).all(...v).map((r) => ({ ...(r as object) })) as T[];
type Row = { id: string; account: string; public_key: string; counter: number; transports: string | null; label: string };
const saved = {
  get accounts() {
    return rows<{ id: string; email: string }>("SELECT id, email FROM accounts ORDER BY rowid");
  },
  get passkeys() {
    return rows<Row>("SELECT id, account, public_key, counter, transports, label FROM passkeys ORDER BY rowid");
  },
  /** The account of every session ever started, oldest first. */
  get sessions() {
    return rows<{ account: string }>("SELECT account FROM sessions ORDER BY rowid").map((s) => s.account);
  },
};
const everything = () => ({ accounts: saved.accounts, passkeys: saved.passkeys, sessions: saved.sessions });
const NOTHING = { accounts: [], passkeys: [], sessions: [] };

// ---- The browser's cookies ----

// One cookie per name and path. A Set-Cookie that has expired drops the cookie of that name under that path and
// no other, and a cookie goes only to addresses under its path.
type Cookie = { name: string; value: string; path: string; until: number };
const jar: Cookie[] = [];
function keep(setCookie: string) {
  const [pair, ...attrs] = setCookie.split(";").map((p) => p.trim());
  const name = pair.slice(0, pair.indexOf("="));
  const attr = (k: string) => attrs.find((a) => a.toLowerCase().startsWith(`${k}=`))?.slice(k.length + 1);
  const path = attr("path") ?? "/";
  const until = attr("max-age") !== undefined ? Date.now() + Number(attr("max-age")) * 1000 : attr("expires") ? Date.parse(attr("expires")!) : Infinity;
  const old = jar.findIndex((c) => c.name === name && c.path === path);
  if (old >= 0) jar.splice(old, 1);
  if (until > Date.now()) jar.push({ name, value: decodeURIComponent(pair.slice(name.length + 1)), path, until });
}
const sentTo = (path: string) =>
  jar.filter((c) => c.until > Date.now() && (path === c.path || path.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`))).sort((a, b) => b.path.length - a.path.length);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = sentTo(h.path).find((x) => x.name === name);
      return c && { name, value: c.value };
    },
  }),
}));

/** The challenge cookie as the browser would send it to the passkey route right now, if it would. */
const challengeCookie = () => sentTo(PASSKEY).find((c) => c.name === CHALLENGE_COOKIE)?.value;
/** A client that sets the challenge cookie itself, or (with nothing) leaves it out. */
function putChallengeCookie(value?: string) {
  for (let i = jar.length - 1; i >= 0; i--) if (jar[i].name === CHALLENGE_COOKIE) jar.splice(i, 1);
  if (value !== undefined) jar.push({ name: CHALLENGE_COOKIE, value, path: PASSKEY, until: Infinity });
}

async function send(route: (req: NextRequest) => Promise<NextResponse>, path: string, payload: Record<string, unknown> = {}) {
  h.path = path;
  const res = await route(new NextRequest(`${SITE}${path}`, { method: "POST", body: JSON.stringify(payload) }));
  res.headers.getSetCookie().forEach(keep);
  return { status: res.status, data: await res.json() };
}
const post = (payload: Record<string, unknown>) => send(POST, PASSKEY, payload);

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

// ---- People ----

const OK = { status: 200, data: { ok: true } };
const NOT_SAVED = { status: 400, data: { error: "The passkey couldn't be saved. Try again." } };
const NOT_SIGNED_IN = { status: 401, data: { error: "That passkey didn't work. Try again." } };
const TOO_LATE = { status: 400, data: { error: "That took too long. Try again." } };
const algs = (options: { pubKeyCredParams: { alg: number }[] }) => options.pubKeyCredParams.map((p) => p.alg);

async function signUp(k: Passkey, email = "ahri@example.com") {
  const options = (await post({ step: "signup-options", email })).data;
  return post({ step: "signup", response: await made(k, options), label: "Windows PC" });
}

async function signIn(k: Passkey, twist: Twist = {}) {
  const options = (await post({ step: "signin-options" })).data;
  return post({ step: "signin", response: await signed(k, options, twist) });
}

/** A new account with a password and no passkey, signed in on this browser: the site's own sign-up, without its route. */
async function account(email: string) {
  const { id } = await createAccount(email, "a long enough password");
  const res = NextResponse.json({});
  await startSession(res, { id }, "password", true);
  res.headers.getSetCookie().forEach(keep);
  return id;
}

// The three things a passkey challenge is for, so one test can go through each: ready() gets a browser to where
// it may ask, ask() is the "-options" step, answer() the step that finishes.
type Kind = "add" | "signup" | "signin";
const KINDS: Kind[] = ["add", "signup", "signin"];
async function ready(kind: Kind) {
  const k = await passkey();
  if (kind === "add") await account("ahri@example.com");
  if (kind === "signin") await signUp(k);
  return k;
}
const ask = async (kind: Kind, email = "ahri@example.com") => (await post(kind === "signup" ? { step: "signup-options", email } : { step: `${kind}-options` })).data;
const answer = async (kind: Kind, k: Passkey, options: { challenge: string }, twist: Twist = {}) =>
  post({ step: kind, response: kind === "signin" ? await signed(k, options, twist) : await made(k, options, twist), label: "Windows PC" });

beforeEach(async () => {
  jar.length = 0;
  await db(); // the site makes its own tables the first time the database is used
  for (const { name } of rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")) sqlite.exec(`DELETE FROM ${name}`);
  warn.mockClear();
});
afterEach(() => void vi.useRealTimers());

describe("passkeys", () => {
  it("creates an account with a passkey, then signs in with it", async () => {
    const options = (await post({ step: "signup-options", email: "Ahri@Example.com" })).data;
    expect(options.rp).toEqual({ name: "DeepARAM", id: HOST });
    expect(options.user.name).toBe("ahri@example.com");
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", requireResidentKey: true, userVerification: "preferred" });

    const k = await passkey();
    expect(await post({ step: "signup", response: await made(k, options), label: "Windows PC" })).toEqual(OK);
    expect(saved.accounts).toEqual([{ id: expect.any(String), email: "ahri@example.com" }]);
    expect(saved.passkeys).toEqual([{ id: b64url(k.id), account: saved.accounts[0].id, public_key: b64url(k.publicKey), counter: 0, transports: "internal,hybrid", label: "Windows PC" }]);
    expect(saved.sessions).toEqual([saved.accounts[0].id]);

    const ask = (await post({ step: "signin-options" })).data;
    expect(ask).toMatchObject({ rpId: HOST, userVerification: "preferred" });
    expect(await post({ step: "signin", response: await signed(k, ask) })).toEqual(OK);
    expect(saved.passkeys[0].counter).toBe(1);
    expect(saved.sessions).toEqual([saved.accounts[0].id, saved.accounts[0].id]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds a second passkey to a signed-in account, and names the first so it isn't made twice", async () => {
    const first = await passkey();
    await signUp(first); // which leaves this browser signed in

    const options = (await post({ step: "add-options" })).data;
    expect(options.excludeCredentials).toEqual([{ id: b64url(first.id), type: "public-key", transports: ["internal", "hybrid"] }]);
    const second = await passkey();
    expect(await post({ step: "add", response: await made(second, options), label: "Android phone" })).toEqual(OK);
    expect(saved.passkeys.map((p) => [p.id, p.account, p.label])).toEqual([
      [b64url(first.id), saved.accounts[0].id, "Windows PC"],
      [b64url(second.id), saved.accounts[0].id, "Android phone"],
    ]);
    expect(await signIn(second)).toEqual(OK);
  });

  it("offers EdDSA, ES256 and RS256, in that order, whatever else the server could check", async () => {
    expect(algs((await post({ step: "signup-options", email: "ahri@example.com" })).data)).toEqual([-8, -7, -257]);
    await account("lux@example.com");
    expect(algs((await post({ step: "add-options" })).data)).toEqual([-8, -7, -257]);
  });

  it.each<[string, () => Passkey | Promise<Passkey>]>([
    ["ML-DSA-44", mlDsaPasskey],
    ["RS384", () => rsaPasskey(-258)],
    ["RSA with SHA-1", () => rsaPasskey(-65535)],
  ])("doesn't save a passkey whose key type wasn't offered (%s), new account or added", async (_type, make) => {
    const k = await make();
    expect(await signUp(k)).toEqual(NOT_SAVED);
    expect(everything()).toEqual(NOTHING);

    await account("lux@example.com");
    const before = everything();
    const options = (await post({ step: "add-options" })).data;
    expect(await post({ step: "add", response: await made(k, options) })).toEqual(NOT_SAVED);
    expect(everything()).toEqual(before);
  });

  it("still signs in with a passkey saved earlier whose key type new passkeys can't use (RS384)", async () => {
    const k = await rsaPasskey(-258);
    sqlite.prepare("INSERT INTO accounts (id, email, pass, created_at) VALUES ('an-account', 'ahri@example.com', NULL, datetime('now'))").run();
    sqlite
      .prepare("INSERT INTO passkeys (id, account, public_key, counter, transports, label, created_at) VALUES (?, 'an-account', ?, 0, 'internal', 'Windows PC', datetime('now'))")
      .run(b64url(k.id), b64url(k.publicKey));
    expect(await signIn(k)).toEqual(OK);
    expect(saved.passkeys[0].counter).toBe(1);
    expect(saved.sessions).toEqual(["an-account"]);
  });

  it.each<[string, Twist]>([
    ["made for another site", { origin: "https://deeparam.test.example" }],
    ["made for another site's passkeys", { rpId: "example.com" }],
  ])("doesn't save a passkey %s", async (_why, twist) => {
    const options = (await post({ step: "signup-options", email: "ahri@example.com" })).data;
    expect(await post({ step: "signup", response: await made(await passkey(), options, twist) })).toEqual(NOT_SAVED);
    expect(everything()).toEqual(NOTHING);
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
    expect(saved.passkeys[0].counter).toBe(1);
    expect(saved.sessions).toHaveLength(2);

    k.counter = 1;
    expect(await signIn(k)).toEqual(OK); // the same passkey, used honestly, still works
  });

  it("logs a refusal by the error's name and code, and nothing from the answer", async () => {
    const elsewhere = { origin: "https://deeparam.test.example" };
    const k = await passkey();
    const options = (await post({ step: "signup-options", email: "ahri@example.com" })).data;
    await post({ step: "signup", response: await made(k, options, elsewhere) });
    await signUp(k);
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

  it("also logs an answer the library reports as not verified without an error", async () => {
    const k = await passkey();
    await signUp(k);
    expect(await signIn(k, { signer: await passkey() })).toEqual(NOT_SIGNED_IN);
    expect(warn.mock.calls).toEqual([["passkey signin refused", "NotVerified", ""]]);
  });
});

describe("passkey challenges", () => {
  it.each(KINDS)("refuses to finish %s with a challenge the server never gave out", async (kind) => {
    const k = await ready(kind);
    const own = { challenge: b64url(crypto.getRandomValues(new Uint8Array(32))) };
    const before = everything();
    // The cookie holding that challenge, alone and in the form a pending sign-up once travelled in.
    for (const cookie of [own.challenge, `${own.challenge}~${crypto.randomUUID()}~${encodeURIComponent("lux@example.com")}`]) {
      putChallengeCookie(cookie);
      expect(await answer(kind, k, own)).toEqual(TOO_LATE);
      expect(everything()).toEqual(before);
    }
  });

  it("accepts a sign-in answer once, even from a passkey whose counter stays at 0", async () => {
    const k = await ready("signin");
    const options = await ask("signin");
    const cookie = challengeCookie();
    const response = await signed(k, options, { counter: 0 });
    expect(await post({ step: "signin", response })).toEqual(OK);
    expect(saved.passkeys[0].counter).toBe(0);

    putChallengeCookie(cookie); // the same answer again, with the cookie it came with
    const before = everything();
    expect(await post({ step: "signin", response })).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);

    expect(await signIn(k, { counter: 0 })).toEqual(OK); // a new challenge, and the passkey signs in again
  });

  it.each(KINDS)("lets only one of two identical %s answers through when both are under way at once", async (kind) => {
    const k = await ready(kind);
    const options = await ask(kind);
    const before = everything();
    const payload = { step: kind, response: kind === "signin" ? await signed(k, options) : await made(k, options), label: "Windows PC" };
    // The second starts one turn of the event loop behind the first and overtakes nothing: both have read the
    // cookie before either is done. (Started in the very same turn, vitest hands one of them the real
    // next/headers, which the site imports only when it needs it.)
    const first = post(payload);
    await new Promise((soon) => setTimeout(soon, 0));
    const both = await Promise.all([first, post(payload)]);
    expect(both.filter((r) => r.status === 200)).toEqual([OK]);
    expect(both.filter((r) => r.status !== 200)).toEqual([TOO_LATE]);
    const after = everything();
    expect([after.accounts.length - before.accounts.length, after.passkeys.length - before.passkeys.length, after.sessions.length - before.sessions.length]).toEqual(
      { add: [0, 1, 0], signup: [1, 1, 1], signin: [0, 0, 1] }[kind],
    );
  });

  it.each(KINDS)("takes back %s's challenge even when the answer is refused", async (kind) => {
    const k = await ready(kind);
    const options = await ask(kind);
    const cookie = challengeCookie();
    expect((await answer(kind, k, options, { origin: "https://deeparam.test.example" })).status).toBe(kind === "signin" ? 401 : 400);

    putChallengeCookie(cookie); // a good answer to the same challenge, after the bad one
    const before = everything();
    expect(await answer(kind, k, options)).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);
  });

  it.each(KINDS)("refuses to finish %s after the challenge's five minutes", async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const k = await ready(kind);
    const options = await ask(kind);
    const cookie = challengeCookie();
    vi.setSystemTime(Date.now() + 300_001);
    expect(challengeCookie()).toBeUndefined(); // a browser has dropped it by now

    putChallengeCookie(cookie); // a client that kept it
    const before = everything();
    expect(await answer(kind, k, options)).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);
  });

  it.each<[Kind, Kind]>([
    ["signin", "add"],
    ["add", "signin"],
    ["signup", "signin"],
  ])("refuses a challenge asked for %s as the challenge for %s", async (asked, finished) => {
    const k = await ready(finished);
    const options = await ask(asked, "lux@example.com");
    expect(options.challenge).toEqual(expect.any(String));
    const before = everything();
    expect(await answer(finished, k, options)).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);
  });

  it("makes the account a sign-up asked for, with the server's id and the cleaned email, whatever the cookie says", async () => {
    const options = (await post({ step: "signup-options", email: "  Ahri@Example.com " })).data;
    const cookie = challengeCookie()!;
    const k = await passkey();

    // The cookie with an id and an email added, the form a pending sign-up once travelled in.
    putChallengeCookie(`${cookie.split("~")[0]}~chosen-id~${encodeURIComponent("Someone Else <b>")}`);
    expect(await post({ step: "signup", response: await made(k, options) })).toEqual(TOO_LATE);
    expect(everything()).toEqual(NOTHING);

    putChallengeCookie(cookie);
    expect(await post({ step: "signup", response: await made(k, options) })).toEqual(OK);
    const id = new TextDecoder().decode(unb64url(options.user.id));
    expect(saved.accounts).toEqual([{ id, email: "ahri@example.com" }]);
    expect(saved.passkeys.map((p) => p.account)).toEqual([id]);
    expect(saved.sessions).toEqual([id]);
  });

  it("only lets the account that asked for a challenge add a passkey with it", async () => {
    await account("ahri@example.com");
    const options = await ask("add");
    await account("lux@example.com"); // the same browser, now signed in as someone else
    expect(challengeCookie()).toBeDefined();

    const before = everything();
    expect(await answer("add", await passkey(), options)).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);
  });

  it.each(KINDS)("has the browser drop the challenge cookie once %s is finished", async (kind) => {
    const k = await ready(kind);
    const options = await ask(kind);
    expect(challengeCookie()).toBeDefined();
    expect(await answer(kind, k, options)).toEqual(OK);
    expect(challengeCookie()).toBeUndefined();
  });

  it("has the browser drop an unanswered challenge cookie on sign-out", async () => {
    await account("ahri@example.com");
    await ask("add");
    expect(challengeCookie()).toBeDefined();
    expect(await send(SIGN_OUT, "/api/account/signout")).toEqual(OK);
    expect(challengeCookie()).toBeUndefined();
    expect((await post({ step: "add-options" })).status).toBe(401); // and the browser is signed out
  });

  it.each(KINDS)("gives every %s request its own challenge and a cookie that doesn't carry it", async (kind) => {
    await ready(kind);
    const [one, cookieOne] = [await ask(kind), challengeCookie()!];
    const [two, cookieTwo] = [await ask(kind), challengeCookie()!];
    expect(one.challenge).not.toBe(two.challenge);
    expect(cookieOne).not.toBe(cookieTwo);
    for (const cookie of [cookieOne, cookieTwo]) {
      expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie).not.toContain(one.challenge);
      expect(cookie).not.toContain(two.challenge);
    }
    // The database knows the cookie only by its hash.
    const kept = rows<{ id: string; kind: string; challenge: string }>("SELECT id, kind, challenge FROM passkey_challenges ORDER BY rowid");
    expect(kept.map((r) => [r.kind, r.challenge])).toEqual([[kind, one.challenge], [kind, two.challenge]]);
    expect(kept.map((r) => r.id)).not.toContain(cookieOne);
    expect(kept.map((r) => r.id)).not.toContain(cookieTwo);
  });

  it.each(KINDS)("answers that it took too long when %s is finished without the cookie", async (kind) => {
    const k = await ready(kind);
    const options = await ask(kind);
    putChallengeCookie();
    const before = everything();
    expect(await answer(kind, k, options)).toEqual(TOO_LATE);
    expect(everything()).toEqual(before);
  });

  it("removes an account's waiting challenge when the account is deleted", async () => {
    const id = await account("ahri@example.com");
    await ask("add");
    await ask("signin");
    expect(rows("SELECT kind, account FROM passkey_challenges ORDER BY rowid")).toEqual([{ kind: "add", account: id }, { kind: "signin", account: null }]);
    await deleteAccount(id);
    expect(rows("SELECT kind, account FROM passkey_challenges")).toEqual([{ kind: "signin", account: null }]);
  });

  it("clears out challenges past their five minutes whenever a new one is kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 5; i++) await ask("signin");
    expect(rows("SELECT id FROM passkey_challenges")).toHaveLength(5);
    vi.setSystemTime(Date.now() + 300_001);
    await ask("signin");
    expect(rows("SELECT id FROM passkey_challenges")).toHaveLength(1);
  });
});
