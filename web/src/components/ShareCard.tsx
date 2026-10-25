"use client";

import { useEffect, useState } from "react";
import { drawCard, type CardSpec } from "@/lib/share-card";
import { buzz } from "@/lib/haptics";
import { useT } from "./I18n";

// A "Share image" button: draws a card for this page (lib/share-card.ts) and shows it with ways to
// share it (the phone's share sheet), copy it, or save it.

export default function ShareCard({ spec, label = "Share image" }: { spec: CardSpec; label?: string }) {
  const t = useT("tables");
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setNote("");
    drawCard(spec).then((b) => {
      if (!live) return;
      setBlob(b);
      if (b) setUrl(URL.createObjectURL(b));
      else setNote(t("Couldn't draw the image in this browser."));
    });
    return () => {
      live = false;
    };
  }, [open, spec, t]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const file = blob ? new File([blob], `${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-deeparam.png`, { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

  return (
    <>
      <button type="button" className="share-btn" onClick={() => setOpen(true)}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
        <span>{t(label)}</span>
      </button>
      {open && (
        <dialog
          className="share-sheet"
          aria-label={t("Share image")}
          ref={(d) => {
            if (d && !d.open) d.showModal();
          }}
          onClose={() => {
            setOpen(false);
            setBlob(null);
            setUrl("");
          }}
          onClick={(e) => e.target === e.currentTarget && (e.currentTarget as HTMLDialogElement).close()}
        >
          <div className="share-inner">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={t("Share image for {title}", { title: spec.title })} width={1200} height={630} />
            ) : (
              <div className="share-wait" aria-live="polite">
                {note || t("Drawing…")}
              </div>
            )}
            <div className="share-actions">
              {canShare && (
                <button type="button" className="btn" onClick={() => navigator.share({ files: [file!], url: spec.url }).catch(() => {})}>
                  {t("Share")}
                </button>
              )}
              {blob && typeof ClipboardItem !== "undefined" && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    navigator.clipboard
                      .write([new ClipboardItem({ "image/png": blob })])
                      .then(() => {
                        buzz("done");
                        setNote(t("Copied."));
                      })
                      .catch(() => setNote(t("This browser can't copy images. Save it instead.")))
                  }
                >
                  {t("Copy image")}
                </button>
              )}
              {url && file && (
                <a className="btn ghost" href={url} download={file.name}>
                  {t("Save")}
                </a>
              )}
              <button type="button" className="share-close" onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement).close()}>
                {t("Close")}
              </button>
            </div>
            {note && url && <p className="share-note">{note}</p>}
          </div>
        </dialog>
      )}
    </>
  );
}
