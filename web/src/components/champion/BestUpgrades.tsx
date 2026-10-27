import RowLink from "@/components/RowLink";
import { Name, T } from "@/components/I18n";
import augmentNames from "@/data/augment-names.json";
import { augmentHref } from "@/lib/augments";
import type { ChampionUpgrades } from "@/lib/champion-upgrades";
import { Cell, Panel, signed } from "./Ranked";

// A champion page's "Best upgrades" panel (lib/champion-upgrades.ts): the best 4 augments together, the item to
// make the Weapon of Destiny and the Pentakill picks. Labelled simulated and estimated, like the Tier List tab.

const NS = "champions";
const AUG_NAMES = augmentNames as Record<string, string>;

function Line({ label, children, cells }: { label: string; children: React.ReactNode; cells: React.ReactNode }) {
  return (
    <div className="cp-upg">
      <small className="cp-upg-label">
        <T ns={NS}>{label}</T>
      </small>
      <div className="cp-what">{children}</div>
      {cells}
    </div>
  );
}

function Ability({ when, slot, name, icon }: { when: string; slot: string; name: string; icon: string }) {
  return (
    <span className="cp-pair-one">
      <small className="cp-upg-when">
        <T ns="pentakill">{when}</T>
      </small>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {icon && <img className="cp-icon" src={icon} alt="" width={32} height={32} loading="lazy" />}
      <span className="cp-name">
        {slot}
        {name && ` · ${name}`}
      </span>
    </span>
  );
}

export default function BestUpgrades({ u }: { u: ChampionUpgrades }) {
  return (
    <Panel
      id="upgrades"
      title="Best upgrades"
      note={
        <T ns={NS}>
          {
            "Simulated and estimated. The best 4 augments count how well they work together, not just each one alone. Weapon of Destiny shows the item that gains the most from its upgrades."
          }
        </T>
      }
    >
      <div className="cp-rows">
        {u.augments && (
          <Line
            label="Best 4 augments together"
            cells={
              <>
                <Cell value={signed(u.augments.boost)} label="Est. boost" tone={u.augments.boost > 0 ? "up" : undefined} />
                <Cell value={signed(u.augments.synergy)} label="Synergy" />
              </>
            }
          >
            <span className="cp-quad">
              {u.augments.ids.map((id) => {
                const href = augmentHref(id);
                const one = (
                  <span className="cp-pair-one">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="cp-icon round" src={`/icons/augments/${id}.webp`} alt="" width={32} height={32} loading="lazy" />
                    <span className="cp-name">
                      <Name kind="augments" id={id}>
                        {AUG_NAMES[id] ?? ""}
                      </Name>
                    </span>
                  </span>
                );
                return href ? (
                  <RowLink key={id} className="cell-link" href={href}>
                    {one}
                  </RowLink>
                ) : (
                  <span key={id}>{one}</span>
                );
              })}
            </span>
          </Line>
        )}
        {u.destiny && (
          <Line
            label="Weapon of Destiny"
            cells={
              <>
                <Cell value={`+${Math.round(u.destiny.gain * 100)}%`} label="Simulated gain" />
                <Cell value={u.destiny.takedowns} label="Takedowns" />
              </>
            }
          >
            <RowLink className="cell-link" href={`/items/${u.destiny.slug}`}>
              <span className="cp-pair-one">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {u.destiny.icon && <img className="cp-icon" src={u.destiny.icon} alt="" width={32} height={32} loading="lazy" />}
                <span className="cp-name">
                  <Name kind="items" id={u.destiny.id}>
                    {u.destiny.name}
                  </Name>
                </span>
              </span>
            </RowLink>
          </Line>
        )}
        {u.pentakill && (
          <Line
            label="Pentakill"
            cells={
              <>
                <Cell value={signed(u.pentakill.boost)} label="Est. boost" tone={u.pentakill.boost > 0 ? "up" : undefined} />
                <Cell value={`+${Math.round(u.pentakill.startGain * 100)}%`} label="Simulated gain" />
              </>
            }
          >
            <span className="cp-quad">
              <Ability when="Start" slot={u.pentakill.start} name={u.pentakill.startName} icon={u.pentakill.startIcon} />
              <Ability when="Level 18" slot={u.pentakill.level18} name={u.pentakill.level18Name} icon={u.pentakill.level18Icon} />
            </span>
          </Line>
        )}
      </div>
    </Panel>
  );
}
