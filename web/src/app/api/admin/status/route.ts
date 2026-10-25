import { NextResponse } from "next/server";
import { bindingNames, serverEnv } from "@/lib/env";

// GET /api/admin/status: which server secrets the running site can see (yes/no only, never values).
export const dynamic = "force-dynamic";

export function GET() {
  const has = (k: string) => Boolean(serverEnv(k));
  return NextResponse.json({
    OWNER_EMAIL: has("OWNER_EMAIL"),
    GITHUB_TOKEN: has("GITHUB_TOKEN"),
    bindings: bindingNames(),
  });
}
