"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { AugmentGemRow, GemCheck, GemFamily, HiddenGems as Data, ItemGemRow, SimCheck } from "@/lib/hidden-gems";
import { useNames, useT } from "./I18n";

// The Tier List's Hidden gems tab (?tab=hidden-gems): choices few players make on a champion that still win clearly
// more than its usual ones (lib/hidden-gems.ts, data/estimates/synergies.py). Items show their lift in win rate
// points with a next-patch range; augments show only their grade and order (no augment win rates on the site).

const TITLES: Record<GemFamily, string> = {
  starting: "Starting items",
  boots: "Boots",
  core: "First three items",
  other: "Items",
  full_builds: "Full builds",
};

const SIM: Record<SimCheck, string> = { agrees: "Agrees", disagrees: "Disagrees", "no gain": "No gain", "not simulated": "Not simulated" };

const CAUTION = "check in game";
const CAUTION_HINT = "\"Check in game\" means the Bug finder flagged something worth testing first.";

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

function ItemTable({ family, rows }: { family: GemFamily; rows: ItemGemRow[] }) {
  const t = useT("hidden-gems");
  const names = useNames();
  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    { key: "choice", label: t(family === "full_builds" ? "Build" : "Pick"), format: "items", iconKey: "icons", hrefKey: "hrefs", sortable: false },
    { key: "pickRate", label: t("Picked by"), format: "pct", hint: t("Share of the champion's players who take it.") },
    {
      key: "forecast",
      label: t("Expected edge"),
      format: "pts",
      phone: "hide",
      hint: t("Estimated. How much more it should win next patch than the champion's usual pick for this slot."),
    },
    {
      key: "forecastLo",
      label: t("At least"),
      format: "pts",
      hint: t("The low end of the 90% range for next patch. For every hidden gem it's above zero."),
    },
    { key: "winRate", label: t("Win rate"), format: "pct", phone: "hide" },
    {
      key: "lift",
      label: t("This patch"),
      format: "pts",
      phone: "hide",
      hint: t("Win rate minus the champion's usual for this slot, this patch so far."),
    },
    { key: "games", label: t("Games"), format: "int", phone: "hide", hint: t("Estimated.") },
    {
      key: "sim",
      label: t("Simulator"),
      format: "text",
      phone: "hide",
      hint: t(
        "Checked in the Simulator against the champion's usual build: Agrees, or Disagrees when it scores more than 15% lower. Starting items and items it doesn't model aren't simulated.",
      ) +
        " " +
        t(CAUTION_HINT),
    },
  ];
  const data: Row[] = rows.map((r) => ({
    champion: r.champion,
    choice: r.items.map((i) => names("items", i.id, i.name)).join("|"),
    icons: r.items.map((i) => i.icon).join("|"),
    hrefs: r.items.map((i) => i.href ?? "").join("|"),
    pickRate: r.pickRate,
    forecast: r.forecast,
    forecastLo: r.forecastLo,
    winRate: r.winRate,
    lift: r.lift,
    games: r.games,
    sim: r.caution ? `${t(SIM[r.sim])} · ${t(CAUTION)}` : t(SIM[r.sim]),
  }));
  return (
    <section className="gems-section">
      <h3>{t(TITLES[family])}</h3>
      <DataTable columns={columns} rows={data} initialSort={{ key: "forecastLo", desc: true }} searchKey="champion" searchLabel={t("Find a champion")} />
    </section>
  );
}

