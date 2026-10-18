"use client";

import { useState } from "react";
import { useBotCheck } from "@/lib/bot-check-client";
import { useT } from "./I18n";

const EMAIL = "admin@deeparam.com";

/** The footer's "Found a bug?" box: write a message here (it waits for the owner on /account) or email us. */
export default function FeedbackBox() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className="feedback-box" aria-label={t("Feedback")}>
      <div>
        <b>{t("Found a bug? Want a feature added?")}</b>
        <span>{t("Send it our way. Ideas from players shape what we build next.")}</span>
      </div>
      <div className="feedback-actions">
        <button type="button" className="feedback-mail" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t("Write to us")}
        </button>
        <a className="feedback-alt" href={`mailto:${EMAIL}?subject=${encodeURIComponent("DeepARAM feedback")}`}>
          {t("Email {email}", { email: EMAIL })}
        </a>
      </div>
      {/* Mounted only when opened, so the bot check loads only for people who write. */}
      {open && <FeedbackForm onDone={() => setOpen(false)} />}
    </section>
  );
}

function FeedbackForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const bot = useBotCheck();
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({});

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, replyTo, page: location.pathname, check: bot.token }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      bot.reset();
      if (!r.ok) return setState({ error: j.error ? t(j.error) : t("Something went wrong. Try again.") });
      setMessage("");
      setState({ sent: true });
    } catch {
      setState({ error: t("Something went wrong. Try again.") });
    }
  };

  if (state.sent)
    return (
      <div className="feedback-form" role="status">
        <p>{t("Thanks! Your message is on its way.")}</p>
        <button type="button" className="btn ghost" onClick={onDone}>
          {t("Close")}
        </button>
      </div>
    );

  return (
    <form className="feedback-form" onSubmit={send}>
      <label>
        <span>{t("Your message")}</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} maxLength={2000} rows={4} />
      </label>
      <label>
        <span>{t("Your email, if you'd like a reply (optional)")}</span>
        <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} maxLength={200} autoComplete="email" />
      </label>
      <div ref={bot.box} />
      <div className="feedback-form-actions">
        <button type="submit" className="feedback-mail" disabled={state.busy || message.trim().length < 5}>
          {state.busy ? t("Sending…") : t("Send")}
        </button>
        {state.error && (
          <span className="feedback-error" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
