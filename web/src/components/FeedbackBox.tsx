"use client";

import { useState } from "react";
import { useBotCheck } from "@/lib/bot-check-client";
import { useT } from "./I18n";

const EMAIL = "admin@deeparam.com";
const SUBJECT = "DeepARAM feedback";
const q = encodeURIComponent;

// Where "Email us" opens. Gmail in a new tab is picked first; the mail app goes through mailto:.
const MAILERS = [
  { id: "gmail", label: "Gmail (new tab)", href: `https://mail.google.com/mail/?view=cm&fs=1&to=${q(EMAIL)}&su=${q(SUBJECT)}`, tab: true },
  { id: "outlook", label: "Outlook.com (new tab)", href: `https://outlook.live.com/mail/0/deeplink/compose?to=${q(EMAIL)}&subject=${q(SUBJECT)}`, tab: true },
  { id: "app", label: "Mail app (Outlook, Apple Mail and others)", href: `mailto:${EMAIL}?subject=${q(SUBJECT)}`, tab: false },
] as const;

/** The footer's "Found a bug?" box: write a message here (it waits for the owner on /account) or email us, opened where the visitor picks. */
export default function FeedbackBox() {
  const t = useT();
  const [open, setOpen] = useState<"write" | "email" | null>(null);
  return (
    <section className="feedback-box" aria-label={t("Feedback")}>
      <div>
        <b>{t("Found a bug? Want a feature added?")}</b>
        <span>{t("Send it our way. Ideas from players shape what we build next.")}</span>
      </div>
      <div className="feedback-actions">
        <button type="button" className="feedback-mail" aria-expanded={open === "write"} onClick={() => setOpen(open === "write" ? null : "write")}>
          {t("Write to us")}
        </button>
        <button type="button" className="feedback-alt" aria-expanded={open === "email"} onClick={() => setOpen(open === "email" ? null : "email")}>
          {t("Email {email}", { email: EMAIL })}
        </button>
      </div>
      {/* Mounted only when opened, so the bot check loads only for people who write. */}
      {open === "write" && <FeedbackForm onDone={() => setOpen(null)} />}
      {open === "email" && <EmailPicker />}
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

function EmailPicker() {
  const t = useT();
  const [pick, setPick] = useState<string>("gmail");
  const [copied, setCopied] = useState(false);
  const chosen = MAILERS.find((m) => m.id === pick) ?? MAILERS[0];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="feedback-form">
      <fieldset className="feedback-mailers">
        <legend>{t("Where should we open your email?")}</legend>
        {MAILERS.map((m) => (
          <label key={m.id}>
            <input type="radio" name="mailer" value={m.id} checked={pick === m.id} onChange={() => setPick(m.id)} />
            {t(m.label)}
          </label>
        ))}
      </fieldset>
      <div className="feedback-form-actions">
        <a className="feedback-mail" href={chosen.href} {...(chosen.tab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {t("Open email")}
        </a>
        <button type="button" className="btn ghost" onClick={copy}>
          {copied ? t("Copied!") : t("Copy address")}
        </button>
      </div>
    </div>
  );
}
