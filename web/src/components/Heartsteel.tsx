/* eslint-disable @next/next/no-img-element -- small local icons */
"use client";

import DataTable, { type Column, type Row } from "@/components/DataTable";
import type { HeartsteelRow, StickerSummary } from "@/lib/heartsteel";
import { useNames, useT } from "./I18n";

// The Tier List's HEARTSTEEL tab (?tab=heartsteel, lib/heartsteel.ts): the six stickers ranked on their own, then the
// best sticker for each champion. Every value is estimated from the sticker's stats and the champion's usual build
// (no game data records stickers), so the page says so on every number.

const MEMBER_ID: Record<string, string> = { Aphelios: "Aphelios", Ezreal: "Ezreal", Kayn: "Kayn", "K'Sante": "KSante", Sett: "Sett", Yone: "Yone" };

export default function Heartsteel({ champions, stickers }: { champions: HeartsteelRow[]; stickers: StickerSummary[] }) {
  const t = useT("heartsteel");
  const names = useNames();
  const member = (m: string) => names("champions", MEMBER_ID[m] ?? m, m);
  const bonus = (s: string) => t(s);
  const icon = (m: string) => `/icons/champions/${MEMBER_ID[m] ?? m}.webp`;
  const pts = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

  const columns: Column[] = [
    { key: "champion", label: t("Champion"), format: "champion" },
    {
      key: "best",
      label: t("Best sticker"),
      format: "ability",
      iconKey: "bestIcon",
      sortable: false,
      hint: t("The sticker worth the most to this champion's usual build."),
    },
    {
      key: "bestValue",
      label: t("Value"),
      format: "pts",
      hint: t("Estimated: about how many win-rate points the sticker's bonus is worth on this champion, from its stats priced in gold and counted only where the usual build uses them."),
    },
    { key: "next", label: t("Runner-up"), format: "ability", iconKey: "nextIcon", sortable: false, phone: "hide" },
    { key: "nextValue", label: t("Runner-up value"), format: "pts", phone: "hide" },
  ];
  const data: Row[] = champions.map((r) => ({
    champion: r.champion,
    best: `${member(r.best.member)} · ${bonus(STICKER_TEXT[r.best.member] ?? "")}`,
    bestIcon: icon(r.best.member),
    bestValue: r.best.points / 100,
    next: r.next ? `${member(r.next.member)} · ${bonus(STICKER_TEXT[r.next.member] ?? "")}` : "",
    nextIcon: r.next ? icon(r.next.member) : "",
    nextValue: r.next ? r.next.points / 100 : "",
  }));

  return (
    <>
      <p className="patch-note subtab-note">
        {t(
          "In a HEARTSTEEL game, augment cards can carry a sticker from one of the six HEARTSTEEL members, each adding its own bonus. No game data records stickers, so every value here is estimated: the bonus's stats priced in gold, counted only where the champion's usual build uses them.",
        )}
      </p>
      <ol className="hs-stickers">
        {stickers.map((s, i) => (
          <li key={s.member}>
            <span className="hs-rank">#{i + 1}</span>
            <img src={icon(s.member)} alt="" width={44} height={44} loading="lazy" />
            <span className="hs-what">
              <b>{member(s.member)}</b>
              <small>{bonus(s.bonus)}</small>
            </span>
            <span className="hs-nums">
              <span>
                <b>{pts(s.average)}</b> <small>{t("pts on average")}</small>
              </span>
              <small>{t("Best for {n} champions", { n: s.bestFor })}</small>
            </span>
          </li>
        ))}
      </ol>
      <DataTable columns={columns} rows={data} initialSort={{ key: "bestValue", desc: true }} searchKey="champion" searchLabel={t("Find a champion")} urlTab="heartsteel" />
      <p className="patch-note">
        {t("Estimated for a sticker taken at level 1. Per-level bonuses (Ezreal, Sett) are worth a little less on a later augment.")}
      </p>
    </>
  );
}

// The game's own bonus text for each member, the English dictionary keys (engine STICKERS).
const STICKER_TEXT: Record<string, string> = {
  Aphelios: "2 Stat Anvils",
  Ezreal: "+4 AD and +4 AP per level",
  Kayn: "+5% omnivamp",
  "K'Sante": "+1 level and +1 level cap",
  Sett: "+30 health per level",
  Yone: "+40% attack speed and +20 ability haste",
};
