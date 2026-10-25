import { body, handle, json } from "@/lib/account-route";
import { changeEmail, cleanEmail, requireAccount } from "@/lib/accounts";

// POST /api/account/email {email, password} → changes the email this account signs in with.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const a = await requireAccount();
  const b = await body(req);
  await changeEmail(a, cleanEmail(b.email), b.password);
  return json({ ok: true });
});
