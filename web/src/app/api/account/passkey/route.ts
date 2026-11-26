import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { CHALLENGE_COOKIE, CHALLENGE_PATH } from "@/lib/account-cookies";
import { body, clientIp, handle, isSecure, json } from "@/lib/account-route";
import { sha256, type DB } from "@/lib/account-session";
import { AccountError, cleanEmail, db, requireAccount, startSession, waysIn } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";

// POST /api/account/passkey {step, ...}
//   "add-options" / "add" {response, label}: saves a passkey for the signed-in account
//   "signup-options" {email, check} / "signup" {response, label}: creates a new account whose way in is this passkey
//   "signin-options" / "signin" {response}: signs in with any saved passkey (the browser offers them)
//   "remove" {id}: deletes one of the signed-in account's passkeys
// Each "-options" step keeps its challenge in the accounts database for five minutes (table passkey_challenges) and
// gives the browser an HttpOnly cookie that only names it. The step that finishes takes the challenge back once,
// before it checks the answer, and only if it is the kind of step that asked (for "add", the same account too).
export const dynamic = "force-dynamic";

const where = (req: NextRequest) => ({ rpID: req.nextUrl.hostname, origin: req.nextUrl.origin });

// Key types (COSE numbers) for new passkeys: EdDSA, ES256, RS256. The same list is offered when a passkey is
// made and required when it is saved. It is written out so a SimpleWebAuthn upgrade can't change it unnoticed:
// left to its default, version 14 adds ML-DSA-44 in front wherever the server it runs on can check that
// signature. Signing in checks the saved key itself and doesn't use this list.
const OFFERED_ALGS = [-8, -7, -257];

type Kind = "add" | "signup" | "signin";

// When SimpleWebAuthn refuses an answer, the log gets the error's name and code and nothing else: its message
// can quote the challenge and the origin, and the answer itself is never logged.
const refused = (step: Kind) => (err: unknown) => {
  const { name, code } = (err ?? {}) as { name?: unknown; code?: unknown };
  const short = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, 60) : "");
  console.warn(`passkey ${step} refused`, short(name), short(code));
  return null;
};

/** One of SimpleWebAuthn's checks: its result, or null when it refuses, whether it throws or answers "not verified". */
async function checked<T extends { verified: boolean }>(step: Kind, check: Promise<T>): Promise<T | null> {
  const v = await check.catch(refused(step));
  return v && !v.verified ? refused(step)({ name: "NotVerified" }) : v;
}

const CHALLENGE_MS = 300_000;

/**
 * Answers an "-options" step. The challenge waits in the database, with who asked (account, for "add") or the
 * account a sign-up will make (newId and email); the cookie carries only a random handle, stored as its SHA-256.
 * Challenges past their five minutes are removed whenever a new one is written.
 */
