import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import AugmentCard from "@/components/AugmentCard";
import ChangeTracker, { type TrackerEntry } from "@/components/ChangeTracker";
import { Name, T } from "@/components/I18n";
import Intro from "@/components/Intro";
import PatchCountdown from "@/components/PatchCountdown";
import Pending from "@/components/Pending";
import PhoneMore from "@/components/PhoneMore";
import { items } from "@/lib/items";
import type { PatchSchedule } from "@/lib/patch-schedule";
import { readRepoJson } from "@/lib/repo-data";
import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import championNames from "@/data/champion-names.json";
import augmentNames from "@/data/augment-names.json";

export const metadata: Metadata = pageMeta("/pbe", "ARAM Mayhem PBE Changes", "What's changing for ARAM Mayhem on the test server: new and changed augments, rules and quests.");

type Change = { stat: string; live: string; pbe: string };
type Pbe = {
  meta: {
    label: string;
    dataAsOf: string;
    caveat: string;
    builds: { pbe: string; live: string };
    augmentPool: { live: number; pbe: number };
    notes: string[];
  };
  headliners: { summary: string; list: { name: string; effect: string }[] };
  fame: {
    summary: string;
    bands: { name: string; unlockFame: number; members: string[]; sampleObjectives: string[] }[];
  };
  augments: {
    added: { name: string | null; tier: string; set?: string; description: string | null; icon?: string }[];
    removed: { name: string; tier: string; icon?: string }[];
    changed: { name: string; tier?: string; direction?: string; changes: Change[]; icon?: string }[];
  };
  championOverrides: { champion: string; ability: string; live: string; pbe: string; note?: string }[];
  championChanges: { summary: string; list: { champion: string; changes: string[] }[] };
  itemChanges: { summary: string; list: { item: string; changes: string[] }[]; outsideMayhemShop?: string[] };
  modeChanges: string[];
};

const TIERS = ["prismatic", "gold", "silver"];

// Champion names to their icon ids ("Wukong" → MonkeyKing).
const CHAMP_ID = Object.fromEntries(Object.entries(championNames as Record<string, string>).map(([id, name]) => [name, id]));

// Augment names to their ids, for the official translated name ("Echo Cast" → its id).
const AUG_ID = Object.fromEntries(Object.entries(augmentNames as Record<string, string>).map(([id, name]) => [name, id]));

function trackerEntries(): TrackerEntry[] {
  const t = readRepoJson<{ entries: TrackerEntry[] }>("data/pbe/tracker.json");
  if (!t) return [];
  const itemOf = new Map([...items().values()].map((i) => [i.name, i]));
  return t.entries.map((e) => ({
    ...e,
    id: e.kind === "champion" ? CHAMP_ID[e.name] : e.kind === "item" ? itemOf.get(e.name)?.id : AUG_ID[e.name],
    icon:
      e.kind === "champion"
        ? CHAMP_ID[e.name] && `/icons/champions/${CHAMP_ID[e.name]}.webp`
        : e.kind === "item"
          ? itemOf.get(e.name)?.icon
          : e.icon,
  }));
}


// Page wording lives in /i18n/pbe/, the changes themselves in /i18n/pbe-data/ (tools/datamine/pbe_i18n.py).
const P = ({ children, v }: { children: string; v?: Record<string, string | number> }) => <T ns="pbe" v={v}>{children}</T>;
const D = ({ children }: { children: string }) => <T ns="pbe-data">{children}</T>;

const Champ = ({ name }: { name: string }) => (CHAMP_ID[name] ? <Name kind="champions" id={CHAMP_ID[name]}>{name}</Name> : <>{name}</>);
const Aug = ({ name }: { name: string }) => (AUG_ID[name] ? <Name kind="augments" id={AUG_ID[name]}>{name}</Name> : <>{name}</>);
function ItemName({ name }: { name: string }) {
  const it = [...items().values()].find((i) => i.name === name);
  return it ? <Name kind="items" id={it.id}>{name}</Name> : <>{name}</>;
}

// Points from the live value to the new one, flipped for right-to-left languages.
const Arrow = () => <span className="dir-arrow">→</span>;

