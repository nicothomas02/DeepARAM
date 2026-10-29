import "server-only";
import type { NextRequest } from "next/server";

// The JSON body of a My Stats request (/api/games, /api/history, /api/profile, and the owner's /api/admin/content):
// read as text first so an oversized body is refused before it is parsed, then checked to be a JSON object.
// Anything else (bad JSON, an array, a bare string or number) is a 400, so no route touches D1 or KV with a
// body it hasn't looked at. The /api/account routes do the same through lib/account-route.ts.

export const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

/** The request's JSON object, or the error response to send instead (413 when it's over `max` characters, else 400). */
export async function readBody(req: NextRequest, max: number): Promise<Record<string, unknown> | Response> {
  const text = await req.text();
  if (text.length > max) return json({ error: "Too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Bad request" }, 400);
  return body as Record<string, unknown>;
}
