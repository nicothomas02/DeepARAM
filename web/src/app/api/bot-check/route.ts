import { BOT_CHECK_SCRIPT, botCheckSiteKey } from "@/lib/bot-check";

// GET /api/bot-check: what the site's forms need to run the bot check
// ({siteKey: null} while it's off). The script address is sent from here so it isn't in the page.
export const dynamic = "force-dynamic";

export function GET() {
  const siteKey = botCheckSiteKey();
  return Response.json(siteKey ? { siteKey, script: BOT_CHECK_SCRIPT } : { siteKey: null }, {
    headers: { "Cache-Control": "no-store" },
  });
}
