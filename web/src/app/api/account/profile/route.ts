import { body, handle, json } from "@/lib/account-route";
import { requireAccount, saveProfile } from "@/lib/accounts";

// POST /api/account/profile {name, icon} → the display name and champion icon shown on the account page.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const a = await requireAccount();
  await saveProfile(a.id, await body(req));
  return json({ ok: true });
});
