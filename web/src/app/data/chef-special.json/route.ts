import { chefsSpecial } from "@/lib/highlights";

// The Chef Special this deploy shows. Home's card checks it so a page the browser kept from an earlier
// day (a restored tab, the back button, an installed app resumed) swaps to the current special.
export const dynamic = "force-static";

export function GET() {
  const s = chefsSpecial();
  return Response.json({ id: s?.id ?? null });
}
