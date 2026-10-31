import Link from "next/link";
import { T } from "@/components/I18n";
import NotFoundSuggestions from "@/components/NotFoundSuggestions";

export default function NotFound() {
  return (
    <>
      <section className="intro">
        <p className="eyebrow">404</p>
        <h1>
          <T>{"This page doesn't exist."}</T>
        </h1>
        <p className="lede">
          <T>It may have moved, or the link has a typo. Search with / or ⌘K, or try one of these.</T>
        </p>
      </section>
      <NotFoundSuggestions />
      <p className="empty-actions">
        <Link href="/" className="btn">
          <T>Home</T>
        </Link>
        <Link href="/tier-list" className="btn ghost">
          <T>Tier List</T>
        </Link>
        <Link href="/simulator" className="btn ghost">
          <T>Simulator</T>
        </Link>
      </p>
    </>
  );
}
