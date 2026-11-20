"use client";

import { useEffect, useMemo, useState } from "react";
import championNames from "@/data/champion-names.json";
import Skeleton from "@/components/Skeleton";
import { LoadError } from "@/components/EmptyState";
import RowLink from "@/components/RowLink";
import { useNames, useT } from "./I18n";
import { getParam, setParams } from "@/lib/url-state";
import { rankPicks, type Pick, type TeamFitData } from "@/lib/team-fit-score";

// "Best pick": under the Tier List's Champions tab (ChampionsPanel, ?cview=team). Add the champions already on your
// team, and optionally the ones you can pick (bench or rerolls); it ranks the picks by strength (lib/team-fit-score.ts,
// the same scoring the desktop app uses; pair fit didn't predict wins better, so it doesn't rank). Loads /data/team-fit.json when
// first opened. The team and choices are kept in the link (?team=Lux,Vi&opts=Jinx,Nami).

const NAMES = championNames as Record<string, string>;
const MAX_TEAM = 4;
const MAX_OPTS = 12;
const SHOWN = 8;

const pts = (n: number) =>
  Math.abs(n) < 0.0005
    ? "0.0"
    : `${n > 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}`;
const listParam = (k: string) => (getParam(k) ?? "").split(",").filter(Boolean);

export default function TeamFit({ version }: { version: string }) {
  const t = useT("tier-list");
  const names = useNames();
  const [data, setData] = useState<TeamFitData | null>(null);
  const [failed, setFailed] = useState(false);
  const [team, setTeam] = useState<string[]>([]);
  const [opts, setOpts] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/data/team-fit.json?v=${version}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
    setTeam(listParam("team").slice(0, MAX_TEAM));
    setOpts(listParam("opts").slice(0, MAX_OPTS));
  }, [version]);

  const label = (id: string) =>
    names("champions", id, NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const all = useMemo(
    () =>
      data
        ? Object.keys(data.champions).sort((a, b) =>
            label(a).localeCompare(label(b)),
          )
        : [],
    [data],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const byLabel = useMemo(
    () => new Map(all.map((id) => [label(id).toLowerCase(), id])),
    [all],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data)
    return failed ? (
      <LoadError what={t("Best pick")} />
    ) : (
      <Skeleton rows={6} label={t("Loading…")} />
    );

  const save = (nextTeam: string[], nextOpts: string[]) => {
    setTeam(nextTeam);
    setOpts(nextOpts);
    setParams({
      team: nextTeam.join(",") || null,
      opts: nextOpts.join(",") || null,
    });
  };
  const picks = rankPicks(data, team, opts).slice(
    0,
    opts.length ? MAX_OPTS : SHOWN,
  );

  const reason = (p: Pick) =>
    p.strength >= 0.01 ? t("Strong this patch") : "";

  const picker = (
    which: "team" | "opts",
    list: string[],
    max: number,
    placeholder: string,
  ) => (
    <div className="tf-group">
      <div className="tf-chips">
        {list.map((id) => (
          <button
            key={id}
            type="button"
            className="tf-chip"
            title={t("Remove")}
            onClick={() =>
              which === "team"
                ? save(
                    list.filter((x) => x !== id),
                    opts,
                  )
                : save(
                    team,
                    list.filter((x) => x !== id),
                  )
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/icons/champions/${id}.webp`}
              alt=""
              width={24}
              height={24}
            />
            {label(id)} <span aria-hidden="true">×</span>
          </button>
        ))}
        {list.length < max && (
          <input
            className="tf-input"
            list="tf-champions"
            placeholder={t(placeholder)}
            aria-label={t(placeholder)}
            onChange={(e) => {
              const id = byLabel.get(e.target.value.trim().toLowerCase());
              if (!id || list.includes(id)) return;
              e.target.value = "";
              if (which === "team")
                save(
                  [...list, id],
                  opts.filter((x) => x !== id),
                );
              else save(team, [...list, id]);
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="team-fit">
      <p className="patch-note subtab-note">
        {t(
          "Add the champions already on your team, and the ones you can pick (your bench or rerolls) if you like. Picks are ranked by how strong they are this patch plus how well they pair with your team.",
        )}
      </p>
      <datalist id="tf-champions">
        {all.map((id) => (
          <option key={id} value={label(id)} />
        ))}
      </datalist>
      <h3 className="tf-h">{t("Your team")}</h3>
      {picker("team", team, MAX_TEAM, "Add a teammate")}
      <h3 className="tf-h">{t("Your choices (optional)")}</h3>
      {picker("opts", opts, MAX_OPTS, "Add a champion you can pick")}
      <h3 className="tf-h">
        {opts.length ? t("Your choices, best first") : t("Best picks")}
      </h3>
      <ol className="tf-list">
        {picks.map((p) => (
          <li key={p.id} className="tf-row">
            <RowLink className="tf-champ" href={`/champions/${p.id}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/icons/champions/${p.id}.webp`}
                alt=""
                width={32}
                height={32}
                loading="lazy"
              />
              <span>{label(p.id)}</span>
            </RowLink>
            <span className="tf-why">{reason(p)}</span>
            <span
              className="tf-nums"
              title={t(
                "Strength: expected win rate this patch over 50%, in win-rate points.",
              )}
            >
              <span>{t("Strength {n}", { n: pts(p.strength) })}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="patch-note">
        {t(
          "Ranked by each champion's strength. We tested adding how champions pair with your team, and it didn't predict wins any better, so it's left out.",
        )}
      </p>
    </div>
  );
}
