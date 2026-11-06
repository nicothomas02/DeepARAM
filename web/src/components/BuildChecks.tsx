"use client";

import { useMemo, useState } from "react";
import type { CheckKind, Finding, Named } from "@/lib/checks";
import { foldName } from "@/lib/fold";
import { EmptyState } from "./EmptyState";
import { useNames, useT } from "./I18n";

// The Kitchen's Traps and Bug finder tabs (lib/checks.ts). Traps: builds that look great on paper and fall flat in
// real games. Bug finder: interactions that might be broken, each with how to test it in game.

const KIND_LABEL: Record<CheckKind, string> = {
  loop: "Stat loop",
  gap: "Missing augment",
  sim: "Simulator vs real games",
  wasted: "Does nothing",
};
// Champions shown on a card before "+N more".
const SHOWN = 14;

export default function BuildChecks({ mode, findings }: { mode: "traps" | "bugs"; findings: Finding[] }) {
  const t = useT("checks");
  const names = useNames();
  const [kind, setKind] = useState<CheckKind | "all">("all");
  const [query, setQuery] = useState("");
  const q = foldName(query);
  const kinds = useMemo(() => [...new Set(findings.map((f) => f.kind))], [findings]);
  const shown = findings.filter(
    (f) =>
      (kind === "all" || f.kind === kind) &&
      (!q ||
        foldName([f.title, ...f.champions.flatMap((c) => [c.name, names("champions", c.id, c.name)]), ...f.augments.map((a) => names("augments", a.id, a.name)), ...f.items.map((i) => names("items", i.id, i.name))].join(" ")).includes(q)),
  );

  return (
    <>
      <p className="subtab-note">
        {mode === "traps"
          ? t("Builds and combos that look great on paper but don't hold up in real games. Check here before you try a theorycraft build.")
          : t("Interactions that might be broken. Each one says what should happen on paper and how to test it in a game. If it really is broken, report it to Riot from the client so it gets fixed.")}
      </p>
      <div className="checks-bar">
        {kinds.length > 1 && (
          <div className="helper-threats" role="group" aria-label={t("Show")}>
            <button type="button" className="chip-toggle" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
              {t("All")}
            </button>
            {kinds.map((k) => (
              <button key={k} type="button" className="chip-toggle" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(KIND_LABEL[k])}
              </button>
            ))}
          </div>
        )}
        <input className="checks-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Find a champion or augment")} aria-label={t("Find a champion or augment")} />
      </div>
      {shown.length === 0 ? (
        <EmptyState title={findings.length ? t("Nothing matches") : mode === "traps" ? t("No traps found this patch") : t("Nothing to test this patch")} />
      ) : (
        <div className="checks-list">
          {shown.map((f) => (
            <Card key={f.id} f={f} />
          ))}
        </div>
      )}
    </>
  );
}

function Card({ f }: { f: Finding }) {
  const t = useT("checks");
  const names = useNames();
  const [all, setAll] = useState(false);
  const champs = all ? f.champions : f.champions.slice(0, SHOWN);
  const status = f.status === "trap" ? t("Trap") : f.status === "confirmed" ? t("Confirmed bug") : t("Needs a test");
  return (
    <article className="card checks-card" id={f.id}>
      <div className="checks-head">
        <h3>{f.title}</h3>
        <span className={`tag ${f.status === "trap" ? "tag-nerf" : f.status === "confirmed" ? "tag-nerf" : "tag-mixed"}`}>{status}</span>
        <span className="tag">{t(KIND_LABEL[f.kind])}</span>
      </div>
      {(f.augments.length > 0 || f.items.length > 0) && (
        <div className="checks-things">
          {f.augments.map((a) => (
            <Thing key={`a${a.id}`} n={a} name={names("augments", a.id, a.name)} />
          ))}
          {f.items.map((i) => (
            <Thing key={`i${i.id}`} n={i} name={names("items", i.id, i.name)} />
          ))}
        </div>
      )}
      {f.champions.length > 0 && (
        <div className="checks-champs">
          {champs.map((c) => (
            <ChampIcon key={c.id} c={c} name={names("champions", c.id, c.name)} />
          ))}
          {f.champions.length > SHOWN && (
            <button type="button" className="chip-toggle" onClick={() => setAll(!all)}>
              {all ? t("Show less") : t("+{n} more", { n: f.champions.length - SHOWN })}
            </button>
          )}
        </div>
      )}
      <p>
        <strong>{t("On paper")}:</strong> {f.theory}
      </p>
      {f.practice && (
        <p>
          <strong>{t("In game")}:</strong> {f.practice}
        </p>
      )}
      {f.test && f.status !== "trap" && (
        <p>
          <strong>{t("How to test")}:</strong> {f.test}
        </p>
      )}
    </article>
  );
}

function Thing({ n, name }: { n: Named; name: string }) {
  const body = (
    <>
      {n.icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={n.icon} alt="" width={28} height={28} loading="lazy" />
      )}
      <span>{name}</span>
    </>
  );
  return n.href ? (
    <a className="checks-thing" href={n.href}>
      {body}
    </a>
  ) : (
    <span className="checks-thing">{body}</span>
  );
}

function ChampIcon({ c, name }: { c: Named; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img className="champ-icon" src={c.icon} alt={name} title={name} width={32} height={32} loading="lazy" />;
  return c.href ? <a href={c.href}>{img}</a> : img;
}
