"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// A link in a list (tier rows, table cells, champion and item grids). A plain <Link> loads its page as soon as it
// scrolls into view, so a list of a few hundred kept the network busy for half a minute. This one only gets
// the page ready when it is pointed at, touched or focused, which is still well before the click.
export default function RowLink({ href, onMouseEnter, onTouchStart, onFocus, ...rest }: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string }) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
