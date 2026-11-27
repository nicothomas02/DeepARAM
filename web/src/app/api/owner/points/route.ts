import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-session";
import type { OwnerPoints, OwnerView } from "@/lib/owner-view";
// Built before `next build` (scripts/owner-points.ts); not in the repo and not a public file, only in the Worker's code.
import data from "@/generated/owner-points.json";

// GET /api/owner/points?view=tierList|augments|champions|patches[&id=<augment id or champion>]: the augment win-rate
// points the public site leaves out (lib/owner-view.ts), only for the signed-in site owner.
export const dynamic = "force-dynamic";

const POINTS = data as unknown as OwnerPoints;
const VIEWS: OwnerView[] = ["tierList", "augments", "champions", "patches"];
const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Only for the site owner." }, { status: 401, headers: PRIVATE });
  const view = req.nextUrl.searchParams.get("view") as OwnerView;
  const id = req.nextUrl.searchParams.get("id");
  if (!VIEWS.includes(view)) return NextResponse.json({ error: "Unknown view." }, { status: 400, headers: PRIVATE });
  const all = POINTS[view] as Record<string, unknown>;
  const body = view === "tierList" || view === "patches" ? all : id !== null ? all[id] : undefined;
  if (body === undefined) return NextResponse.json({ error: "Not found." }, { status: 404, headers: PRIVATE });
  return NextResponse.json(body, { headers: PRIVATE });
}
