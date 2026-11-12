"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBotCheck } from "@/lib/bot-check-client";
import { useT } from "./I18n";
import { OPEN_SEARCH } from "./SearchPalette";

const EMAIL = "admin@deeparam.com";
// Ids of messages sent from this browser, so the box can say when one has an answer on /answers.
const SENT_KEY = "deeparam-sent-messages";

function sentIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberSent(id: string) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify([...sentIds(), id].slice(-20)));
  } catch {
    // Private mode or blocked storage: the answer is still on /answers.
  }
}

/** The newest message from this browser that has an answer, if any. */
function useAnswered() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const mine = sentIds();
    if (!mine.length) return;
    fetch("/answers/ids")
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: string[]) => setId([...mine].reverse().find((m) => ids.includes(m)) ?? null))
      .catch(() => {});
  }, []);
  return id;
}

/** The footer's "Found a bug?" box: write a message here (it waits for the owner on /account) or follow the mailto link. */
export default function FeedbackBox() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const answered = useAnswered();
  return (
    <section className="feedback-box" aria-label={t("Feedback")}>
      <div>
        <b>{t("Found a bug? Want a feature added?")}</b>
        <span>{t("Send it our way. Ideas from players shape what we build next.")}</span>
        {answered ? (
          <Link href={`/answers#a-${answered}`} className="feedback-answered">
            {t("We answered your message. See the answer")}
          </Link>
        ) : (
          <Link href="/answers" className="feedback-answers">
            {t("See answers to player questions")}
          </Link>
        )}
      </div>
      <div className="feedback-actions">
        <button type="button" className="feedback-mail" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t("Write to us")}
        </button>
        <span className="feedback-alt">
          {t("Or shoot us an email at")} <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </span>
      </div>
      {/* Mounted only when opened, so the bot check loads only for people who write. */}
      {open && <FeedbackForm onDone={() => setOpen(false)} />}
    </section>
  );
}

/** One to three words and no sentence punctuation: likely a champion, augment or item name. */
export const looksLikeSearch = (m: string) => {
  const v = m.trim();
  return v.length >= 2 && v.length <= 40 && v.split(/\s+/).length <= 3 && !/[?!.]/.test(v);
};

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
      const j = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
      bot.reset();
      if (!r.ok) return setState({ error: j.error ? t(j.error) : t("Something went wrong. Try again.") });
      if (j.id) rememberSent(j.id);
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
        <p>{t("We answer on the Answers page, without your name. This box will show a link when yours is up.")}</p>
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
      {/* A message of a word or three is usually a search typed in the wrong box: offer the site search. */}
      {looksLikeSearch(message) && (
        <button type="button" className="feedback-search" onClick={() => dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: message.trim() }))}>
          {t("Looking for a page? Search for “{q}”", { q: message.trim() })}
        </button>
      )}
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
