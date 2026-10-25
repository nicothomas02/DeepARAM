// In the browser: whether the site owner is signed in (lib/accounts.ts sets the flag cookie).
// Only decides whether to try loading owner-only files; the server checks the real sign-in.
export const adminFlag = () => typeof document !== "undefined" && /(?:^|;\s*)deeparam-admin-ui=1/.test(document.cookie);
