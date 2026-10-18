import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SESSION_COOKIE } from "@/lib/account-cookies";
import { ownerFromCookie } from "@/lib/admin-session";

// Per-visitor limits on the routes that cost something: browser error reports (/api/log, so they can't
// flood the logs), signing in, and the writes (leaderboard submissions, public profiles, shared games,
// account changes, builds sent to The Kitchen, Contact us messages). On Cloudflare the counts come from the Worker's
// rate-limit bindings (wrangler.jsonc "ratelimits"), shared by every request in a location; elsewhere,
// or if a binding is missing, from this instance's memory, which is approximate.
type Rule = { binding: string; limit: number; message: string };
const LOG: Rule = { binding: "RL_LOG", limit: 30, message: "Too many reports." };
const WRITE: Rule = { binding: "RL_WRITE", limit: 10, message: "Too many submissions." };
// My Stats sends a player's shared games 50 at a time, so a first share of 1,000 games is 20 requests.
const SHARE: Rule = { binding: "RL_SHARE", limit: 60, message: "Too many uploads." };
// Signing in and creating accounts: few per minute, so passwords can't be guessed quickly.
const SIGNIN: Rule = { binding: "RL_WRITE", limit: 10, message: "Too many tries." };
const WINDOW = 60_000; // all limits are per minute, matching the bindings' period

function ruleFor(req: NextRequest): Rule | null {
  const path = req.nextUrl.pathname;
  if (path === "/api/log") return LOG;
  if (path === "/api/games") return req.method === "GET" ? null : SHARE;
  // The owner's own games go to their account 100 at a time, the same way.
  if (path === "/api/history") return req.method === "GET" ? null : SHARE;
  if (path.startsWith("/api/account")) {
    // Sign in with Google, Apple and the rest start and finish with GETs (Apple's finish is a POST).
    if (path.startsWith("/api/account/oauth/")) return SIGNIN;
    if (req.method === "GET") return null;
    // Saving Favorites and settings happens as you click; the rest is signing in and account changes.
    return req.method === "PUT" ? SHARE : SIGNIN;
  }
  // The Kitchen's community list and your own submissions are free to read; sending or removing one counts.
  if (path.startsWith("/api/kitchen")) return req.method === "GET" ? null : WRITE;
  // GET /api/sim-scores is the public leaderboard, cached for a minute; only sending counts.
  if (req.method === "POST") return WRITE;
  return null;
}

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };
function binding(name: string): Limiter | null {
  try {
    const b = (getCloudflareContext().env as unknown as Record<string, unknown>)[name] as Limiter | undefined;
    return b && typeof b.limit === "function" ? b : null;
  } catch {
    return null; // not running on Cloudflare
  }
}

const hits = new Map<string, { n: number; reset: number }>();
function memoryAllows(key: string, limit: number) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + WINDOW });
  else if (++h.n > limit) return false;
  return true;
}

// Owner-only files (wrangler.jsonc sends these paths through the Worker first): 3D models,
// the 3D replay's ability sounds, and the full Simulator replay with its sounds. The
// signed-in site owner gets the file from the static assets; everyone else a plain 404.
const ADMIN_ONLY = /^\/(assets\/(models|sounds)\/|embed\/simulator\/(full(\.html)?$|replay-data\/sounds\/))/;

async function adminOnly(req: NextRequest) {
  if (!(await ownerFromCookie(req.cookies.get(SESSION_COOKIE)?.value))) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // In `next dev` (and outside Cloudflare) Next serves public/ itself.
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  let assets: { fetch(r: Request): Promise<Response> } | undefined;
  try {
    assets = (getCloudflareContext().env as unknown as Record<string, typeof assets>).ASSETS;
  } catch {
    // Not running on Cloudflare.
  }
  if (!assets) return NextResponse.next();
  const res = await assets.fetch(new Request(req.url, { method: req.method, headers: req.headers }));
  // Private, so a shared cache never hands the owner's copy to someone else.
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=86400");
  return out;
}

export async function middleware(req: NextRequest) {
  if (ADMIN_ONLY.test(req.nextUrl.pathname)) return adminOnly(req);
  const rule = ruleFor(req);
  if (!rule) return NextResponse.next();
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${rule.binding}:${ip}`;
  const limiter = binding(rule.binding);
  let ok: boolean;
  try {
    ok = limiter ? (await limiter.limit({ key })).success : memoryAllows(key, rule.limit);
  } catch {
    ok = memoryAllows(key, rule.limit);
  }
  if (ok) return NextResponse.next();
  return NextResponse.json(
    { error: `${rule.message} Try again in a minute.` },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

export const config = { matcher: ["/assets/models/:path*", "/assets/sounds/:path*", "/embed/simulator/full", "/embed/simulator/full.html", "/embed/simulator/replay-data/sounds/:path*", "/api/log", "/api/sim-scores", "/api/profile", "/api/games", "/api/history", "/api/account", "/api/account/:path*", "/api/kitchen/:path*", "/api/contact"] };
