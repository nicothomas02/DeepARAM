import type { Metadata } from "next";
import Link from "next/link";
import Intro from "@/components/Intro";
import DownloadButtons from "@/components/DownloadButtons";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta(
  "/download",
  "Desktop app",
  "Get the free DeepARAM app for Windows: champ select picks, your build and augment rankings in game, and patch alerts.",
);

// The public desktop app (apps/desktop). Sharing games is opt-in: the app asks once on first launch, off unless the
// player says yes, and the tray item changes it later. Site rule: never name data sources or the backend here.
export default function Download() {
  return (
    <>
      <Intro eyebrow="Desktop app" title="DeepARAM on your computer." art="habackground">
        Free for Windows. Builds and augment picks for ARAM Mayhem, right when you need them.
      </Intro>

      <DownloadButtons />

      <section className="download-grid">
        <article className="card">
          <h2 className="download-h">What it does</h2>
          <ul className="download-list">
            <li>
              <b>Champ select</b>
              <span>Ranks your champion and the bench for your team.</span>
            </li>
            <li>
              <b>In game</b>
              <span>A small panel with your next items and your champion&apos;s augments in ranking order. It shows up at the start, while you&apos;re dead and at augment picks.</span>
            </li>
            <li>
              <b>After the game</b>
              <span>A short review of how the game went.</span>
            </li>
            <li>
              <b>Patch alerts</b>
              <span>A notice when a new patch or test server build lands, plus the whole site in its own window.</span>
            </li>
          </ul>
          <p className="download-note">
            Following Riot&apos;s rules for in-game tools, the app never shows win rates or tells you who&apos;s winning during a game.
          </p>
        </article>

        <article className="card" id="sharing">
          <h2 className="download-h">Share your games, see your trends (optional)</h2>
          <p>
            With sharing on, the review after each game shows your own trends: damage share, damage taken, kill participation, deaths and your most
            played champions over your last 20 games. The first time you open the app, it asks. It&apos;s off unless you say yes, and you can change it
            any time from the tray icon (<b>Share match data</b>).
          </p>
          <div className="download-split">
            <div>
              <b>Shared</b>
              <span>Champions, items, augments, runes, summoner spells, kills, deaths, damage, gold, game length and the result.</span>
            </div>
            <div>
              <b>Never shared</b>
              <span>Summoner names, Riot IDs or account ids (yours or anyone&apos;s), chat, or which player you were.</span>
            </div>
          </div>
          <p className="download-note">
            Your shares are tied together only by a random code made on your computer, never your Riot account. Turning sharing off
            removes the games you sent. Turning it on also sends the Mayhem games among your last 100 in the League client. Shared games go into a pool
            that, once enough players share, will make DeepARAM&apos;s tier lists and builds more accurate; no single game or player is ever shown. Your
            trends are worked out and kept on your computer. More in{" "}
            <Link href="/privacy">Privacy</Link>.
          </p>
        </article>

        <article className="card">
          <h2 className="download-h">Installing</h2>
          <ul className="download-list">
            <li>
              <b>Windows 10 or 11</b>
              <span>
                Run the installer. The first time, Windows may say &quot;Windows protected your PC&quot;: choose More info, then Run anyway. Use Borderless or
                Windowed mode in League to see the in-game panel.
              </span>
            </li>
          </ul>
        </article>
      </section>
    </>
  );
}
