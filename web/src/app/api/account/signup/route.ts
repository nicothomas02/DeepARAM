import { body, clientIp, handle, isSecure, json } from "@/lib/account-route";
import { AccountError, cleanEmail, cleanPassword, createAccount, startSession } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";

// POST /api/account/signup {email, password, check} → creates the account and signs this browser in.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const b = await body(req);
  if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 403);
  const account = await createAccount(cleanEmail(b.email), cleanPassword(b.password));
  const res = json({ ok: true });
  await startSession(res, account, "password", isSecure(req));
  return res;
});
