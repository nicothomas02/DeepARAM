"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalDate, useT } from "./I18n";

// On /account, for the site owner only: messages people wrote in the footer's Contact us box, newest
// first, with Reply (opens an email when they left an address) and Delete. API: /api/contact (lib/contact.ts).

type Message = { id: string; message: string; replyTo: string | null; page: string | null; by: string | null; created: string };

export default function ContactMessages() {
  const t = useT("account");
  const [list, setList] = useState<Message[] | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/contact", { credentials: "same-origin" }).catch(() => null);
    setList(r?.ok ? ((await r.json()) as { messages: Message[] }).messages : null); // null: not the owner, or signed out
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm(t("Delete this message?"))) return;
    const r = await fetch(`/api/contact?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    setNote(r?.ok ? t("Deleted.") : t("Something went wrong. Try again."));
    await load();
  };

  if (!list) return null;
  return (
    <div id="messages" className="acct-grid">
      <section className="card acct-card">
        <h2>{t("Messages")}</h2>
        <p className="acct-hint">{t("What people wrote in the Contact us box at the bottom of every page.")}</p>
        {list.length ? (
          <ul className="acct-list">
            {list.map((m) => (
              <li key={m.id} className="contact-msg">
                <p className="acct-hint">
                  <LocalDate iso={m.created.slice(0, 10)} />
                  {m.by && <> · {m.by}</>}
                  {m.page && <> · {m.page}</>}
                </p>
                <p className="contact-msg-text">{m.message}</p>
                <div className="kitchen-sub-actions">
                  {m.replyTo ? (
                    <a className="btn" href={`mailto:${m.replyTo}?subject=${encodeURIComponent("Re: your DeepARAM message")}`}>
                      {t("Reply to {email}", { email: m.replyTo })}
                    </a>
                  ) : (
                    <small>{t("No email left for a reply")}</small>
                  )}
                  <button type="button" className="btn ghost" onClick={() => remove(m.id)}>
                    {t("Delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acct-hint">{t("No messages yet.")}</p>
        )}
        {note && (
          <p className="acct-hint" role="status">
            {note}
          </p>
        )}
      </section>
    </div>
  );
}
