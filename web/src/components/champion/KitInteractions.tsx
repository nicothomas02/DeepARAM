/* eslint-disable @next/next/no-img-element -- small local icons */
import RowLink from "@/components/RowLink";
import { Name, T } from "@/components/I18n";
import augmentNames from "@/data/augment-names.json";
import { augmentHref } from "@/lib/augments";
import type { KitInteraction } from "@/lib/kit-interactions";
import { Cell, Panel, pct } from "./Ranked";

// A champion page's "Kit interactions" panel: augments that do something special with this champion's own
// abilities, each with the abilities involved and one line on why (lib/kit-interactions.ts).

const NS = "champions";
const AUG_NAMES = augmentNames as Record<string, string>;

export default function KitInteractions({ rows }: { rows: (KitInteraction & { pickRate: number })[] }) {
  return (
    <Panel
      id="interactions"
      title="Kit interactions"
      count={rows.length}
      note={<T ns={NS}>{"Augments that work with this champion's own abilities, and why."}</T>}
    >
      <div className="cp-rows">
        {rows.map((r) => {
          const href = augmentHref(r.augment);
          const aug = (
            <span className="cp-pair-one">
              <img className="cp-icon round" src={`/icons/augments/${r.augment}.webp`} alt="" width={32} height={32} loading="lazy" />
              <span className="cp-name">
                <Name kind="augments" id={r.augment}>
                  {AUG_NAMES[r.augment] ?? ""}
                </Name>
              </span>
            </span>
          );
          return (
            <div key={`${r.augment}-${r.keys.join("")}`} className="cp-kit">
              <div className="cp-kit-head">
                {href ? (
                  <RowLink href={href} className="cell-link">
                    {aug}
                  </RowLink>
                ) : (
                  aug
                )}
                {r.keys.length > 0 && (
                  <span className="cp-keys" aria-label={r.keys.join(", ")}>
                    {r.keys.map((k) => (
                      <b key={k} className="cp-key" data-k={k === "P" ? undefined : k}>
                        {k}
                      </b>
                    ))}
                  </span>
                )}
              </div>
              <p className="cp-kit-why">
                <T ns="kit-interactions">{r.text}</T>
              </p>
              <Cell value={pct(r.pickRate)} label="Pick rate" />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
