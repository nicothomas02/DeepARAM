import { body, handle, json } from "@/lib/account-route";
import { AccountError, requireAccount } from "@/lib/accounts";
import { confirmPair, isPairId, pairInfo } from "@/lib/riot-pair";

// One-click connect from My Stats (lib/riot-pair.ts), confirmed by the signed-in player on /account.
// GET  /api/account/connect?pair=<id> → {riotId, done, owner}: whose Riot account it is, before confirming
// POST /api/account/connect {pair, save} → connects it; save asks My Stats to save games to the account (owner only)
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const a = await requireAccount();
  const pair = req.nextUrl.searchParams.get("pair");
  const info = isPairId(pair) ? await pairInfo(pair) : null;
  if (!info) throw new AccountError("This connect link has expired. Choose Connect account in My Stats again.", 410);
  return json({ ...info, owner: a.owner });
});

export const POST = handle(async (req) => {
  const a = await requireAccount();
  const b = await body(req);
  if (!isPairId(b.pair)) throw new AccountError("Bad request");
  return json({ connected: true, ...(await confirmPair(b.pair, a, b.save === true)) });
});
