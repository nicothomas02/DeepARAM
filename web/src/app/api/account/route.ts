import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/account-cookies";
import { body, handle, json } from "@/lib/account-route";
import { enabledProviders } from "@/lib/oauth";
import { accountView, clearSessionCookies, confirmIt, currentAccount, deleteAccount, requireAccount, saveData } from "@/lib/accounts";

// GET    /api/account → the signed-in account ({signedIn: false} when nobody is)
// PUT    /api/account {settings} → saves what syncs between browsers
// DELETE /api/account {password?} → deletes the account and everything saved with it
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const a = await currentAccount();
  if (!a) {
    const res = json({ signedIn: false, providers: enabledProviders() });
    // A cookie for a session that ended (signed out elsewhere, or expired) is cleared.
    if ((await cookies()).get(SESSION_COOKIE)) clearSessionCookies(res);
    return res;
  }
  return json({ signedIn: true, ...(await accountView(a)) });
});

export const PUT = handle(async (req) => {
  const a = await requireAccount();
  await saveData(a.id, await body(req));
  return json({ ok: true });
});

export const DELETE = handle(async (req) => {
  const a = await requireAccount();
  const { password } = await body(req);
  await confirmIt(a, password);
  await deleteAccount(a.id);
  const res = json({ deleted: true });
  clearSessionCookies(res);
  return res;
});
