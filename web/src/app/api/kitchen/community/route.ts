import { NextResponse } from "next/server";
import { handle } from "@/lib/account-route";
import { community } from "@/lib/kitchen";

// GET /api/kitchen/community: approved community builds for The Kitchen, newest first (no stats, display names only).
export const dynamic = "force-dynamic";

export const GET = handle(async () =>
  NextResponse.json({ builds: await community() }, { headers: { "Cache-Control": "public, max-age=60" } }),
);
