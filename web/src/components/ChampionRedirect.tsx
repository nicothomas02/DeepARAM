"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Old champion links (/champions#Ahri) open that champion's own page (/champions/Ahri).
// Redirects can't see the #part, so this runs in the browser; a bare /champions stays on the A to Z list.
export default function ChampionRedirect({ aliases }: { aliases: string[] }) {
  const router = useRouter();
  useEffect(() => {
    const want = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    const alias = want && aliases.find((a) => a.toLowerCase() === want);
    if (alias) router.replace(`/champions/${alias}`);
  }, [aliases, router]);
  return null;
}
