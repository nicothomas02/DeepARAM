"use client";

import { useEffect, useState } from "react";
import { APP_DOWNLOADS, guessOs, isAppOs, type AppOs } from "@/lib/app-downloads";

// The two download buttons, the visitor's own system first. /download/<os> sends people back here with ?soon=<os>
// while that installer isn't out yet.
export default function DownloadButtons() {
  const [first, setFirst] = useState<AppOs | null>(null);
  const [soon, setSoon] = useState<AppOs | null>(null);
  useEffect(() => {
    setFirst(guessOs(navigator.userAgent));
    const s = new URLSearchParams(location.search).get("soon") ?? "";
    if (isAppOs(s)) setSoon(s);
  }, []);
  const order: AppOs[] = first === "mac" ? ["mac", "windows"] : ["windows", "mac"];
  return (
    <section className="card download-get" aria-label="Download">
      <div className="download-buttons">
        {order.map((os) => (
          <a key={os} className={os === order[0] ? "btn" : "btn ghost"} href={`/download/${os}`} download={APP_DOWNLOADS[os].file}>
            Download for {APP_DOWNLOADS[os].label}
          </a>
        ))}
      </div>
      {soon ? (
        <p className="download-soon" role="status">
          The {APP_DOWNLOADS[soon].label} version isn&apos;t out yet. Check back soon.
        </p>
      ) : (
        <p className="download-note">Free, no account needed. iPhone, iPad and Android: use the site in your browser.</p>
      )}
    </section>
  );
}
