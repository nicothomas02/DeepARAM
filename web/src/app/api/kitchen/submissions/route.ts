import { body, clientIp, handle, json } from "@/lib/account-route";
import { AccountError, requireAccount } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";
import { cleanSubmission, mine, submit } from "@/lib/kitchen";

// POST /api/kitchen/submissions: a signed-in player sends a Simulator build to The Kitchen (it waits for review).
// GET: the player's own builds, and for the site owner the review queue.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const a = await requireAccount();
  const b = await body(req);
  if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 400);
  return json(await submit(a, cleanSubmission(b)), 201);
});

export const GET = handle(async () => json(await mine(await requireAccount())));