function AugmentTable({ rows }: { rows: AugmentGemRow[] }) {
  const t = useT("hidden-gems");
  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    { key: "augment", label: t("Augment"), format: "augment", iconKey: "id", hrefKey: "href" },
    { key: "grade", label: t("Grade"), format: "tier", sortKey: "gradeOrder", hint: t("Its grade on this champion, from game results.") },
    { key: "pickRate", label: t("Picked by"), format: "pct", hint: t("Share of the champion's players who take it.") },
    { key: "rank", label: t("Order"), format: "int", hint: t("Estimated. Most promising first.") },
    {
      key: "sim",
      label: t("Simulator"),
      format: "text",
      phone: "hide",
      hint: t(
        "Checked in the Simulator on the champion's usual build: Agrees when the augment helps, No gain when the fight can't show what it does. Augments that make the champion worse are left out.",
      ) +
        " " +
        t(CAUTION_HINT),
    },
  ];
  const data: Row[] = rows.map((r) => ({
    champion: r.champion,
    augment: r.name,
    id: r.id,
    href: r.href,
    grade: r.grade,
    gradeOrder: r.grade === "S" ? 2 : 1,
    pickRate: r.pickRate,
    rank: r.rank,
    sim: r.caution ? `${t(SIM[r.sim])} · ${t(CAUTION)}` : t(SIM[r.sim]),
  }));
  return (
    <section className="gems-section">
      <h3>{t("Augments")}</h3>
      <p className="patch-note">
        {t("Augments graded S or A on a champion that few of its players take, most promising first. Estimated: no win rates are shown for augments.")}
      </p>
      <DataTable columns={columns} rows={data} initialSort={{ key: "rank", desc: false }} searchKey="champion" searchLabel={t("Find a champion")} />
    </section>
  );
}

function Checks({ checks, on }: { checks: GemCheck[]; on: string[] | null }) {
  const t = useT("hidden-gems");
  if (!checks.length || !on) return null;
  return (
    <details className="how-rankings gems-how">
      <summary>{t("How hidden gems are found")}</summary>
      <p>
        {t(
          "Each choice is compared with the champion's other options for the same slot. A big lead on a rare choice partly fades next patch, so the lead is turned into a next-patch forecast with a 90% range, fitted on how much of each rare choice's lead carried over from patch {from} to {to}. Only choices whose whole range is above zero are listed.",
          { from: on[0], to: on[1] },
        )}
      </p>
      <p>
        {t(
          "Ranges from sample size alone are far too narrow: games change between patches much more than the sample noise says. Checked on champions left out of the fit:",
        )}
      </p>
      <ul>
        {checks.map((c) => (
          <li key={c.family}>
            <b>{t(TITLES[c.family])}</b>
            {": "}
            {t("next patch's result landed inside the 90% range {coverage} of the time (a range from sample size alone: {naive}).", {
              coverage: pct(c.coverage),
              naive: pct(c.naive),
            })}
            {c.flagged > 0 && c.stillAhead != null && c.everyRare != null && (
              <>
                {" "}
                {t("{ahead} of the {n} hidden gems found then still beat the usual pick, against {every} of all rare choices.", {
                  ahead: pct(c.stillAhead),
                  n: c.flagged,
                  every: pct(c.everyRare),
                })}
              </>
            )}
          </li>
        ))}
      </ul>
      <p>
        {t(
          "Before a gem is listed, every item must still be sold in the shop and not be one only an augment gives, and every augment must still be in the pool and not make the champion worse in the Simulator. The Simulator column shows whether a fight in the Simulator backs it up.",
        )}{" "}
        {t("Nothing on the Traps list, and no augment the champion can't be offered, is listed either.")}
      </p>
      <p>{t("A hidden gem wins more in practice, which doesn't prove it causes the wins: the players who pick it may differ too.")}</p>
    </details>
  );
}

export default function HiddenGems({ data }: { data: Data }) {
  const t = useT("hidden-gems");
  const families = (Object.keys(TITLES) as GemFamily[]).filter((f) => data.items[f]?.length);
  return (
    <>
      <p className="subtab-note">
        <span className="tag tag-mixed" title={t("Estimated from this patch's games.")}>
          {t("Estimated")}
        </span>
      </p>
      <p className="patch-note subtab-note">
        {t("Choices fewer than {share} of a champion's players make that still win clearly more than its usual ones.", { share: pct(data.maxPick) })}
      </p>
      <Checks checks={data.checks} on={data.checkedOn} />
      {families.map((f) => (
        <ItemTable key={f} family={f} rows={data.items[f]!} />
      ))}
      {data.augments.length > 0 && <AugmentTable rows={data.augments} />}
    </>
  );
}
