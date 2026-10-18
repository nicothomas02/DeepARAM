import type { Metadata } from "next";
import Intro from "@/components/Intro";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta("/privacy", "Privacy", "What DeepARAM stores about you, and what it doesn't.");

const CONTACT = "admin@deeparam.com";

export default function Privacy() {
  return (
    <>
      <Intro eyebrow="Privacy" title="What DeepARAM keeps, and what it doesn't." />
      <article className="card prose">
        <p>Last updated October 18, 2026.</p>
        <h2>No ads, no tracking</h2>
        <p>
          DeepARAM has no ads and no tracking cookies. We count page visits anonymously, without cookies, to see which pages are used. We don&apos;t sell or share
          personal data.
        </p>
        <h2>Accounts (optional)</h2>
        <p>
          You can use the whole site without an account. If you create one, we keep your email address, your password as a salted one-way hash (never the password
          itself), the public keys of any passkeys you add, and the site settings you pick, so they follow you to every device. Signing in
          sets one cookie that keeps you signed in for up to 90 days; signing out ends it. You can delete your account and everything saved with it from the account
          page at any time.
        </p>
        <p>
          If you sign in with another service, such as Google, Apple or Discord, that happens on that service&apos;s own page: we never see your
          password there, and we receive only an account identifier and, if they have confirmed it, your email address. You can stop signing in that way from the account page.
        </p>
        <p>
          If you connect a Riot account through My Stats, we keep its Riot ID, server and Riot&apos;s player identifier with your account. Connecting is
          confirmed by the Riot Client on your own computer, so nobody can connect yours. You can disconnect it at any time.
        </p>
        <p>
          If you send a build to The Kitchen from the Simulator, we keep it with your account: the champion, items and augments, the name and text you
          wrote, the Simulator&apos;s numbers you saw, your language and when you sent it. The site owner reviews it, and if it&apos;s approved, The Kitchen shows
          the build and your text with your account&apos;s display name (never your email). You can delete your builds from the account page at any time, and
          deleting your account deletes them too.
        </p>
        <h2>Stored in your browser</h2>
        <p>
          Your theme and settings are saved in your own browser&apos;s local storage. If you&apos;re signed in, your settings are also saved to
          your account as described above. Clearing site data removes the browser copy.
        </p>
        <h2>My Stats</h2>
        <p>
          My Stats reads your own games through a companion app on your own computer, and your game history stays there unless you choose one of the options
          below.
        </p>
        <p>
          If you turn on game sharing, the app sends your games to DeepARAM so the site can build stats across everyone&apos;s games. A shared game keeps only
          the champions, items, augments, runes, summoner spells, results and game stats, with no names, Riot IDs or account identifiers. We keep a salted
          hash of who shared it, so you can turn sharing off and remove the games you sent.
        </p>
        <p>
          If you publish a public page from My Stats, we keep your Riot ID, server and a summary of your games (games and wins, kills, deaths, assists,
          damage, champions played and badges) and show it at your page&apos;s address. Only you can publish or remove it, and nothing is shown unless you publish.
        </p>
        <h2>Server logs and security</h2>
        <p>
          Like any website, our hosting provider keeps short-lived request logs (IP address, page and time) and runs security
          checks to keep the site running and stop abuse, such as limiting how often sign-ins can be tried.
        </p>
        <h2>Contact</h2>
        <p>
          Questions or removal requests: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </article>
    </>
  );
}
