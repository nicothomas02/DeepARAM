import { body, handle, json } from "@/lib/account-route";
import { changePassword, cleanPassword, requireAccount } from "@/lib/accounts";

// POST /api/account/password {current, next} → sets a new password. Right after a passkey sign-in the
// current one isn't needed, which is how a forgotten password is replaced.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const a = await requireAccount();
  const b = await body(req);
  await changePassword(a, b.current, cleanPassword(b.next));
  return json({ ok: true });
});
