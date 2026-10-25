import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AccountError } from "./accounts";

// Shared by the /api/account routes: JSON in, JSON out, never cached, and AccountErrors become their message.

const MAX_BODY = 16_000;

export const json = (obj: unknown, status = 200) => NextResponse.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function body(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new AccountError("Too large", 413);
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new AccountError("Bad request");
  }
}

export const isSecure = (req: NextRequest) => req.nextUrl.protocol === "https:";
export const clientIp = (req: NextRequest) => req.headers.get("cf-connecting-ip");

export function handle(fn: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof AccountError) return json({ error: err.message }, err.status);
      console.error("account route failed", err);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  };
}
