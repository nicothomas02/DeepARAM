import "server-only";
import { serverEnv } from "./env";

// Sign in with another service: Google, Apple, Discord, Twitch, Microsoft, Steam, Facebook, X and GitHub.
// Each one switches on when its secrets are set on the Worker; until then its button
// doesn't show. The redirect URI to register with each is https://deeparam.com/api/account/oauth/<id>/callback.
// Setup steps for each: /mnt/project-files/docs/sign-in-setup.md (project files, not shipped).
//
// Most use <ID>_CLIENT_ID and <ID>_CLIENT_SECRET. Apple has no fixed secret: APPLE_CLIENT_ID (Services ID),
// APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8 text) sign a short-lived one per sign-in.
// Steam needs no keys (OpenID 2.0): STEAM_ENABLED=1 switches it on.

export const PROVIDERS = ["google", "apple", "discord", "twitch", "microsoft", "steam", "facebook", "x", "github"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_NAMES: Record<Provider, string> = {
  google: "Google",
  apple: "Apple",
  discord: "Discord",
  twitch: "Twitch",
  microsoft: "Microsoft",
  steam: "Steam",
  facebook: "Facebook",
  x: "X",
  github: "GitHub",
};

export type Identity = { subject: string; email: string | null };
type Flow = { origin: string; code: string; nonce: string };

type Config = {
  authorize: string;
  scope: string;
  secrets: string[];
  /** Extra authorize parameters. */
  params?: Record<string, string>;
  /** OpenID Connect: the id token's issuer (a string, or a pattern for Microsoft's per-tenant issuers). */
  issuer?: string | RegExp;
  token?: string;
  /** Plain OAuth 2: who signed in, from the access token. */
  who?: (accessToken: string) => Promise<Identity>;
  /** X needs PKCE; the nonce doubles as the code verifier. */
  pkce?: boolean;
  /** Send the client id and secret as HTTP Basic auth instead of in the form. */
  basic?: boolean;
};

const env = (name: string) => serverEnv(name) ?? "";
const idOf = (p: Provider) => (p === "apple" ? env("APPLE_CLIENT_ID") : env(`${p.toUpperCase()}_CLIENT_ID`));

async function getJson<T>(url: string, accessToken: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "deeparam.com" } });
  if (!res.ok) throw new OAuthError(`${what} ${res.status}`);
  return res.json() as Promise<T>;
}

const CONFIG: Record<Provider, Config> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    issuer: "https://accounts.google.com",
    scope: "openid email",
    params: { prompt: "select_account" },
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  apple: {
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    issuer: "https://appleid.apple.com",
    scope: "email",
    // Apple sends the answer back as a form POST whenever an email is asked for.
    params: { response_mode: "form_post" },
    secrets: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  },
  twitch: {
    authorize: "https://id.twitch.tv/oauth2/authorize",
    token: "https://id.twitch.tv/oauth2/token",
    issuer: "https://id.twitch.tv/oauth2",
    scope: "openid user:read:email",
    params: { claims: JSON.stringify({ id_token: { email: null, email_verified: null } }) },
    secrets: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  },
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    issuer: /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/,
    scope: "openid",
    params: { prompt: "select_account" },
    secrets: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  },
  discord: {
    authorize: "https://discord.com/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    scope: "identify email",
    secrets: ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"],
    who: async (t) => {
      const u = await getJson<{ id: string; email?: string; verified?: boolean }>("https://discord.com/api/users/@me", t, "discord user");
      return { subject: u.id, email: u.verified && u.email ? u.email.toLowerCase() : null };
    },
  },
  facebook: {
    authorize: "https://www.facebook.com/v21.0/dialog/oauth",
    token: "https://graph.facebook.com/v21.0/oauth/access_token",
    scope: "email",
    secrets: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    // Facebook hands out an email only once its owner has confirmed it.
    who: async (t) => {
      const u = await getJson<{ id: string; email?: string }>("https://graph.facebook.com/v21.0/me?fields=id,email", t, "facebook user");
      return { subject: u.id, email: u.email?.toLowerCase() ?? null };
    },
  },
  x: {
    authorize: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    scope: "users.read tweet.read",
    pkce: true,
    basic: true,
    secrets: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    // X shares no email.
    who: async (t) => ({ subject: (await getJson<{ data: { id: string } }>("https://api.x.com/2/users/me", t, "x user")).data.id, email: null }),
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    secrets: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    who: async (t) => {
      const [u, emails] = await Promise.all([
        getJson<{ id: number }>("https://api.github.com/user", t, "github user"),
        getJson<{ email: string; primary: boolean; verified: boolean }[]>("https://api.github.com/user/emails", t, "github emails").catch(() => []),
      ]);
      const e = emails.find((m) => m.primary && m.verified);
      return { subject: String(u.id), email: e ? e.email.toLowerCase() : null };
    },
  },
  steam: { authorize: "https://steamcommunity.com/openid/login", scope: "", secrets: ["STEAM_ENABLED"] },
};

