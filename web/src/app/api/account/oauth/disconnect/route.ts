import { body, handle, json } from "@/lib/account-route";
import { AccountError, disconnectProvider, requireAccount } from "@/lib/accounts";
import { isProvider } from "@/lib/oauth";

// POST /api/account/oauth/disconnect {provider} → stops another service signing in to this account.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const a = await requireAccount();
  const { provider } = await body(req);
  if (!isProvider(provider)) throw new AccountError("Bad request");
  await disconnectProvider(a.id, provider);
  return json({ ok: true });
});
