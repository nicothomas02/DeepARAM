import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { CHALLENGE_COOKIE } from "@/lib/account-cookies";
import { body, clientIp, handle, isSecure, json } from "@/lib/account-route";
import { AccountError, cleanEmail, db, requireAccount, startSession, waysIn } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";

// POST /api/account/passkey {step, ...}
//   "add-options" / "add" {response, label}: saves a passkey for the signed-in account
//   "signup-options" {email, check} / "signup" {response, label}: creates a new account whose way in is this passkey
//   "signin-options" / "signin" {response}: signs in with any saved passkey (the browser offers them)
//   "remove" {id}: deletes one of the signed-in account's passkeys
// The challenge each "-options" step sends is kept in a short-lived HttpOnly cookie and used once.
export const dynamic = "force-dynamic";

const where = (req: NextRequest) => ({ rpID: req.nextUrl.hostname, origin: req.nextUrl.origin });

async function withChallenge(req: NextRequest, options: { challenge: string }, extra = "") {
  const res = json(options);
  res.cookies.set(CHALLENGE_COOKIE, options.challenge + extra, { path: "/api/account/passkey", maxAge: 300, httpOnly: true, sameSite: "strict", secure: isSecure(req) });
  return res;
}

async function takeChallenge(): Promise<string> {
  const c = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!c) throw new AccountError("That took too long. Try again.");
  return c;
}

const labelOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : "Passkey");
const transports = (v: string | null) => (v ? (v.split(",") as AuthenticatorTransportFuture[]) : undefined);
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
    });
    return withChallenge(req, options);
  }

  if (b.step === "add") {
    const a = await requireAccount();
    const v = await verifyRegistrationResponse({
      response: b.response as RegistrationResponseJSON,
      expectedChallenge: await takeChallenge(),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw new AccountError("The passkey couldn't be saved. Try again.");
    const c = v.registrationInfo.credential;
    const label = labelOf(b.label);
    await d
      .prepare("INSERT INTO passkeys (id, account, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
      .bind(c.id, a.id, toB64url(c.publicKey), c.counter, c.transports?.join(",") ?? null, label)
      .run();
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_COOKIE);
    return res;
  }

  if (b.step === "signup-options") {
    if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 403);
    const email = cleanEmail(b.email);
    if ( (await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first())) throw new AccountError("There's already an account with that email. Sign in instead.", 409);
    // The account is only made once the passkey is saved; until then its id and email wait in the challenge cookie.
    const id = crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: "DeepARAM",
      rpID,
      userName: email,
      userID: new TextEncoder().encode(id),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    return withChallenge(req, options, `~${id}~${encodeURIComponent(email)}`);
  }

  if (b.step === "signup") {
    const [challenge, id, email] = (await takeChallenge()).split("~");
    if (!id || !email) throw new AccountError("That took too long. Try again.");
    const v = await verifyRegistrationResponse({
      response: b.response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw new AccountError("The passkey couldn't be saved. Try again.");
    const c = v.registrationInfo.credential;
    const mail = decodeURIComponent(email);
    if ((await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(mail).first())) throw new AccountError("There's already an account with that email. Sign in instead.", 409);
    await d.batch([
      d.prepare("INSERT INTO accounts (id, email, pass, created_at) VALUES (?, ?, NULL, datetime('now'))").bind(id, mail),
      d
        .prepare("INSERT INTO passkeys (id, account, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
        .bind(c.id, id, toB64url(c.publicKey), c.counter, c.transports?.join(",") ?? null, labelOf(b.label)),
    ]);
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_COOKIE);
    await startSession(res, { id }, "passkey", isSecure(req));
    return res;
  }

  if (b.step === "signin-options") {
    return withChallenge(req, await generateAuthenticationOptions({ rpID, userVerification: "preferred" }));
  }

  if (b.step === "signin") {
    const response = b.response as AuthenticationResponseJSON;
    const key = typeof response?.id === "string"
      ? await d.prepare("SELECT p.*, a.owner FROM passkeys p JOIN accounts a ON a.id = p.account WHERE p.id = ?").bind(response.id).first<{ id: string; account: string; public_key: string; counter: number; transports: string | null; owner: number }>()
      : null;
    if (!key) throw new AccountError("That passkey isn't saved on any account here.", 401);
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: await takeChallenge(),
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: key.id, publicKey: fromB64url(key.public_key), counter: key.counter, transports: transports(key.transports) },
      requireUserVerification: false,
    }).catch(() => null);
    if (!v?.verified) throw new AccountError("That passkey didn't work. Try again.", 401);
    await d.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(v.authenticationInfo.newCounter, key.id).run();
    const res = json({ ok: true });
    res.cookies.delete(CHALLENGE_COOKIE);
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
