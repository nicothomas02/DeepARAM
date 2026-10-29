import { NextRequest, NextResponse } from "next/server";
import { AdminError, loadContent, saveContent } from "@/lib/admin";
import { isAdmin } from "@/lib/admin-session";
import { readBody } from "@/lib/api-body";

// GET  /api/admin/content  → { content, sha }
// POST /api/admin/content  { content, sha } → { sha }
// Both only for the signed-in site owner (lib/accounts.ts). The site text is a few hundred strings, so a
// body over the cap, or one that isn't a JSON object with a string sha, is a bad request before GitHub is asked.
export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000;
const MAX_SHA = 64;

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
    const body = await readBody(req, MAX_BODY);
    if (body instanceof Response) return body;
    const { content, sha } = body;
    if (sha != null && (typeof sha !== "string" || sha.length > MAX_SHA)) throw new AdminError("Bad request", 400);
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new AdminError("Bad request", 400);
    return NextResponse.json({ sha: await saveContent(content, (sha as string | undefined) ?? null) });
  } catch (err) {
    return fail(err);
  }
}
