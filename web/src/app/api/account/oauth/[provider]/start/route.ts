import { NextRequest, NextResponse } from "next/server";
import { OAUTH_COOKIE } from "@/lib/account-cookies";
import { isSecure } from "@/lib/account-route";
import { currentAccount } from "@/lib/accounts";
import { authorizeUrl, isProvider, PROVIDER_NAMES, providerEnabled } from "@/lib/oauth";

// GET /api/account/oauth/<provider>/start?mode=signin|connect → sends the browser to that provider's
// sign-in page. State and nonce wait in an HttpOnly cookie for ten minutes.
export const dynamic = "force-dynamic";

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = new URL("/account", req.nextUrl.origin);
  if (!isProvider(provider) || !providerEnabled(provider)) {
    back.searchParams.set("signin-error", `Sign in with ${isProvider(provider) ? PROVIDER_NAMES[provider] : "that service"} isn't available yet.`);
    return NextResponse.redirect(back, 303);
  }
  // Connecting remembers which account to add it to here: Apple's POST back arrives without the session cookie.
  const connectTo = req.nextUrl.searchParams.get("mode") === "connect" ? (await currentAccount())?.id : undefined;
  const mode = connectTo ? `connect:${connectTo}` : "signin";
  const state = hex(24);
  // 64 characters, so it also works as X's PKCE code verifier (43 to 128).
  const nonce = hex(32);
  const res = NextResponse.redirect(authorizeUrl(provider, req.nextUrl.origin, state, nonce), 303);
  res.headers.set("Cache-Control", "no-store");
  // Apple answers with a cross-site form POST, which only carries a SameSite=None cookie.
  res.cookies.set(OAUTH_COOKIE, [provider, state, nonce, mode].join("."), {
    path: "/api/account/oauth",
    maxAge: 600,
    httpOnly: true,
    sameSite: provider === "apple" ? "none" : "lax",
    secure: provider === "apple" || isSecure(req),
  });
  return res;
}
