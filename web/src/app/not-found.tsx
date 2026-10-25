import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <section className="intro">
        <p className="eyebrow">404</p>
        <h1>This page doesn&apos;t exist.</h1>
        <p className="lede">It may have moved, or the link has a typo. Search with / or ⌘K, or try one of these.</p>
      </section>
      <p className="empty-actions">
        <Link href="/" className="btn">
          Home
        </Link>
        <Link href="/tier-list" className="btn ghost">
          Tier List
        </Link>
        <Link href="/simulator" className="btn ghost">
          Simulator
        </Link>
      </p>
    </>
  );
}
