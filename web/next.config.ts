import type { NextConfig } from "next";

// Sent with every page. The site frames its own /embed pages, so framing is limited to itself.
// The content policy only reports for now (inline theme scripts, embeds); enforce it once it's quiet.
const CSP = [
  "default-src 'self'",
  // challenges.cloudflare.com: the bot check on the Simulator leaderboard and account sign-in (lib/bot-check.ts), script and frame.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Old addresses of moved tabs. A #hash (like /tools/champions#Yasuo) carries over.
  async redirects() {
    return [
      ["/china", "/tier-list"],
      ["/tools", "/"],
      ["/tools/simulator", "/simulator"],
      ["/tools/lab", "/kitchen"],
      ["/lab", "/kitchen"],
      ["/tools/champions", "/champions"],
      ["/tools/guide", "/info"],
      ["/guide", "/info"],
      ["/tools/fun", "/kitchen"],
      ["/tools/cook-builds", "/kitchen"],
      ["/tools/kitchen", "/kitchen"],
      // The Status page was removed.
      ["/status", "/"],
      // The owner's tools moved under the account page when accounts replaced the editor password.
      ["/admin", "/account/edit"],
      ["/admin/simulator", "/simulator"],
      // The 3D Simulator opens from the owner-only switch on /simulator now.
      ["/account/simulator", "/simulator"],
      // My Stats moved onto the account page.
      ["/stats", "/account#my-stats"],
    ]
      .map(([source, destination]) => ({ source, destination, permanent: true }))
      .concat([
        // What to build for a champion is on its page now; with no champion, the tier list.
        ...["/what-to-build", "/builds"].flatMap((source) => [
          { source, has: [{ type: "query" as const, key: "champ", value: "(?<champ>[A-Za-z]+)" }], missing: [{ type: "query" as const, key: "tab" }], destination: "/champions/:champ", permanent: true },
          { source, has: [{ type: "query" as const, key: "tab", value: "helper" }, { type: "query" as const, key: "champ", value: "(?<champ>[A-Za-z]+)" }], destination: "/champions/:champ", permanent: true },
        ]),
        { source: "/builds", has: [{ type: "query" as const, key: "tab", value: "helper" }], destination: "/tier-list", permanent: true },
        { source: "/what-to-build", destination: "/tier-list", permanent: true },
        // Compare was removed; its addresses open the Tier List.
        { source: "/compare", destination: "/tier-list", permanent: true },
        { source: "/builds", has: [{ type: "query" as const, key: "tab", value: "compare" }], destination: "/tier-list", permanent: true },
        // The augment tier list is a Tier List tab now.
        ...["tab", "rarity", "style"].map((key) => ({
          source: "/augments",
          has: [{ type: "query" as const, key, value: key === "tab" ? "tiers" : undefined }],
          destination: "/tier-list?tab=augments",
          permanent: true,
        })),
        // Duos sit under the Tier List's Champions tab now (?cview=duos); tab=champions overrides the old tab=duos.
        ...["/augments", "/tier-list"].map((source) => ({
          source,
          has: [{ type: "query" as const, key: "tab", value: "duos" }],
          destination: "/tier-list?tab=champions&cview=duos",
          permanent: true,
        })),
        // Other Augments page tabs carry over to the Tier List.
        { source: "/augments", has: [{ type: "query" as const, key: "tab", value: "(?<tab>.+)" }], destination: "/tier-list?tab=:tab", permanent: true },
        { source: "/augments", destination: "/tier-list?tab=augments", permanent: true },
        // Items is a Tier List tab now; its filters carry over under their own names. Item pages stay at /items/<slug>.
        { source: "/items", has: [{ type: "query" as const, key: "tag", value: "(?<tag>.+)" }], destination: "/tier-list?tab=items&itag=:tag", permanent: true },
        { source: "/items", destination: "/tier-list?tab=items", permanent: true },
        // The build tools (Build Editor, Team Builder) were removed; their addresses open the Tier List.
        ...["/builds", "/builder", "/synergy"].map((source) => ({ source, destination: "/tier-list", permanent: true })),
        // Infinite Ryze is a tab in The Kitchen now (it was a Simulator tab before).
        { source: "/simulator/infinite-ryze", destination: "/kitchen?tab=infinite-ryze", permanent: true },
        { source: "/simulator", has: [{ type: "query" as const, key: "tab", value: "infinite-ryze" }], destination: "/kitchen?tab=infinite-ryze", permanent: true },
        // Augments by icon and Draft practice were removed; their tabs open the augment tier list.
        { source: "/tier-list", has: [{ type: "query" as const, key: "tab", value: "groups|draft" }], destination: "/tier-list?tab=augments", permanent: true },
        { source: "/draft", destination: "/tier-list?tab=augments", permanent: false },
        // Pages that once existed for another mode's stand-ins of a champion.
        { source: "/champions/Jade_:alias", destination: "/champions/:alias", permanent: true },
        // Patch pages moved from client version numbers (16.20) to Riot's patch numbers (26.20).
        ...[15, 16, 17, 18, 19].map((v) => ({ source: `/patches/${v}.:minor(\\d{1,2})`, destination: `/patches/${v + 10}.:minor`, permanent: true })),
      ]);
  },
};

export default nextConfig;

// Lets `next dev` read Cloudflare bindings and .dev.vars.
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
