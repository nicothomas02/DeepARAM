import { NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE } from "@/lib/account-cookies";
import { isSecure } from "@/lib/account-route";
import { AccountError, connectProvider, providerSignIn, startSession } from "@/lib/accounts";
import { exchange, isProvider, steamIdentity, PROVIDER_NAMES, providerEnabled } from "@/lib/oauth";

// GET (POST for Apple) /api/account/oauth/<provider>/callback → the provider sends the browser back
// here. "connect" adds it as a way into the signed-in account; "signin" signs in to the account it opens,
// or creates one. Either way the browser lands on /account.
export const dynamic = "force-dynamic";

async function finish(req: NextRequest, provider: string, q: URLSearchParams) {
  const back = new URL("/account", req.nextUrl.origin);
  const done = (error?: string) => {
    if (error) back.searchParams.set("signin-error", error);
    // 303 turns Apple's POST into a GET of /account.
    const res = NextResponse.redirect(back, 303);
    res.headers.set("Cache-Control", "no-store");
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/account/oauth", maxAge: 0 });
    return res;
  };
  if (!isProvider(provider) || !providerEnabled(provider)) return done("That sign-in isn't available yet.");
  const name = PROVIDER_NAMES[provider];
  if (q.get("error")) return done(`${name} sign-in was cancelled.`);
  const [p, state, nonce, mode] = (req.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  // Steam (OpenID 2.0) sends no code: its whole answer is checked with Steam instead.
  const code = provider === "steam" ? "-" : q.get("code");
  if (p !== provider || !state || !nonce || !code || q.get("state") !== state) return done("That sign-in link expired. Try again.");
  try {
    const origin = req.nextUrl.origin;
    const who = provider === "steam" ? await steamIdentity(origin, q, state) : await exchange(provider, { origin, code, nonce });
    const connectTo = mode?.startsWith("connect:") ? mode.slice(8) : null;
    if (connectTo) {
      await connectProvider(connectTo, provider, who);
      return done();
    }
    const account = await providerSignIn(provider, who);
    const res = done();
    await startSession(res, account, provider, isSecure(req));
    return res;
  } catch (err) {
    if (err instanceof AccountError) return done(err.message);
    console.error(`${provider} sign-in failed`, err);
    return done(`${name} sign-in didn't work. Try again.`);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return finish(req, (await params).provider, req.nextUrl.searchParams);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const form = await req.formData().catch(() => null);
  const q = new URLSearchParams();
  for (const k of ["code", "state", "error"]) {
    const v = form?.get(k);
    if (typeof v === "string") q.set(k, v.slice(0, 2000));
  }
  return finish(req, (await params).provider, q);
}
