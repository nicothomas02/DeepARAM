import { SESSION_COOKIE } from "./account-cookies";
import { sessionAccount } from "./account-session";

// The site owner: the one account that opens the site editor (lib/accounts.ts).
// Server pages and routes call isAdmin(); ownerFromCookie() checks a raw session cookie value.

/** Whether a session cookie value belongs to the owner's account. */
export async function ownerFromCookie(value: string | undefined): Promise<boolean> {
  return (await sessionAccount(value).catch(() => null))?.owner === true;
}

/** For server components and route handlers: is this request from the signed-in site owner? */
export async function isAdmin(): Promise<boolean> {
  const { cookies } = await import("next/headers");
  return ownerFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
}