export const isProvider = (p: unknown): p is Provider => typeof p === "string" && (PROVIDERS as readonly string[]).includes(p);
export const providerEnabled = (p: Provider) => CONFIG[p].secrets.every((s) => serverEnv(s));
export const enabledProviders = () => PROVIDERS.filter(providerEnabled);

export const redirectUri = (origin: string, p: Provider) => `${origin}/api/account/oauth/${p}/callback`;

export function authorizeUrl(p: Provider, origin: string, state: string, nonce: string): string {
  const c = CONFIG[p];
  if (p === "steam") {
    // OpenID 2.0: Steam sends the browser back to return_to, which carries our state.
    const q = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${redirectUri(origin, p)}?state=${state}`,
      "openid.realm": origin,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return `${c.authorize}?${q}`;
  }
  const q = new URLSearchParams({ client_id: idOf(p), redirect_uri: redirectUri(origin, p), response_type: "code", scope: c.scope, state, ...c.params });
  if (c.issuer) q.set("nonce", nonce);
  if (c.pkce) {
    q.set("code_challenge", nonce);
    q.set("code_challenge_method", "plain");
  }
  return `${c.authorize}?${q}`;
}

export class OAuthError extends Error {}

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));

/** Apple's client secret: an ES256 JWT signed with the .p8 key, good for five minutes. */
async function appleSecret(): Promise<string> {
  const pem = env("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: env("APPLE_KEY_ID") }));
  const body = b64url(JSON.stringify({ iss: env("APPLE_TEAM_ID"), iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: env("APPLE_CLIENT_ID") }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Trades the one-time code for tokens and reads who signed in. */
export async function exchange(p: Provider, { origin, code, nonce }: Flow): Promise<Identity> {
  const c = CONFIG[p];
  if (!c.token) throw new OAuthError(`${p} has no code exchange`);
  const clientId = idOf(p);
  const secret = p === "apple" ? await appleSecret() : env(`${p.toUpperCase()}_CLIENT_SECRET`);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin, p) });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (c.basic) headers.Authorization = `Basic ${btoa(`${clientId}:${secret}`)}`;
  else form.set("client_secret", secret);
  form.set("client_id", clientId);
  if (c.pkce) form.set("code_verifier", nonce);
  const res = await fetch(c.token, { method: "POST", headers, body: form });
  if (!res.ok) throw new OAuthError(`${p} token ${res.status}`);
  const tok = (await res.json()) as { id_token?: string; access_token?: string };
  if (c.who) {
    if (!tok.access_token) throw new OAuthError(`${p} gave no access token`);
    const who = await c.who(tok.access_token);
    if (!who.subject) throw new OAuthError(`${p} gave no account id`);
    return who;
  }
  return readIdToken(p, tok.id_token, clientId, nonce);
}

/**
 * The id token's claims. It came straight from the provider's token endpoint over TLS in exchange for a
 * code and our client secret, which OpenID Connect accepts in place of checking its signature; the issuer,
 * audience, expiry and nonce are still checked.
 */
export function readIdToken(p: Provider, idToken: string | undefined, clientId: string, nonce: string): Identity {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(unb64url((idToken ?? "").split(".")[1] ?? ""));
  } catch {
    throw new OAuthError(`${p} id token unreadable`);
  }
  const want = CONFIG[p].issuer;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const iss = String(claims.iss ?? "").replace(/^(?!https:\/\/)/, "https://");
  const issOk = typeof want === "string" ? iss === want : want ? want.test(iss) : false;
  if (!issOk || !aud.includes(clientId) || Number(claims.exp) * 1000 < Date.now() || claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub) {
    throw new OAuthError(`${p} id token rejected`);
  }
  // Microsoft's email claim isn't confirmed by Microsoft, so it's left out.
  const verified = p !== "microsoft" && (claims.email_verified === true || claims.email_verified === "true");
  return { subject: claims.sub, email: typeof claims.email === "string" && verified ? claims.email.toLowerCase() : null };
}

/** Steam (OpenID 2.0): asks Steam whether it really sent this answer, and reads the Steam id from it. */
export async function steamIdentity(origin: string, q: URLSearchParams, state: string): Promise<Identity> {
  const returnTo = q.get("openid.return_to") ?? "";
  const claimed = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q.get("openid.claimed_id") ?? "");
  if (q.get("openid.mode") !== "id_res" || returnTo !== `${redirectUri(origin, "steam")}?state=${state}` || !claimed) throw new OAuthError("steam answer malformed");
  const check = new URLSearchParams();
  for (const [k, v] of q) if (k.startsWith("openid.")) check.set(k, v);
  check.set("openid.mode", "check_authentication");
  const res = await fetch(CONFIG.steam.authorize, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: check });
  if (!res.ok || !/is_valid\s*:\s*true/.test(await res.text())) throw new OAuthError("steam answer not confirmed");
  return { subject: claimed[1], email: null };
}
