import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/account-cookies";
import { handle, json } from "@/lib/account-route";
import { clearSessionCookies, endSession } from "@/lib/accounts";

// POST /api/account/signout → ends this browser's session.
export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  await endSession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => {});
  const res = json({ ok: true });
  clearSessionCookies(res);
  return res;
});
