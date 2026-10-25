import { body, clientIp, handle, json } from "@/lib/account-route";
import { AccountError, currentAccount, requireAccount } from "@/lib/accounts";
import { passesBotCheck } from "@/lib/bot-check";
import { cleanMessage, inbox, removeMessage, sendMessage } from "@/lib/contact";

// POST /api/contact: a visitor's message from the footer's Contact us box (signed in or not).
// GET: the site owner's inbox. DELETE ?id=: the owner removes a message. Data: lib/contact.ts.
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const b = await body(req);
  const m = cleanMessage(b);
  if (!(await passesBotCheck(b.check, clientIp(req)))) throw new AccountError("The bot check didn't pass. Try again.", 400);
  await sendMessage(m, { account: await currentAccount().catch(() => null), ip: clientIp(req) });
  return json({ ok: true }, 201);
});

export const GET = handle(async () => json({ messages: await inbox(await requireAccount()) }));

export const DELETE = handle(async (req) => {
  await removeMessage(await requireAccount(), (req.nextUrl.searchParams.get("id") ?? "").slice(0, 64));
  return json({ ok: true });
});
