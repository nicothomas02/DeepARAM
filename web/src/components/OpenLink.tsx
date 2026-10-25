"use client";

import { useEffect } from "react";

// Sends a visitor from a share link (/share/builds) on to what was shared; link previews
// stay on the share page, which is all they read.
export default function OpenLink({ href }: { href: string }) {
  useEffect(() => location.replace(href), [href]);
  return null;
}
