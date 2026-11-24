"use client";

import { useCallback, useEffect, useState } from "react";
import { ACCOUNT_EVENT, signedIn } from "@/lib/account-sync";
import Link from "next/link";
import { useT } from "./I18n";

// My Stats on the account page (/account#my-stats), under the account cards. Signed in, it shows the stats
// dashboard; signed out, a line pointing at the sign-in card above. The games themselves stay on the
// player's computer (the dashboard reads them from the local helper), unless the owner saves them to the account.
// Mayhem Stats' one-click connect opens /account?connect=<id>#my-stats; the request waits here (kept in this
// tab across signing in) until the player confirms it (lib/riot-pair.ts).
const PAIR_KEY = "deeparam-connect";

function takePair(): string | null {
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("connect");
    if (fromUrl && /^[A-Za-z0-9_-]{32}$/.test(fromUrl)) {
      sessionStorage.setItem(PAIR_KEY, fromUrl);
      url.searchParams.delete("connect");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
    return sessionStorage.getItem(PAIR_KEY);
  } catch {
    return null;
  }
}

function dropPair() {
  try {
    sessionStorage.removeItem(PAIR_KEY);
  } catch {
    /* nothing kept */
  }
}

type PairInfo = { riotId: string; done: boolean; owner: boolean };

function ConnectCard({ pair, onDone }: { pair: string; onDone: () => void }) {
  const t = useT("stats");
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [save, setSave] = useState(true);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/account/connect?pair=${encodeURIComponent(pair)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) setInfo(j as PairInfo);
        else {
          dropPair();
          setMsg({ ok: false, text: t(j.error || "Something went wrong. Try again.") });
        }
      })
      .catch(() => live && setMsg({ ok: false, text: t("Something went wrong. Try again.") }));
    return () => {
      live = false;
    };
  }, [pair, t]);

  const connect = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/account/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair, save: !!info?.owner && save, share }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(t(j.error || "Something went wrong. Try again."));
      dropPair();
      setInfo(null);
      const done = info?.owner && save
        ? t("Connected {riotId}. Mayhem Stats on your computer now saves your games here; go back to it to watch it finish.", { riotId: j.riotId })
        : t("Connected {riotId}. You can go back to Mayhem Stats.", { riotId: j.riotId });
      setMsg({ ok: true, text: share ? `${done} ${t("Mayhem Stats starts sharing your games anonymously. You can turn it off there at any time.")}` : done });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    dropPair();
    onDone();
  };

  return (
    <div className="card my-stats-connect" role="region" aria-label={t("Connect Mayhem Stats")}>
      <h3>{t("Connect Mayhem Stats")}</h3>
      {info && !info.done && (
        <>
          <p>{t("Connect the Riot account {riotId} to this deeparam.com account?", { riotId: info.riotId })}</p>
          {info.owner && (
            <label className="my-stats-check">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              {t("Also save my Mayhem games to this account, so My Stats shows them on any device. Only you can see them.")}
            </label>
          )}
          <label className="my-stats-check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            {t("Share my games anonymously to help build stats for everyone")}
          </label>
          <p className="acct-hint">
            {t("Off unless you tick it. Shared games carry champions, items, augments, runes, spells, results and each player's gold and experience minute by minute, never names or account ids. Turning it off in Mayhem Stats removes everything you shared.")}
          </p>
          <div className="my-stats-actions">
            <button type="button" className="btn" disabled={busy} onClick={connect}>
              {t("Connect")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={cancel}>
              {t("Not now")}
            </button>
          </div>
        </>
      )}
      {info?.done && <p>{t("This Riot account is already connected. You can go back to Mayhem Stats.")}</p>}
      {msg && (
        <p className={`acct-note ${msg.ok ? "ok" : "error"}`} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

export default function MyStatsSection() {
  const t = useT("stats");
  const [inside, setInside] = useState<boolean | null>(null);
  const [pair, setPair] = useState<string | null>(null);
  const clearPair = useCallback(() => setPair(null), []);

  useEffect(() => setPair(takePair()), []);

  useEffect(() => {
    const update = () => setInside(signedIn());
    update();
    addEventListener(ACCOUNT_EVENT, update);
    return () => removeEventListener(ACCOUNT_EVENT, update);
  }, []);

  // The section appears after the page loads, so a link to #my-stats scrolls once it's there.
  useEffect(() => {
    if (inside !== null && location.hash === "#my-stats") document.getElementById("my-stats")?.scrollIntoView();
  }, [inside]);

  if (inside === null) return null;
  // The stats dashboard moved to the desktop apps (Nico, 2026-11-24: "App has taken over my stats"); the section keeps
  // the one-click connect and a link to the app.
  return (
    <section id="my-stats" className="my-stats">
      <h2>{t("My Stats")}</h2>
      {pair && inside && <ConnectCard pair={pair} onDone={clearPair} />}
      {pair && !inside ? (
        <p className="lede">{t("Sign in above to connect Mayhem Stats. You'll be asked to confirm right after.")}</p>
      ) : (
        <p className="lede">
          {t("Your Mayhem games, win rate and matches are in the DeepARAM desktop app now.")}{" "}
          <Link href="/download">{t("Get the app →")}</Link>
        </p>
      )}
    </section>
  );
}