// Phones only (CSS: .pbe-glance): the headline numbers, each a link to its section.
function Glance({ d, tracker }: { d: Pbe; tracker: TrackerEntry[] }) {
  const { augments: a, meta } = d;
  const tags = (tag: string) => tracker.filter((e) => e.tag === tag).length;
  const rows: [string, React.ReactNode, React.ReactNode][] = [
    ["augments", <P key="l">Augments</P>, <P key="v" v={{ added: a.added.length, changed: a.changed.length, removed: a.removed.length }}>{"{added} new · {changed} changed · {removed} removed"}</P>],
    ["augments", <P key="l">Augment pool</P>, <>{meta.augmentPool.live} <Arrow /> {meta.augmentPool.pbe}</>],
    ["tracker", <P key="l">Likely buff</P>, tags("buff")],
    ["tracker", <P key="l">Likely nerf</P>, tags("nerf")],
    ["headliners", <P key="l">Headliners</P>, d.headliners.list.length],
    ["champions", <P key="l">Champion changes</P>, d.championChanges.list.length],
    ["items", <P key="l">Item changes</P>, d.itemChanges.list.length],
    ["mode", <P key="l">Mode changes</P>, d.modeChanges.length],
  ];
  return (
    <section className="pbe-glance" aria-labelledby="glance-h">
      <h2 id="glance-h">
        <P>At a glance</P>
      </h2>
      <ul>
        {rows.map(([id, label, value], i) => (
          <li key={i}>
            <a href={`#${id}`}>
              <span>{label}</span>
              <b>{value}</b>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DIRECTION: Record<string, string> = { buff: "Likely buff", nerf: "Likely nerf", mixed: "Mixed", none: "No power change", unclear: "Unclear" };

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="doc-section" id={id}>
      <h2>
        <P>{title}</P>
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export default function PbePage() {
  const d = readRepoJson<Pbe>("data/pbe/kiwi-s3.json");
  if (!d) {
    return (
      <>
        <Intro eyebrow="PBE" title={<P>Mayhem changes on the test server.</P>} />
        <Pending pr={1}>The PBE changes appear here once they are merged:</Pending>
      </>
    );
  }

  const { meta, augments } = d;
  const tracker = trackerEntries();
  const schedule = readRepoJson<PatchSchedule>("data/patch-schedule.json");
  const toc = [
    ["tracker", "Change tracker"],
    ["headliners", "Headliners"],
    ["fame", "Fame"],
    ["augments", "Augments"],
    ["overrides", "Mayhem overrides"],
    ["champions", "Champions"],
    ["items", "Items"],
    ["mode", "Mode"],
  ];
  const label = <D>{meta.label}</D>;

  return (
    <>
      <Intro eyebrow={<>PBE · {label}</>} title={<D>{`Mayhem ${meta.label} on the test server.`}</D>}>
        <P v={{ live: patchName(meta.builds.live.split(".").slice(0, 2).join(".")), pbe: patchName(meta.builds.pbe.split(".").slice(0, 2).join(".")), date: meta.dataAsOf, from: meta.augmentPool.live, to: meta.augmentPool.pbe }}>
          {"What's changing from live patch {live} to test server build {pbe} (updated {date}). The augment pool goes from {from} to {to}."}
        </P>{" "}
        <D>{meta.caveat}</D>
      </Intro>

      <Glance d={d} tracker={tracker} />

      {schedule && <PatchCountdown schedule={schedule} asOf={new Date().toISOString()} dataPatch={livePatch()} note={<P>Test server changes usually reach live with a patch.</P>} />}

      <nav className="toc" aria-label="On this page">
        {toc.map(([id, text]) => (
          <a key={id} href={`#${id}`}>
            <P>{text}</P>
          </a>
        ))}
      </nav>

      {tracker.length > 0 && (
        <Section id="tracker" title="Change tracker" count={tracker.length}>
          <p className="lede">
            <P>
              Every champion, item and augment change on the test server. Tags read which way the numbers moved, so treat them as a guide rather
              than the final word.
            </P>
          </p>
          <ChangeTracker entries={tracker} />
        </Section>
      )}

      <Section id="headliners" title="Headliners" count={d.headliners.list.length}>
        <p className="lede">
          <D>{d.headliners.summary}</D>
        </p>
        <PhoneMore count={d.headliners.list.length}>
          <dl className="defs">
            {d.headliners.list.map((h) => (
              <div key={h.name}>
                <dt>{h.name}</dt>
                <dd>
                  <D>{h.effect}</D>
                </dd>
              </div>
            ))}
          </dl>
        </PhoneMore>
      </Section>

      <Section id="fame" title="Fame" count={d.fame.bands.length}>
        <p className="lede">
          <D>{d.fame.summary}</D>
        </p>
        <dl className="defs">
          {d.fame.bands.map((b) => (
            <div key={b.name}>
              <dt>
                {b.name}
                <span className="sub">{b.unlockFame ? <P v={{ n: b.unlockFame.toLocaleString() }}>{"{n} Fame"}</P> : <P>Starts unlocked</P>}</span>
              </dt>
              <dd>
                {b.members.map((m, i) => (
                  <span key={m}>
                    {i > 0 && ", "}
                    <Champ name={m} />
                  </span>
                ))}
                <span className="sub">
                  <P>Objectives:</P>{" "}
                  {b.sampleObjectives.map((o, i) => (
                    <span key={o}>
                      {i > 0 && " · "}
                      <D>{o}</D>
                    </span>
                  ))}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="augments" title="Augments" count={augments.added.length + augments.removed.length + augments.changed.length}>
        <h3>
          <P v={{ n: augments.added.length }}>{"Added ({n})"}</P>
        </h3>
        <PhoneMore count={augments.added.length}>
          <div className="aug-grid">
            {TIERS.flatMap((tier) =>
              augments.added
                .filter((a) => a.tier === tier)
                .map((a, i) => (
                  <AugmentCard key={`${a.name}-${i}`} name={a.name ? <Aug name={a.name} /> : <P>Unnamed</P>} tier={tier} icon={a.icon} set={a.set}>
                    {a.description ? <D>{a.description}</D> : <P>Details not revealed yet.</P>}
                  </AugmentCard>
                )),
            )}
          </div>
        </PhoneMore>
        <h3>
          <P v={{ n: augments.changed.length }}>{"Changed ({n})"}</P>
        </h3>
        <PhoneMore count={augments.changed.length}>
          <div className="aug-grid">
            {augments.changed.map((a) => (
              <AugmentCard key={a.name} name={<Aug name={a.name} />} tier={a.tier} icon={a.icon}>
                {a.direction && (
                  <span className={`tag tag-${a.direction}`}>
                    <P>{DIRECTION[a.direction] ?? "Unclear"}</P>
                  </span>
                )}
                {a.changes.map((c) => (
                  <span key={c.stat} className="change">
                    <D>{c.stat}</D>: <s><D>{c.live}</D></s> <Arrow /> <b><D>{c.pbe}</D></b>
                  </span>
                ))}
              </AugmentCard>
            ))}
          </div>
        </PhoneMore>
        <h3>
          <P v={{ n: augments.removed.length }}>{"Removed ({n})"}</P>
        </h3>
        <PhoneMore count={augments.removed.length}>
          <div className="aug-grid aug-mini">
            {augments.removed.map((a) => (
              <AugmentCard key={a.name} name={<Aug name={a.name} />} tier={a.tier} icon={a.icon} removed compact />
            ))}
          </div>
        </PhoneMore>
      </Section>

      <Section id="overrides" title="Mayhem overrides" count={d.championOverrides.length}>
        <dl className="defs">
          {d.championOverrides.map((o) => (
            <div key={`${o.champion}-${o.ability}`}>
              <dt>
                <Champ name={o.champion} /> {o.ability}
              </dt>
              <dd>
                <span className="change">
                  <s><D>{o.live}</D></s> <Arrow /> <b><D>{o.pbe}</D></b>
                </span>
                {o.note && (
                  <span className="sub">
                    <D>{o.note}</D>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="champions" title="Champion changes" count={d.championChanges.list.length}>
        <p className="lede">
          <D>{d.championChanges.summary}</D>
        </p>
        <PhoneMore count={d.championChanges.list.length}>
          <dl className="defs">
            {d.championChanges.list.map((c) => (
              <div key={c.champion}>
                <dt>
                  <Champ name={c.champion} />
                </dt>
                <dd>
                  {c.changes.map((x) => (
                    <span key={x} className="change">
                      <D>{x}</D>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </PhoneMore>
      </Section>

      <Section id="items" title="Item changes" count={d.itemChanges.list.length}>
        <p className="lede">
          <D>{d.itemChanges.summary}</D>
        </p>
        <dl className="defs">
          {d.itemChanges.list.map((c) => (
            <div key={c.item}>
              <dt>
                <ItemName name={c.item} />
              </dt>
              <dd>
                {c.changes.map((x) => (
                  <span key={x} className="change">
                    <D>{x}</D>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        {d.itemChanges.outsideMayhemShop?.length ? (
          <p className="sub">
            <P>Not in the Mayhem shop:</P>{" "}
            {d.itemChanges.outsideMayhemShop.map((x, i) => (
              <span key={x}>
                {i > 0 && "; "}
                <D>{x}</D>
              </span>
            ))}
          </p>
        ) : null}
      </Section>

      <Section id="mode" title="Mode changes" count={d.modeChanges.length}>
        <ul className="bullets">
          {d.modeChanges.map((m) => (
            <li key={m}>
              <D>{m}</D>
            </li>
          ))}
        </ul>
        <h3>
          <P>Notes</P>
        </h3>
        <ul className="bullets sub">
          {meta.notes.map((n) => (
            <li key={n}>
              <D>{n}</D>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
