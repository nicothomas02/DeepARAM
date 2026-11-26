// Cookie names for site accounts (lib/accounts.ts), shared by the server, the middleware and the browser.

/** HttpOnly: the session token. Only its SHA-256 is stored, so a database leak can't sign anyone in. */
export const SESSION_COOKIE = "deeparam-session";
/** Readable "1": tells the browser someone is signed in, so it syncs Favorites and settings. */
export const SIGNED_IN_FLAG = "deeparam-signed-in";
/** Readable "1": the site owner is signed in, so pages try the owner-only files (the server checks for real). */
export const OWNER_FLAG = "deeparam-admin-ui";
/** HttpOnly, five minutes: names the passkey challenge the server is keeping for this browser. Never the challenge itself. */
export const CHALLENGE_COOKIE = "deeparam-passkey";
/** The challenge cookie is only sent to the passkey route, and a cookie has to be dropped under the path it was set with. */
export const CHALLENGE_PATH = "/api/account/passkey";

/** HttpOnly, ten minutes: state and nonce of a Sign in with Google, Apple, Discord etc. this browser started. */
export const OAUTH_COOKIE = "deeparam-oauth";

export const SESSION_DAYS = 90;
