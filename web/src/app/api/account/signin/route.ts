import { body, clientIp, handle, isSecure, json } from "@/lib/account-route";
import { AccountError, cleanEmail, passwordSignIn, startSession } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";

// POST /api/account/signin {email, password, check} → signs this browser in.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const b = await body(req);
  if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 403);
  const account = await passwordSignIn(cleanEmail(b.email), typeof b.password === "string" ? b.password.slice(0, 200) : "");
  const res = json({ ok: true });
  await startSession(res, account, "password", isSecure(req));
  return res;
});