async function withChallenge(req: NextRequest, d: DB, kind: Kind, options: { challenge: string }, who: { account?: string; newId?: string; email?: string } = {}) {
  const handle = toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await d.batch([
    d.prepare("DELETE FROM passkey_challenges WHERE expires < ?").bind(now),
    d
      .prepare("INSERT INTO passkey_challenges (id, kind, challenge, account, new_id, email, expires) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256(handle), kind, options.challenge, who.account ?? null, who.newId ?? null, who.email ?? null, now + CHALLENGE_MS),
  ]);
  const res = json(options);
  res.cookies.set(CHALLENGE_COOKIE, handle, { path: CHALLENGE_PATH, maxAge: CHALLENGE_MS / 1000, httpOnly: true, sameSite: "strict", secure: isSecure(req) });
  return res;
}

/**
 * Takes back the challenge the browser's cookie names, so it can never be answered twice: it is gone from the
 * database before the answer is checked. It has to be unexpired, asked for by this kind of step and, for "add",
 * by this account. Anything else gets the answer a missing cookie gets.
 */
async function takeChallenge(d: DB, kind: Kind, account: string | null = null) {
  const handle = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  const row =
    handle && /^[A-Za-z0-9_-]{43}$/.test(handle)
      ? await d
          .prepare("DELETE FROM passkey_challenges WHERE id = ? AND kind = ? AND account IS ? AND expires > ? RETURNING challenge, new_id, email")
          .bind(await sha256(handle), kind, account, Date.now())
          .first<{ challenge: string; new_id: string | null; email: string | null }>()
      : null;
  if (!row) throw new AccountError("That took too long. Try again.");
  return row;
}

// A cookie is only dropped under the path it was set with.
const CHALLENGE_GONE = { name: CHALLENGE_COOKIE, path: CHALLENGE_PATH };

const labelOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : "Passkey");
const transports = (v: string | null) => (v ? v.split(",") : undefined);
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toB64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const POST = handle(async (req) => {
  const b = await body(req);
  const { rpID, origin } = where(req);
  const d = await db();

  if (b.step === "add-options") {
    const a = await requireAccount();
    const existing = await d.prepare("SELECT id, transports FROM passkeys WHERE account = ?").bind(a.id).all<{ id: string; transports: string | null }>();
    if (existing.results.length >= 10) throw new AccountError("You already have 10 passkeys. Remove one first.");
    const options = await generateRegistrationOptions({
      rpName: "DeepARAM",
      rpID,
      userName: a.email ?? "DeepARAM account",
      userID: new TextEncoder().encode(a.id),
      attestationType: "none",
      excludeCredentials: existing.results.map((k) => ({ id: k.id, transports: transports(k.transports) })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      supportedAlgorithmIDs: OFFERED_ALGS,
    });
    return withChallenge(req, d, "add", options, { account: a.id });
  }

  if (b.step === "add") {
    const a = await requireAccount();
    const { challenge } = await takeChallenge(d, "add", a.id);
    const v = await checked(
      "add",
      verifyRegistrationResponse({
        response: b.response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        supportedAlgorithmIDs: OFFERED_ALGS,
      }),
    );
    if (!v?.verified) throw new AccountError("The passkey couldn't be saved. Try again.");
    const c = v.registrationInfo.credential;
    const label = labelOf(b.label);
    await d
      .prepare("INSERT INTO passkeys (id, account, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
      .bind(c.id, a.id, toB64url(c.publicKey), c.counter, c.transports?.join(",") ?? null, label)
      .run();
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_GONE);
    return res;
  }

  if (b.step === "signup-options") {
    if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 403);
    const email = cleanEmail(b.email);
    if ( (await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first())) throw new AccountError("There's already an account with that email. Sign in instead.", 409);
    // The account is only made once the passkey is saved; until then its id and email wait with the challenge.
    const id = crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: "DeepARAM",
      rpID,
      userName: email,
      userID: new TextEncoder().encode(id),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      supportedAlgorithmIDs: OFFERED_ALGS,
    });
    return withChallenge(req, d, "signup", options, { newId: id, email });
  }

  if (b.step === "signup") {
    const { challenge, new_id: id, email: mail } = await takeChallenge(d, "signup");
    if (!id || !mail) throw new AccountError("That took too long. Try again.");
    const v = await checked(
      "signup",
      verifyRegistrationResponse({
        response: b.response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        supportedAlgorithmIDs: OFFERED_ALGS,
      }),
    );
    if (!v?.verified) throw new AccountError("The passkey couldn't be saved. Try again.");
    const c = v.registrationInfo.credential;
    if ((await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(mail).first())) throw new AccountError("There's already an account with that email. Sign in instead.", 409);
    await d.batch([
      d.prepare("INSERT INTO accounts (id, email, pass, created_at) VALUES (?, ?, NULL, datetime('now'))").bind(id, mail),
      d
        .prepare("INSERT INTO passkeys (id, account, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
        .bind(c.id, id, toB64url(c.publicKey), c.counter, c.transports?.join(",") ?? null, labelOf(b.label)),
    ]);
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_GONE);
    await startSession(res, { id }, "passkey", isSecure(req));
    return res;
  }

  if (b.step === "signin-options") {
    return withChallenge(req, d, "signin", await generateAuthenticationOptions({ rpID, userVerification: "preferred" }));
  }

  if (b.step === "signin") {
    const response = b.response as AuthenticationResponseJSON;
    const key = typeof response?.id === "string"
      ? await d.prepare("SELECT p.*, a.owner FROM passkeys p JOIN accounts a ON a.id = p.account WHERE p.id = ?").bind(response.id).first<{ id: string; account: string; public_key: string; counter: number; transports: string | null; owner: number }>()
      : null;
    if (!key) throw new AccountError("That passkey isn't saved on any account here.", 401);
    const { challenge } = await takeChallenge(d, "signin");
    const v = await checked(
      "signin",
      verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: { id: key.id, publicKey: fromB64url(key.public_key), counter: key.counter, transports: transports(key.transports) },
        requireUserVerification: false,
      }),
    );
    if (!v?.verified) throw new AccountError("That passkey didn't work. Try again.", 401);
    await d.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(v.authenticationInfo.newCounter, key.id).run();
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_GONE);
    await startSession(res, { id: key.account }, "passkey", isSecure(req));
    return res;
  }

  if (b.step === "remove") {
    const a = await requireAccount();
    if ((await waysIn(a.id, "passkey", String(b.id ?? ""))) === 0) throw new AccountError("This passkey is the only way into your account. Add another way to sign in first.", 409);
    await d.prepare("DELETE FROM passkeys WHERE id = ? AND account = ?").bind(String(b.id ?? ""), a.id).run();
    return json({ ok: true });
  }

  throw new AccountError("Bad request");
});
