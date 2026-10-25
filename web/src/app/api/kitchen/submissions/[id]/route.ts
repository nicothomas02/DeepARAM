import type { NextRequest } from "next/server";
import { body, handle, json } from "@/lib/account-route";
import { requireAccount } from "@/lib/accounts";
import { remove, review } from "@/lib/kitchen";

// DELETE /api/kitchen/submissions/<id>: a player deletes their own build (the owner can delete any).
// POST {action: "approve" | "reject"}: the site owner reviews a build.
export const dynamic = "force-dynamic";

const idOf = (req: NextRequest) => decodeURIComponent(req.nextUrl.pathname.split("/").pop() ?? "").slice(0, 64);

export const DELETE = handle(async (req) => {
  await remove(await requireAccount(), idOf(req));
  return json({ ok: true });
});

export const POST = handle(async (req) => {
  const a = await requireAccount();
  await review(a, idOf(req), (await body(req)).action);
  return json({ ok: true });
});
