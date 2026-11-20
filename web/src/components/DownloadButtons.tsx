"use client";

import { useEffect, useState } from "react";
import { APP_DOWNLOADS, isAppOs, onWindows } from "@/lib/app-downloads";

// The download button. /download/<os> sends people back here with ?soon=<os> while the installer isn't out yet.
export default function DownloadButtons() {
  const [other, setOther] = useState(false);
  const [soon, setSoon] = useState(false);
  useEffect(() => {
    setOther(!onWindows(navigator.userAgent));
    setSoon(isAppOs(new URLSearchParams(location.search).get("soon") ?? ""));
  }, []);
  const { file, label } = APP_DOWNLOADS.windows;
  return (
    <section className="card download-get" aria-label="Download">
      <div className="download-buttons">
        <a className="btn" href="/download/windows" download={file}>
          Download for {label}
        </a>
      </div>
      {soon ? (
        <p className="download-soon" role="status">
          The app isn&apos;t out yet. Check back soon.
        </p>
      ) : (
        <p className="download-note">
          Free, no account needed.{other ? " The app is for Windows PCs; on other devices, use the site in your browser." : ""}
        </p>
      )}
    </section>
  );
}
