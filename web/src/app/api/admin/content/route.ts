import { NextRequest, NextResponse } from "next/server";
import { AdminError, loadContent, saveContent } from "@/lib/admin";
import { isAdmin } from "@/lib/admin-session";

// GET  /api/admin/content  → { content, sha }
// POST /api/admin/content  { content, sha } → { sha }
// Both only for the signed-in site owner (lib/accounts.ts).
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  const status = err instanceof AdminError ? err.status : 500;
  const message = err instanceof AdminError ? err.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status });
}

async function owner() {
  if (!(await isAdmin())) throw new AdminError("Sign in with the site owner's account first.", 401);
}

export async function GET() {
  try {
    await owner();
    return NextResponse.json(await loadContent(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await owner();
    const { content, sha } = (await req.json()) as { content?: unknown; sha?: string | null };
    return NextResponse.json({ sha: await saveContent(content, sha ?? null) });
  } catch (err) {
    return fail(err);
  }
}
