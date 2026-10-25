import { handle, json } from "@/lib/account-route";
import { requireAccount, unlinkRiot } from "@/lib/accounts";

// DELETE /api/account/riot-code → disconnects the Riot account (connecting happens through Mayhem Stats; see lib/riot-pair.ts)
export const dynamic = "force-dynamic";

export const DELETE = handle(async () => {
  const a = await requireAccount();
  await unlinkRiot(a.id);
  return json({ ok: true });
});
