import type { Metadata } from "next";
import Intro from "@/components/Intro";
import { text } from "@/lib/content";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta("/terms", "Terms", "The terms for using DeepARAM, a free ARAM Mayhem fan site: personal use, estimates without guarantees, and how to reach us.");

const CONTACT = "admin@deeparam.com";

export default function Terms() {
  return (
    <>
      <Intro eyebrow="Terms" title="Using DeepARAM." />
      <article className="card prose">
        <p>Last updated October 16, 2026.</p>
        <h2>The site</h2>
        <p>
          DeepARAM is a free fan site with stats, tools and a simulator for League of Legends ARAM Mayhem. You can use it for
          personal, non-commercial purposes. Please don&apos;t scrape it heavily, overload it or try to break it.
        </p>
        <h2>No guarantees</h2>
        <p>
          Win rates, tiers and simulator results are estimates and can be wrong or out of date. The site is provided as is,
          without warranties, and may change or go offline at any time.
        </p>
        <h2>Riot Games</h2>
        <p>{text("footer")}</p>
        <h2>Changes and contact</h2>
        <p>
          These terms may be updated; the date above shows the latest version. Questions:{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </article>
    </>
  );
}
