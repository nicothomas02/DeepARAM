"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalDate, useNames, useT } from "./I18n";

// On /account: the builds a player sent to The Kitchen from the Simulator (with Delete), and for the
// site owner the review queue (Approve / Reject). Shows nothing to signed-out visitors or players who
// never sent one. API: /api/kitchen/submissions (lib/kitchen.ts).

type Part = { id: number; name: string };
type Build = {
  id: string; champion: string; championName: string; items: Part[]; augments: Part[]; title: string; description: string;
  status: string; created: string; by?: string | null; sim?: { mean_dps?: number; survival_rate?: number; trials?: number; enemy?: string };
};

async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
  return j;
}

function BuildRow({ b, children }: { b: Build; children?: React.ReactNode }) {
  const t = useT("kitchen");
  const name = useNames();
  return (
    <li className="kitchen-sub">
      <p>
        <b>{b.title}</b> · {name("champions", b.champion, b.championName)} · <LocalDate iso={b.created.slice(0, 10)} />
      </p>
      <p className="acct-hint">{b.description}</p>
      <p className="acct-hint">
        {b.items.map((i) => name("items", i.id, i.name)).join(", ")}
        {b.augments.length > 0 && <> · {b.augments.map((a) => name("augments", a.id, a.name)).join(", ")}</>}
      </p>
      {b.sim && (
        <p className="acct-hint">
          {t("Simulator: {dps} DPS, survives {pct}", { dps: Math.round(b.sim.mean_dps ?? 0), pct: `${Math.round((b.sim.survival_rate ?? 0) * 100)}%` })}
        </p>
      )}
      {children}
    </li>
  );
}

export default function KitchenSubmissions() {
  const t = useT("kitchen");
  const [data, setData] = useState<{ mine: Build[]; queue?: Build[] } | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setData((await call("/api/kitchen/submissions")) as { mine: Build[]; queue?: Build[] });
    } catch {
      setData(null); // signed out, or not available here
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (url: string, init: RequestInit, done: string) => {
    try {
      await call(url, init);
      setMsg(done);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  if (!data || (!data.mine.length && !data.queue?.length)) return null;
  const status: Record<string, string> = { pending: t("Waiting for review"), approved: t("In The Kitchen"), rejected: t("Not picked") };

  return (
    <div id="kitchen" className="acct-grid kitchen-subs">
      {data.queue && (
        <section className="card acct-card" data-accent="lab">
          <h2>{t("Kitchen review queue")}</h2>
          {data.queue.length ? (
            <ul className="acct-list">
              {data.queue.map((b) => (
                <BuildRow key={b.id} b={b}>
                  <p className="acct-hint">{t("From {name}", { name: b.by || t("a player with no display name") })}</p>
                  <div className="kitchen-sub-actions">
                    <button type="button" className="btn" onClick={() => act(`/api/kitchen/submissions/${b.id}`, { method: "POST", body: JSON.stringify({ action: "approve" }) }, t("Approved. It's in The Kitchen."))}>
                      {t("Approve")}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => act(`/api/kitchen/submissions/${b.id}`, { method: "POST", body: JSON.stringify({ action: "reject" }) }, t("Rejected."))}>
                      {t("Reject")}
                    </button>
                  </div>
                </BuildRow>
              ))}
            </ul>
          ) : (
            <p className="acct-hint">{t("No builds waiting.")}</p>
          )}
        </section>
      )}
      {data.mine.length > 0 && (
        <section className="card acct-card" data-accent="lab">
          <h2>{t("Your Kitchen builds")}</h2>
          <p className="acct-hint">{t("Approved builds show in The Kitchen's Community section with your display name.")}</p>
          <ul className="acct-list">
            {data.mine.map((b) => (
              <BuildRow key={b.id} b={{ ...b, sim: undefined }}>
                <div className="kitchen-sub-actions">
                  <small>{status[b.status] ?? b.status}</small>
                  <button type="button" className="btn ghost" onClick={() => confirm(t("Delete this build?")) && act(`/api/kitchen/submissions/${b.id}`, { method: "DELETE" }, t("Deleted."))}>
                    {t("Delete")}
                  </button>
                </div>
              </BuildRow>
            ))}
          </ul>
        </section>
      )}
      {msg && <p className="acct-hint" role="status">{msg}</p>}
    </div>
  );
}
