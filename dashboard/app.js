// ARAM Mayhem stats dashboard. Reads a match archive entirely in the browser.
"use strict";

// Queue and map names, filled in from constants.json; these cover a page without it.
const QUEUE_NAMES = { 2400: "ARAM Mayhem", 2450: "ARAM Mayhem (2450)", 450: "ARAM" };
const MAP_NAMES = { 12: "Howling Abyss" };

const state = {
  games: [],        // normalized rows for the archive owner, one per game
  champNames: {},   // championId -> name
  augNames: {},     // augmentId -> name
  augRarity: {},    // augmentId -> kSilver | kGold | kPrismatic
  owner: null,
  sample: false,
  boots: new Set(), // item ids that count as boots
  champAlias: {},   // championId -> alias as in /champions/<alias>
  live: [],         // game recordings from the helper, newest first
  owned: null,      // {champions: [ids]} from the client, when synced
};

// A page can ship name tables and an example archive ahead of time.
const PRESET = window.MAYHEM_PRESET || {};
try { if (window.self !== window.top && !PRESET.sample) document.documentElement.classList.add("embedded"); } catch (e) { document.documentElement.classList.add("embedded"); }
Object.assign(state.champNames, PRESET.champNames || {});
Object.assign(state.augNames, PRESET.augNames || {});
Object.assign(state.augRarity, PRESET.augRarity || {});

// ---------- loading ----------

const $ = (id) => document.getElementById(id);

// ---------- language ----------
// The site's language: the parent page's <html data-lang> when shown on deeparam.com, else the visitor's
// saved pick, else the browser's. Text is looked up by its English wording in /i18n/stats/<code>.json and
// official champion and augment names in /i18n/names/<code>.json; anything missing stays in English.
const LANGS = ["en", "ar", "cs", "de", "el", "es", "es-MX", "fr", "hu", "id", "it", "ja", "ko", "pl", "pt-BR", "ro", "ru", "th", "tr", "vi", "zh-CN", "zh-TW"];

function matchLang(tag) {
  const tl = String(tag || "").trim().replace("_", "-");
  const exact = LANGS.find((l) => l.toLowerCase() === tl.toLowerCase());
  if (exact) return exact;
  const [base, region = ""] = tl.toLowerCase().split("-");
  if (base === "zh") return /^(tw|hk|mo|hant)$/.test(region) ? "zh-TW" : "zh-CN";
  if (base === "pt") return "pt-BR";
  if (base === "es") return region && region !== "es" ? "es-MX" : "es";
  return LANGS.includes(base) ? base : null;
}

function pickLang() {
  try { const l = window.parent !== window && window.parent.document.documentElement.dataset.lang; if (LANGS.includes(l)) return l; } catch (e) { /* not on the site */ }
  try { const l = localStorage.getItem("deeparam-lang"); if (LANGS.includes(l)) return l; } catch (e) { /* storage blocked */ }
  for (const tag of navigator.languages || [navigator.language]) {
    const m = matchLang(tag);
    if (m) return m;
    if (/^en\b/i.test(tag || "")) break;
  }
  return "en";
}

const LANG = pickLang();
let DICT = {}, NAMES = {};
// The game's own end-of-game Victory / Defeat art, in the page's language (web/src/i18n/languages.json).
const RIOT_LOCALE = { en: "en_us", ar: "ar_ae", cs: "cs_cz", de: "de_de", el: "el_gr", es: "es_es", "es-MX": "es_mx", fr: "fr_fr", hu: "hu_hu",
  id: "id_id", it: "it_it", ja: "ja_jp", ko: "ko_kr", pl: "pl_pl", "pt-BR": "pt_br", ro: "ro_ro", ru: "ru_ru", th: "th_th", tr: "tr_tr",
  vi: "vi_vn", "zh-CN": "zh_cn", "zh-TW": "zh_tw" };
function resultBanner(win) {
  const loc = RIOT_LOCALE[LANG] || "en_us";
  return `<img class="result-banner" src="/assets/cd/latest/game/${loc}/assets/ux/endofgame/en_us/${win ? "victory" : "defeat"}.png" width="96" height="22" alt="${esc(t(win ? "Win" : "Loss"))}" loading="lazy">`;
}
/** Text in the page's language: t("English text", { placeholder: value }). */
const t = (s, v) => {
  const r = DICT[s] || s;
  return v ? r.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : r;
};

// Swaps the page's own English text and labels for the chosen language.
function translateDom(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const k = n.nodeValue.trim();
    if (k && DICT[k]) n.nodeValue = n.nodeValue.replace(k, DICT[k]);
  }
  for (const a of ["placeholder", "aria-label", "title"]) {
    for (const el of root.querySelectorAll(`[${a}]`)) if (DICT[el.getAttribute(a)]) el.setAttribute(a, DICT[el.getAttribute(a)]);
  }
}

async function loadLang() {
  document.documentElement.lang = LANG;
  if (LANG === "ar") document.documentElement.dir = "rtl";
  // On deeparam.com, follow the site when the visitor switches language
  try { if (window.parent !== window) window.parent.addEventListener("deeparam-lang", () => location.reload()); } catch (e) { /* not on the site */ }
  if (LANG === "en") return;
  const get = async (path) => {
    try { const r = await fetch(path); return r.ok ? await r.json() : {}; } catch (e) { return {}; }
  };
  [DICT, NAMES] = await Promise.all([get(`/i18n/stats/${LANG}.json`), get(`/i18n/names/${LANG}.json`)]);
  translateDom(document.body);
}

function showError(msg) {
  const el = $("load-error");
  el.textContent = msg;
  el.hidden = false;
  $("loader").hidden = false;
}

async function loadText(text, { sample = false } = {}) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return showError(t("Your saved games couldn't be read.")); }
  const raw = findGames(data);
  if (!raw.length) return showError(t("No Mayhem games yet. Import games from client to add them."));
  const owner = findOwner(data, raw);
  state.owner = owner;
  state.owned = data && data.owned && Array.isArray(data.owned.champions) ? data.owned : null;
  state.games = raw.map((g) => normalize(g, owner)).filter(Boolean)
    .sort((a, b) => b.time - a.time);
  if (!state.games.length) return showError(t("Couldn't find the account's own stats in those games."));
  state.sample = sample;
  $("load-error").hidden = true;
  $("loader").hidden = true;
  $("stats").hidden = false;
  $("actions").hidden = false;
  $("sample-note").hidden = !sample;
  setupFilters();
  render();
  Promise.all([loadNames(), loadItems()]).then(() => { render(); setupBanner(); linkRecentlyPlayed(); });
}

function findGames(data) {
  if (Array.isArray(data)) return data;
  for (const k of ["games", "matches", "data"]) {
    const v = data[k];
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.games)) return v.games;
  }
  return [];
}

// The owner is the account the archive belongs to: an explicit field if the
// file has one, otherwise whoever appears in the most games.
function findOwner(data, games) {
  if (!Array.isArray(data)) {
    const p = data.puuid || data.accountPuuid || (data.account && data.account.puuid) || (data.summoner && data.summoner.puuid);
    if (p) return p;
  }
  const counts = {};
  for (const g of games) for (const p of players(g)) if (p.puuid) counts[p.puuid] = (counts[p.puuid] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Returns [{puuid, name, participant}] for both archive formats.
function players(g) {
  const info = g.info || g;
  const parts = info.participants || [];
  if (info.participantIdentities) {
    const byId = {};
    for (const pi of info.participantIdentities) byId[pi.participantId] = pi.player || {};
    return parts.map((p) => {
      const pl = byId[p.participantId] || {};
      return { puuid: pl.puuid, name: pl.gameName ? `${pl.gameName}#${pl.tagLine || ""}` : pl.summonerName, participant: p };
    });
  }
  return parts.map((p) => ({ puuid: p.puuid, name: p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline || ""}` : p.summonerName, participant: p }));
}

function normalize(g, owner) {
  const info = g.info || g;
  const me = players(g).find((p) => p.puuid === owner);
  if (!me) return null;
  const p = me.participant;
  const s = p.stats || p;
  const allies = (info.participants || []).filter((o) => o !== p && o.teamId === p.teamId && o.championId > 0).map((o) => o.championId);
  // The players on your team, from your own game: who they were and how they did with you.
  const mates = players(g).filter((o) => o.participant !== p && o.participant.teamId === p.teamId && o.name && o.name !== "#").map((o) => {
    const os = o.participant.stats || o.participant;
    return { key: (o.name || "").toLowerCase(), name: o.name, champ: o.participant.championId, k: os.kills || 0, d: os.deaths || 0, a: os.assists || 0, dmg: os.totalDamageDealtToChampions || 0 };
  });
  const augs = [1, 2, 3, 4, 5, 6].map((i) => s["playerAugment" + i]).filter((a) => a && a > 0);
  let time = info.gameCreation || Date.parse(info.gameCreationDate || "") || 0;
  // gameDuration is seconds in newer archives, milliseconds in older ones
  let dur = info.gameDuration || 0;
  if (dur > 20000) dur = Math.round(dur / 1000);
  return {
    id: info.gameId || (g.metadata && g.metadata.matchId),
    time,
    queue: info.queueId,
    patch: (info.gameVersion || "").split(".").slice(0, 2).join("."),
    duration: dur,
    champId: p.championId,
    champNameRaw: p.championName,
    win: !!s.win,
    kills: s.kills || 0,
    deaths: s.deaths || 0,
    assists: s.assists || 0,
    damage: s.totalDamageDealtToChampions || 0,
    augs,
    name: me.name,
    // [seconds, x, y, killerId, victimId] per kill; undefined until synced
    killMap: g.killMap,
    pid: p.participantId,
    penta: s.pentaKills || 0,
    quadra: s.quadraKills || 0,
    spree: s.largestKillingSpree || 0,
    heal: s.totalHeal || 0,
    taken: s.totalDamageTaken || 0,
    items: [0, 1, 2, 3, 4, 5, 6].map((i) => s["item" + i]).filter((x) => x > 0),
    allies,
    mates,
  };
}

// Champion and augment names; if unavailable the page falls back to ids.
async function loadItems() {
  try {
    const items = await (await fetch("/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json")).json();
    for (const it of items) if ((it.categories || []).includes("Boots") && !(it.id >= 550000 && it.id < 560000)) state.boots.add(it.id);
  } catch (e) { console.warn("item data unavailable", e); }
}

async function loadNames() {
  try {
    const c = await (await fetch("constants.json")).json();
    for (const [id, name] of Object.entries(c.queues || {})) if (!QUEUE_NAMES[id]) QUEUE_NAMES[id] = name;
    Object.assign(MAP_NAMES, c.maps || {});
  } catch (e) { console.warn("queue names unavailable", e); }
  try {
    const champs = await (await fetch("/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json")).json();
    for (const c of champs) if (c.id > 0) { state.champNames[c.id] = c.name; state.champAlias[c.id] = c.alias; }
  } catch (e) { console.warn("champion names unavailable", e); }
  for (const url of [
    "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json",
    "/assets/cd/latest/cdragon/arena/en_us.json",
  ]) {
    try {
      const j = await (await fetch(url)).json();
      const list = Array.isArray(j) ? j : (j.augments || []);
      for (const a of list) {
        const name = a.nameTRA || a.name;
        if (a.id != null && name && !state.augNames[a.id]) state.augNames[a.id] = name;
        if (a.id != null && a.rarity && !state.augRarity[a.id]) state.augRarity[a.id] = a.rarity;
      }
    } catch (e) { console.warn("augment names unavailable from", url, e); }
  }
}

const localName = (id) => (NAMES.champions || {})[state.champAlias[id]];
const champById = (id) => localName(id) || state.champNames[id] || t("Champion {id}", { id });
const champName = (g) => localName(g.champId) || state.champNames[g.champId] || g.champNameRaw || t("Champion {id}", { id: g.champId });
const augName = (id) => (NAMES.augments || {})[id] || state.augNames[id] || t("Augment {id}", { id });
const queueName = (q) => {
  const n = QUEUE_NAMES[q];
  if (!n) return t("Queue {id}", { id: q });
  return NAMES.mode && n.startsWith("ARAM Mayhem") ? n.replace("ARAM Mayhem", NAMES.mode) : t(n);
};
const RARITY = { kSilver: ["Silver", 1], kGold: ["Gold", 2], kPrismatic: ["Prismatic", 3] };

// ---------- filters ----------

let filtersReady = false;
// Patches newest first; views default to the newest one in the archive.
const patchKey = (p) => p.split(".").map((n) => n.padStart(4, "0")).join(".");
let latestPatch = "";

function setupFilters() {
  const patches = [...new Set(state.games.map((g) => g.patch).filter(Boolean))].sort((a, b) => patchKey(b).localeCompare(patchKey(a)));
  latestPatch = patches[0] || "";
  $("f-patch").innerHTML = `<option value="">${esc(t("All patches"))}</option>` +
    patches.map((p) => `<option value="${p}">${esc(t("Patch {patch}", { patch: p }))}</option>`).join("");
  $("f-patch").value = latestPatch;
  const queues = [...new Set(state.games.map((g) => g.queue))].sort();
  const sel = $("f-queue");
  sel.innerHTML = `<option value="">${esc(t("All"))}</option>` +
    queues.map((q) => `<option value="${q}">${esc(queueName(q))}</option>`).join("");
  const name = state.games.find((g) => g.name)?.name;
  const first = new Date(state.games[state.games.length - 1].time);
  const last = new Date(state.games[0].time);
  $("account").hidden = false;
  $("account").textContent = (name ? name + " · " : "") + t("{n} games, {from} to {to}", { n: state.games.length.toLocaleString(), from: fmtDate(first), to: fmtDate(last) });
  if (filtersReady) return;
  filtersReady = true;
  for (const id of ["f-patch", "f-queue", "f-from", "f-to", "f-champ", "f-minaug", "f-minpair", "f-minally", "f-minmate"]) $(id).addEventListener("input", render);
  $("f-reset").addEventListener("click", () => {
    for (const id of ["f-queue", "f-from", "f-to", "f-champ"]) $(id).value = "";
    $("f-patch").value = latestPatch;
    render();
  });
}

function filtered() {
  const patch = $("f-patch").value;
  const q = $("f-queue").value;
  const from = $("f-from").value ? Date.parse($("f-from").value) : -Infinity;
  const to = $("f-to").value ? Date.parse($("f-to").value) + 86400000 : Infinity;
  const champ = $("f-champ").value.trim().toLowerCase();
  return state.games.filter((g) =>
    (!patch || g.patch === patch) && (!q || String(g.queue) === q) && g.time >= from && g.time < to &&
    (!champ || champName(g).toLowerCase().includes(champ)));
}

// ---------- rendering ----------

const pct = (n) => (n * 100).toFixed(1) + "%";
const fmtDate = (d) => d.toLocaleDateString(LANG, { year: "numeric", month: "short", day: "numeric" });
const kda = (k, d, a) => ((k + a) / Math.max(1, d)).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render() {
  const games = filtered();
  renderTiles(games);
  renderBadges(state.games);
  renderChart(games);
  renderKillMap(games);
  renderChamps(games);
  renderAugs(games);
  renderLength(games);
  renderBoots(games);
  renderRecords(state.games);
  renderCurve(state.games);
  renderPairs(games);
  renderAllies(games);
  renderMates(games);
  renderGames(games);
  if (state.live.length) renderLive();
}

function sum(games, f) { return games.reduce((t, g) => t + f(g), 0); }

function renderTiles(games) {
  const n = games.length;
  const wins = sum(games, (g) => g.win);
  const K = sum(games, (g) => g.kills), D = sum(games, (g) => g.deaths), A = sum(games, (g) => g.assists);
  const dmg = n ? sum(games, (g) => g.damage) / n : 0;
  const dur = n ? sum(games, (g) => g.duration) / n : 0;
  const tiles = [
    ["Total matches", n.toLocaleString(), t("{w} W · {l} L", { w: wins, l: n - wins }) + (n < state.games.length ? " · " + t("of {n}", { n: state.games.length.toLocaleString() }) : "")],
    ["Win rate", n ? pct(wins / n) : "–", "", n ? wrClass(wins / n) : ""],
    ["KDA", n ? kda(K, D, A) : "–", n ? `${(K / n).toFixed(1)} / ${(D / n).toFixed(1)} / ${(A / n).toFixed(1)}` : ""],
    ["Damage to champions", n ? Math.round(dmg).toLocaleString() : "–", t("per game")],
    ["Game length", n ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}` : "–", t("average")],
    ["Champions played", new Set(games.map((g) => g.champId)).size, ""],
  ];
  $("tiles").innerHTML = tiles.map(([l, v, s, c]) =>
    `<div class="tile ${c || ""}"><div class="label">${esc(t(l))}</div><div class="value">${v}</div><div class="sub">${esc(s)}</div></div>`).join("");
}

// Achievements count every imported game, whatever the filters show.
const BADGES = [
  ["Pentakill", "Get a pentakill", (G) => count(G, (g) => g.penta > 0), 1],
  ["Quadra", "Get a quadra kill", (G) => count(G, (g) => g.quadra + g.penta > 0), 1],
  ["Legendary", "Kill 8 champions without dying", (G) => max(G, (g) => g.spree), 8],
  ["Massacre", "Get 25 kills in one game", (G) => max(G, (g) => g.kills), 25],
  ["Helping hand", "Get 40 assists in one game", (G) => max(G, (g) => g.assists), 40],
  ["Untouchable", "Win a game without dying", (G) => count(G, (g) => g.win && g.deaths === 0), 1],
  ["Heavy hitter", "Deal 75,000 damage to champions in one game", (G) => max(G, (g) => g.damage), 75000],
  ["Frontline", "Take 80,000 damage in one game", (G) => max(G, (g) => g.taken), 80000],
  ["Speedrun", "Win a game in under 15 minutes", (G) => count(G, (g) => g.win && g.duration > 0 && g.duration < 900), 1],
  ["Marathon", "Play a game over 30 minutes", (G) => count(G, (g) => g.duration >= 1800), 1],
  ["Hot streak", "Win 5 games in a row", (G) => streak(G), 5],
  ["Unstoppable", "Win 10 games in a row", (G) => streak(G), 10],
  ["Main", "Win 10 games on one champion", (G) => bestChamp(G, true), 10],
  ["One-trick", "Play 50 games on one champion", (G) => bestChamp(G, false), 50],
  ["Explorer", "Play 50 different champions", (G) => new Set(G.map((g) => g.champId)).size, 50],
  ["Collector", "Pick 100 different augments", (G) => new Set(G.flatMap((g) => g.augs)).size, 100],
  ["Regular", "Play 100 games", (G) => G.length, 100],
  ["Veteran", "Play 500 games", (G) => G.length, 500],
  ["Winner", "Win 250 games", (G) => count(G, (g) => g.win), 250],
];

function count(G, f) { return G.reduce((t, g) => t + (f(g) ? 1 : 0), 0); }
function max(G, f) { return G.reduce((m, g) => Math.max(m, f(g)), 0); }
function streak(G) {
  let best = 0, run = 0;
  for (const g of [...G].sort((a, b) => a.time - b.time)) { run = g.win ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
function bestChamp(G, wins) {
  const m = new Map();
  for (const g of G) if (!wins || g.win) m.set(g.champId, (m.get(g.champId) || 0) + 1);
  return Math.max(0, ...m.values());
}

const badgeRows = (G) => BADGES.map(([name, desc, f, goal]) => ({ name, desc, goal, have: f(G) }));

function renderBadges(G) {
  const rows = badgeRows(G);
  const earned = rows.filter((r) => r.have >= r.goal).length;
  $("n-badges").textContent = t("{earned} of {n} earned", { earned, n: rows.length });
  rows.sort((a, b) => (b.have >= b.goal) - (a.have >= a.goal) || b.have / b.goal - a.have / a.goal);
  $("badges").innerHTML = rows.map((r) => {
    const done = r.have >= r.goal;
    const prog = Math.min(1, r.have / r.goal);
    const label = r.goal === 1 ? (done ? `${r.have.toLocaleString()}×` : t("Not yet")) : `${Math.min(r.have, r.goal).toLocaleString()} / ${r.goal.toLocaleString()}`;
    return `<div class="badge${done ? " done" : ""}" title="${esc(t(r.desc))}">
      <div class="b-name">${done ? "★ " : ""}${esc(t(r.name))}</div>
      <div class="b-desc">${esc(t(r.desc))}</div>
      <div class="b-bar"><span style="width:${(prog * 100).toFixed(1)}%"></span></div>
      <div class="b-prog">${esc(label)}</div></div>`;
  }).join("");
}

function renderChart(games) {
  const months = new Map();
  for (const g of [...games].reverse()) {
    const d = new Date(g.time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = months.get(key) || { key, n: 0, w: 0 };
    m.n++; m.w += g.win;
    months.set(key, m);
  }
  const rows = [...months.values()];
  const el = $("chart");
  if (!rows.length) { el.innerHTML = `<p class="muted">${esc(t("No games match."))}</p>`; return; }
  const W = 960, H = 260, L = 40, R = 8, T = 10, B = 28;
  const pw = (W - L - R) / rows.length;
  const bw = Math.max(2, Math.min(40, pw - 2));
  const y = (v) => T + (1 - v) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("Win rate by month"))}">`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg += `<line class="${v === 0.5 ? "ref" : "grid"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  }
  const every = Math.ceil(rows.length / 12);
  rows.forEach((m, i) => {
    const x = L + i * pw + (pw - bw) / 2;
    const r = m.w / m.n;
    const top = y(r), base = y(0);
    const h = Math.max(0, base - top);
    const rad = Math.min(4, bw / 2, h);
    // bar with rounded top, square at the baseline
    svg += `<path class="bar" data-i="${i}" d="M${x},${base} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + bw - rad} Q${x + bw},${top} ${x + bw},${top + rad} V${base} Z"/>`;
    // invisible full-height hit target
    svg += `<rect data-i="${i}" x="${L + i * pw}" y="${T}" width="${pw}" height="${H - T - B}" fill="transparent"/>`;
    if (i % every === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${m.key}</text>`;
  });
  el.innerHTML = svg + "</svg>";
  const tip = $("tooltip");
  el.querySelectorAll("[data-i]").forEach((node) => {
    node.addEventListener("mousemove", (e) => {
      const m = rows[node.dataset.i];
      tip.innerHTML = `<strong>${m.key}</strong><br>${esc(t("{wr} win rate", { wr: pct(m.w / m.n) }))}<br>${esc(t("{w} W · {l} L", { w: m.w, l: m.n - m.w }))}`;
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 12, innerWidth - 160) + "px";
      tip.style.top = e.clientY + 12 + "px";
      el.querySelectorAll(".bar").forEach((b) => b.classList.toggle("hot", b.dataset.i === node.dataset.i));
    });
    node.addEventListener("mouseleave", () => {
      tip.hidden = true;
      el.querySelectorAll(".bar.hot").forEach((b) => b.classList.remove("hot"));
    });
  });
}

// ---------- kill map ----------
// Positions are game units on the Howling Abyss; the minimap spans this square.
const MAP12 = { minX: -28, minY: -19, maxX: 12849, maxY: 12858 };
const MINIMAP_BASE = "/assets/cd/latest/game/assets/maps/info/map12/";
const KM_GRID = 128;
let kmMode = "kills";

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// Smooths points into a KM_GRID square grid with a small Gaussian kernel.
function density(points) {
  const grid = new Float32Array(KM_GRID * KM_GRID);
  const R = 3, sigma2 = 2 * 1.6 * 1.6;
  for (const [gx, gy] of points) {
    const cx = Math.round(gx), cy = Math.round(gy);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= KM_GRID || y >= KM_GRID) continue;
      grid[y * KM_GRID + x] += Math.exp(-(dx * dx + dy * dy) / sigma2);
    }
  }
  return grid;
}

function renderKillMap(games) {
  const kills = [], deaths = [];
  let mapped = 0, missing = 0;
  for (const g of games) {
    if (!Array.isArray(g.killMap)) { missing++; continue; }
    mapped++;
    for (const [, x, y, killer, victim] of g.killMap) {
      const gx = (x - MAP12.minX) / (MAP12.maxX - MAP12.minX) * KM_GRID;
      const gy = (1 - (y - MAP12.minY) / (MAP12.maxY - MAP12.minY)) * KM_GRID;
      if (killer === g.pid) kills.push([gx, gy]);
      if (victim === g.pid) deaths.push([gx, gy]);
    }
  }
  const img = $("km-img");
  const src = MINIMAP_BASE + $("km-skin").value + ".png";
  if (img.getAttribute("src") !== src) img.src = src;

  const layers = [];
  if (kmMode !== "deaths") layers.push({ pts: kills, rgb: hexRgb(cssVar("--good")) });
  if (kmMode !== "kills") layers.push({ pts: deaths, rgb: hexRgb(cssVar("--bad")) });
  const canvas = $("km-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const off = document.createElement("canvas");
  off.width = off.height = KM_GRID;
  const octx = off.getContext("2d");
  for (const { pts, rgb } of layers) {
    if (!pts.length) continue;
    const grid = density(pts);
    let max = 0;
    for (const v of grid) if (v > max) max = v;
    const im = octx.createImageData(KM_GRID, KM_GRID);
    for (let i = 0; i < grid.length; i++) {
      const v = Math.sqrt(grid[i] / max); // sqrt keeps lighter spots visible next to the hottest one
      im.data[i * 4] = rgb[0]; im.data[i * 4 + 1] = rgb[1]; im.data[i * 4 + 2] = rgb[2];
      im.data[i * 4 + 3] = v < 0.08 ? 0 : Math.round(40 + v * 200);
    }
    octx.putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  $("km-legend").innerHTML =
    `<div class="km-key"><i style="background:var(--good)"></i>${esc(t("Kills"))}<b>${kills.length.toLocaleString()}</b></div>` +
    `<div class="km-key"><i style="background:var(--bad)"></i>${esc(t("Deaths"))}<b>${deaths.length.toLocaleString()}</b></div>`;
  let note = t("From {n} of {total} games.", { n: mapped.toLocaleString(), total: games.length.toLocaleString() });
  if (missing) note += " " + t("The rest have no positions yet: importing adds them, up to 200 games per import. Very old games may not have one.");
  note += " " + t("The map skin isn't recorded, so pick one above.");
  $("km-note").textContent = note;
}

document.querySelectorAll("[data-km]").forEach((b) => b.addEventListener("click", () => {
  kmMode = b.dataset.km;
  document.querySelectorAll("[data-km]").forEach((o) => o.classList.toggle("on", o === b));
  render();
}));
$("km-skin").addEventListener("input", render);

// Sortable table helper. cols: [{label, get, fmt?}]
const sortState = {};
const wrClass = (wr) => (wr >= 0.52 ? "wr-high" : wr <= 0.48 ? "wr-low" : "");

function table(id, cols, rows, defaultSort) {
  const el = $(id);
  const s = sortState[id] || (sortState[id] = { col: defaultSort, asc: false });
  const col = cols[s.col];
  rows.sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return s.asc ? c : -c;
  });
  el.innerHTML = "<thead><tr>" + cols.map((c, i) =>
    `<th data-c="${i}" class="${i === s.col ? "sorted" + (s.asc ? " asc" : "") : ""}">${esc(t(c.label))}</th>`).join("") +
    "</tr></thead><tbody>" + rows.map((r) => "<tr>" + cols.map((c) =>
      `<td${c.cls ? ` class="${c.cls(r)}"` : ""}>${c.fmt ? c.fmt(r) : esc(c.get(r))}</td>`).join("") + "</tr>").join("") + "</tbody>";
  el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const c = +th.dataset.c;
    if (s.col === c) s.asc = !s.asc; else { s.col = c; s.asc = false; }
    render();
  }));
}

function group(games, keyFn) {
  const map = new Map();
  for (const g of games) for (const k of [].concat(keyFn(g))) {
    const r = map.get(k) || { key: k, n: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0, sample: g };
    r.n++; r.w += g.win; r.k += g.kills; r.d += g.deaths; r.a += g.assists; r.dmg += g.damage;
    map.set(k, r);
  }
  return [...map.values()];
}

function renderChamps(games) {
  const rows = group(games, (g) => g.champId);
  $("n-champs").textContent = t("{n} matches", { n: games.length.toLocaleString() });
  table("t-champs", [
    { label: "Champion", get: (r) => champName(r.sample) },
    { label: "Matches", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
    { label: "KDA", get: (r) => (r.k + r.a) / Math.max(1, r.d), fmt: (r) => kda(r.k, r.d, r.a) },
    { label: "Damage", get: (r) => r.dmg / r.n, fmt: (r) => Math.round(r.dmg / r.n).toLocaleString() },
  ], rows, 1);
}

function renderAugs(games) {
  const min = +$("f-minaug").value || 1;
  const total = games.length || 1;
  const rows = group(games, (g) => g.augs).filter((r) => r.n >= min);
  table("t-augs", [
    { label: "Augment", get: (r) => augName(r.key), fmt: (r) => esc(augName(r.key)) },
    { label: "Tier", get: (r) => (RARITY[state.augRarity[r.key]] || ["", 0])[1],
      fmt: (r) => { const k = RARITY[state.augRarity[r.key]]; return k ? `<span class="tier ${state.augRarity[r.key]}">${esc(t(k[0]))}</span>` : ""; } },
    { label: "Picks", get: (r) => r.n },
    { label: "Pick rate", get: (r) => r.n / total, fmt: (r) => pct(r.n / total) },
    { label: "Win rate", get: (r) => r.w / r.n, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], rows, 2);
}

// ---------- game length, boots, records, learning curve, augment pairs ----------

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// Rows of {label, n, w} drawn as win-rate bars; the dashed line marks 50%.
function wrBars(id, rows) {
  const shown = rows.filter((r) => r.n);
  $(id).innerHTML = shown.length ? shown.map((r) => {
    const rate = r.w / r.n;
    return `<div class="wrbar"><span class="wb-label">${esc(t(r.label))}</span>
      <span class="wb-track"><span class="wb-fill ${wrClass(rate)}" style="width:${(rate * 100).toFixed(1)}%"></span></span>
      <span class="wb-v ${wrClass(rate)}">${pct(rate)}</span><span class="wb-n">${r.n.toLocaleString()}</span></div>`;
  }).join("") : `<p class="foot">${esc(t("No games in this view."))}</p>`;
}

const LENGTHS = [[0, 900, "Under 15 min"], [900, 1080, "15–18 min"], [1080, 1260, "18–21 min"], [1260, 1440, "21–24 min"], [1440, 1e9, "24 min or more"]];

function renderLength(games) {
  const timed = games.filter((g) => g.duration > 0);
  $("n-length").textContent = timed.length ? t("Average {time}", { time: mmss(sum(timed, (g) => g.duration) / timed.length) }) : "";
  wrBars("wr-length", LENGTHS.map(([lo, hi, label]) => {
    const G = timed.filter((g) => g.duration >= lo && g.duration < hi);
    return { label, n: G.length, w: count(G, (g) => g.win) };
  }));
}

function renderBoots(games) {
  if (!state.boots.size) return wrBars("wr-boots", []);
  const G = games.filter((g) => g.items && g.items.length);
  const has = (g) => g.items.some((i) => state.boots.has(i));
  wrBars("wr-boots", [
    { label: "With boots", n: count(G, has), w: count(G, (g) => g.win && has(g)) },
    { label: "No boots", n: count(G, (g) => !has(g)), w: count(G, (g) => g.win && !has(g)) },
  ]);
}

const RECORDS = [
  ["Most kills", (g) => g.kills, (v) => v],
  ["Most assists", (g) => g.assists, (v) => v],
  ["Most deaths", (g) => g.deaths, (v) => v],
  ["Most damage", (g) => g.damage, (v) => v.toLocaleString()],
  ["Most damage taken", (g) => g.taken, (v) => v.toLocaleString()],
  ["Most healing", (g) => g.heal, (v) => v.toLocaleString()],
  ["Longest killing spree", (g) => g.spree, (v) => v],
  ["Best KDA", (g) => (g.kills + g.assists) / Math.max(1, g.deaths), (v) => v.toFixed(2)],
  ["Longest game", (g) => g.duration, mmss],
  ["Fastest win", (g) => (g.win && g.duration > 0 ? -g.duration : -Infinity), (v) => mmss(-v)],
];

function renderRecords(G) {
  $("records").innerHTML = RECORDS.map(([label, f, fmt]) => {
    let best = null, bv = -Infinity;
    for (const g of G) { const v = f(g); if (v > bv) { bv = v; best = g; } }
    if (!best || !Number.isFinite(bv) || bv <= 0 && !label.startsWith("Fastest")) return "";
    return `<div class="record"><div class="r-v">${fmt(bv)}</div><div class="r-label">${esc(t(label))}</div>
      <div class="r-sub">${esc(champName(best))} · ${fmtDate(new Date(best.time))}</div></div>`;
  }).join("");
}

const CURVE = [[1, 5, "Games 1–5"], [6, 10, "6–10"], [11, 20, "11–20"], [21, 1e9, "21+"]];

function renderCurve(G) {
  const byChamp = new Map();
  for (const g of [...G].sort((a, b) => a.time - b.time)) {
    const list = byChamp.get(g.champId) || [];
    list.push(g);
    byChamp.set(g.champId, list);
  }
  const rows = [...byChamp.values()].filter((l) => l.length >= 10).map((l) => {
    const r = { sample: l[0], n: l.length, b: CURVE.map(([lo, hi]) => l.slice(lo - 1, hi)) };
    const first = r.b[0], last = r.b.filter((x) => x.length).at(-1);
    r.change = count(last, (g) => g.win) / last.length - count(first, (g) => g.win) / first.length;
    return r;
  });
  const cell = (i) => ({
    label: CURVE[i][2], get: (r) => (r.b[i].length ? count(r.b[i], (g) => g.win) / r.b[i].length : -1),
    fmt: (r) => (r.b[i].length ? pct(count(r.b[i], (g) => g.win) / r.b[i].length) : "–"),
    cls: (r) => (r.b[i].length >= 3 ? wrClass(count(r.b[i], (g) => g.win) / r.b[i].length) : ""),
  });
  table("t-curve", [
    { label: "Champion", get: (r) => champName(r.sample), fmt: (r) => esc(champName(r.sample)) },
    { label: "Matches", get: (r) => r.n },
    cell(0), cell(1), cell(2), cell(3),
    { label: "Change", get: (r) => r.change, fmt: (r) => `${r.change > 0 ? "+" : ""}${(r.change * 100).toFixed(1)}`,
      cls: (r) => (r.change > 0 ? "delta-up" : r.change < 0 ? "delta-down" : "") },
  ], rows, 1);
}

function renderPairs(games) {
  const min = +$("f-minpair").value || 1;
  const map = new Map();
  for (const g of games) {
    const a = [...new Set(g.augs)].sort((x, y) => x - y);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
      const k = a[i] + "-" + a[j];
      const r = map.get(k) || { a: a[i], b: a[j], n: 0, w: 0 };
      r.n++; r.w += g.win ? 1 : 0;
      map.set(k, r);
    }
  }
  // The 100 best pairs; ties go to the pair seen in more games
  const rows = [...map.values()].filter((r) => r.n >= min).sort((x, y) => y.w / y.n - x.w / x.n || y.n - x.n).slice(0, 100);
  table("t-pairs", [
    { label: "Augments", get: (r) => augName(r.a) + augName(r.b), fmt: (r) => `${esc(augName(r.a))} + ${esc(augName(r.b))}` },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], rows, 2);
}

// Allied champions you win most with. Ties go to the champion seen in more games.
function renderAllies(games) {
  const min = +$("f-minally").value || 1;
  const map = new Map();
  for (const g of games) for (const id of new Set(g.allies)) {
    const r = map.get(id) || { id, n: 0, w: 0 };
    r.n++; r.w += g.win ? 1 : 0;
    map.set(id, r);
  }
  const rows = [...map.values()].filter((r) => r.n >= min).sort((x, y) => y.w / y.n - x.w / x.n || y.n - x.n).slice(0, 100);
  table("t-allies", [
    { label: "Teammate", get: (r) => champById(r.id), fmt: (r) => esc(champById(r.id)) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], rows, 2);
}

// Players you've teamed up with, by Riot ID, from your own games. Clicking a name opens their stats in those
// games: nothing is looked up, it's all from games you played together.
let mateOpen = null;

function mateRows(games) {
  const map = new Map();
  for (const g of games) for (const m of g.mates || []) {
    const r = map.get(m.key) || { key: m.key, name: m.name, n: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0, champs: new Map(), games: [] };
    r.name = r.games.length ? r.name : m.name; // newest name first (games come newest first)
    r.n++; r.w += g.win ? 1 : 0; r.k += m.k; r.d += m.d; r.a += m.a; r.dmg += m.dmg;
    const c = r.champs.get(m.champ) || { id: m.champ, n: 0, w: 0 };
    c.n++; c.w += g.win ? 1 : 0;
    r.champs.set(m.champ, c);
    r.games.push({ g, m });
    map.set(m.key, r);
  }
  return map;
}

function renderMates(games) {
  const min = +$("f-minmate").value || 1;
  const map = mateRows(games);
  const rows = [...map.values()].filter((r) => r.n >= min);
  $("mates-card").hidden = !map.size;
  table("t-mates", [
    { label: "Player", get: (r) => r.name.toLowerCase(), fmt: (r) => `<button type="button" class="name-btn" data-mate="${esc(r.key)}" aria-expanded="${r.key === mateOpen}">${esc(r.name)}</button>` },
    { label: "Games together", get: (r) => r.n },
    { label: "Win rate together", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
    { label: "Their KDA", get: (r) => (r.k + r.a) / Math.max(1, r.d), fmt: (r) => kda(r.k, r.d, r.a) },
  ], rows.slice(0, 100), 1);
  showMate(mateOpen && map.get(mateOpen));
}

function showMate(r) {
  const box = $("mate-panel");
  if (!r) { box.hidden = true; mateOpen = null; return; }
  const champs = [...r.champs.values()].sort((x, y) => y.n - x.n).slice(0, 6);
  const icon = (id) => `<img src="/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${Number(id)}.png" alt="" loading="lazy">`;
  box.innerHTML = `
    <div class="mate-h"><h4>${esc(t("{name} with you", { name: r.name }))}</h4>
      <button type="button" class="btn" data-mate-close>${esc(t("Close"))}</button></div>
    <div class="mate-tiles">
      <div><b>${r.n.toLocaleString()}</b><span>${esc(t("Games together"))}</span></div>
      <div><b class="${wrClass(r.w / r.n)}">${pct(r.w / r.n)}</b><span>${esc(t("Win rate together"))}</span></div>
      <div><b>${kda(r.k, r.d, r.a)}</b><span>${esc(t("Their KDA"))}</span></div>
      <div><b>${Math.round(r.dmg / r.n).toLocaleString()}</b><span>${esc(t("Their damage per game"))}</span></div>
    </div>
    <h5>${esc(t("Their champions"))}</h5>
    <ul class="mate-champs">${champs.map((c) => `<li>${icon(c.id)}<span>${esc(champById(c.id))}</span><small>${esc(t(c.n === 1 ? "1 game" : "{n} games", { n: c.n }))} · ${pct(c.w / c.n)}</small></li>`).join("")}</ul>
    <h5>${esc(t("Games together"))}</h5>
    <div class="tbl-wrap"><table class="mate-games"><thead><tr><th>${esc(t("Date"))}</th><th>${esc(t("Their champion"))}</th><th>${esc(t("Your champion"))}</th><th>${esc(t("Result"))}</th><th>${esc(t("Their K / D / A"))}</th></tr></thead><tbody>${
      r.games.slice(0, 20).map(({ g, m }) => `<tr><td>${fmtDate(new Date(g.time))}</td><td>${esc(champById(m.champ))}</td><td>${esc(champName(g))}</td><td class="${g.win ? "win" : "loss"}">${resultBanner(g.win)}</td><td>${m.k} / ${m.d} / ${m.a}</td></tr>`).join("")
    }</tbody></table></div>`;
  box.hidden = false;
}

$("t-mates").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mate]");
  if (!b) return;
  mateOpen = mateOpen === b.dataset.mate ? null : b.dataset.mate;
  render();
  if (mateOpen) $("mate-panel").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
});
$("mate-panel").addEventListener("click", (e) => {
  if (!e.target.closest("[data-mate-close]")) return;
  mateOpen = null;
  render();
});

function renderGames(games) {
  $("n-games").textContent = games.length > 200 ? t("Latest 200 of {n} matches", { n: games.length.toLocaleString() }) : t("{n} matches", { n: games.length.toLocaleString() });
  table("t-games", [
    { label: "Date", get: (r) => r.time, fmt: (r) => fmtDate(new Date(r.time)) },
    { label: "Champion", get: (r) => champName(r), fmt: (r) => esc(champName(r)) },
    { label: "Result", get: (r) => +r.win, fmt: (r) => resultBanner(r.win), cls: (r) => (r.win ? "win" : "loss") },
    { label: "K / D / A", get: (r) => (r.kills + r.assists) / Math.max(1, r.deaths), fmt: (r) => `${r.kills} / ${r.deaths} / ${r.assists}` },
    { label: "Damage", get: (r) => r.damage, fmt: (r) => r.damage.toLocaleString() },
    { label: "Length", get: (r) => r.duration, fmt: (r) => `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, "0")}` },
    { label: "Augments", get: (r) => r.augs.length, fmt: (r) => esc(r.augs.map(augName).join(", ")), cls: () => "augs" },
  ], games.slice(0, 200), 0);
}

// ---------- wiring ----------


// ---------- sync ----------
// Opened from the local sync helper, "Import games from client" adds games
// newer than the archive. Opened any other way, the button explains how.

const syncBtns = [...document.querySelectorAll(".sync-btn")];
const syncStatus = $("sync-status");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFFLINE_HINT = () => t("Connect to the Riot Client first: open it on this computer and sign in, then open this page from Open Mayhem Stats.command.");
let helperOnline = false;
// The helper serves this page at its root; the site's copy (under /embed/) has no helper behind it, so it
// never asks for the archive or the helper's endpoints.
const ON_HELPER = location.protocol !== "file:" && !location.pathname.startsWith("/embed/");

function setSyncStatus(text, error = false) {
  syncStatus.hidden = !text;
  syncStatus.textContent = text || "";
  syncStatus.classList.toggle("error", error);
}

async function syncState() {
  const res = await fetch("api/sync", { cache: "no-store" });
  if (!res.ok) throw new Error(`helper answered ${res.status}`);
  return res.json();
}

async function reloadArchive() {
  const res = await fetch("data/mayhem-backup.json", { cache: "no-store" });
  if (res.ok) await loadText(await res.text());
}

// ---------- import animation ----------
// While an import runs: a counter of new games that ticks up, a progress bar, and the champion of each new game
// popping in (ringed green for a win). Decorative: the status line above says the same for screen readers.
// With reduced motion, the numbers and icons just update.

const live = { el: $("sync-live"), shown: 0, added: 0, raf: 0, timer: 0 };
const STILL = matchMedia("(prefers-reduced-motion: reduce)");
const ICON = (id) => `/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`;

function liveStart() {
  clearTimeout(live.timer);
  Object.assign(live, { shown: 0, added: 0 });
  live.el.className = "sync-live waiting";
  live.el.hidden = false;
  $("sl-added").textContent = "0";
  $("sl-label").textContent = t("new games");
  $("sl-step").textContent = t("Finding your games…");
  $("sl-fill").style.width = "0";
  $("sl-champs").replaceChildren();
}

function countTo(n) {
  const el = $("sl-added");
  cancelAnimationFrame(live.raf);
  const from = Number(el.textContent.replace(/\D/g, "")) || 0;
  if (n !== from) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  if (STILL.matches || n <= from) { el.textContent = n.toLocaleString(); return; }
  const start = performance.now(), span = Math.min(600, 80 * (n - from));
  const step = (now) => {
    const k = Math.min(1, (now - start) / span);
    el.textContent = Math.round(from + (n - from) * k).toLocaleString();
    if (k < 1) live.raf = requestAnimationFrame(step);
  };
  live.raf = requestAnimationFrame(step);
}

function addChamps(picks) {
  const row = $("sl-champs");
  picks.forEach((p, i) => {
    const img = new Image();
    img.src = ICON(p.champion);
    img.alt = "";
    img.className = p.win ? "win" : "";
    img.style.animationDelay = `${i * 70}ms`;
    img.onerror = () => img.remove();
    row.append(img);
  });
  // Keep the row to what fits; the oldest shrink away.
  const keep = Math.max(4, Math.floor(row.clientWidth / 46) || 12);
  [...row.children].filter((c) => !c.classList.contains("out")).slice(0, -keep).forEach((c) => {
    if (STILL.matches) return c.remove();
    c.classList.add("out");
    c.addEventListener("animationend", () => c.remove(), { once: true });
  });
}

function liveUpdate(s) {
  const p = s.progress;
  const last = s.log.at(-1) || "";
  const nums = last.match(/\[(\d+)\/(\d+)\]|(\d+) of (\d+)/);
  let done = 0, total = 0, step = t("Finding your games…");
  if (p && p.total && p.done < p.total) {
    [done, total, step] = [p.done, p.total, t("Importing games")];
  } else if (/kill positions/.test(last)) {
    step = t("Mapping kills");
  } else if (/^Shared/.test(last)) {
    step = t("Sharing games");
  } else if (/^Saved/.test(last)) {
    step = t("Saving to your account");
  } else if (p) {
    step = t("Importing games");
    if (p.total) [done, total] = [p.done, p.total];
  }
  if (!total && nums && !(p && p.total && p.done < p.total)) [done, total] = [Number(nums[1] || nums[3]), Number(nums[2] || nums[4])];
  live.el.classList.toggle("waiting", !total);
  $("sl-fill").style.width = total ? `${Math.round((100 * done) / total)}%` : "0";
  $("sl-step").textContent = total ? `${step} · ${done.toLocaleString()}/${total.toLocaleString()}` : step;
  if (p && p.added > live.added) {
    const fresh = Math.min(p.added - live.added, p.recent.length);
    addChamps(p.recent.slice(-fresh));
    live.added = p.added;
    $("sl-label").textContent = t(p.added === 1 ? "new game" : "new games");
    countTo(p.added);
  }
}

function liveEnd(ok) {
  if (!ok) { live.el.hidden = true; return; }
  live.el.classList.remove("waiting");
  live.el.classList.add("done");
  $("sl-step").textContent = t("Done");
  live.timer = setTimeout(() => {
    if (STILL.matches) { live.el.hidden = true; return; }
    live.el.classList.add("leaving");
    setTimeout(() => { live.el.hidden = true; }, 500);
  }, 5000);
}

async function watchSync() {
  for (const b of syncBtns) { b.dataset.label ||= b.textContent; b.disabled = true; }
  let ok = false;
  liveStart();
  try {
    let s = await syncState();
    while (s.running) {
      setSyncStatus(s.log.length ? t(s.log.at(-1)) : t("Importing…"));
      liveUpdate(s);
      await sleep(500);
      s = await syncState();
    }
    if (s.error) {
      setSyncStatus(t(s.error), true);
    } else if (s.result) {
      ok = true;
      liveUpdate(s);
      const { added, total, failed } = s.result;
      await reloadArchive();
      const summary = added
        ? t(added === 1 ? "Added 1 new game. {total} in your archive." : "Added {n} new games. {total} in your archive.", { n: added, total })
        : t("Up to date. {total} games in your archive.", { total });
      setSyncStatus(summary + (failed ? " " + t("{n} couldn't be fetched; import again to retry them.", { n: failed }) : "")
        + ((s.result.notes || []).filter((n) => n.startsWith("Sharing") || n.startsWith("Saving")).map((n) => " " + t(n)).join("")));
      if (s.result.shared !== undefined) showShare({ enabled: true, shared: s.result.shared });
      if (s.result.saved !== undefined) showHistory({ enabled: true, available: true, saved: s.result.saved });
    }
  } catch (e) {
    setSyncStatus(t("Lost contact with the sync helper. Is it still running?"), true);
  } finally {
    liveEnd(ok);
    for (const b of syncBtns) b.disabled = false;
  }
}

const startSync = async () => {
  if (!helperOnline) {
    if (!ON_HELPER) return setSyncStatus(OFFLINE_HINT());
    // the helper may have been started since the page loaded
    try { await syncState(); helperOnline = true; } catch (e) { return setSyncStatus(OFFLINE_HINT()); }
  }
  setSyncStatus(t("Starting…"));
  try {
    const res = await fetch("api/sync", { method: "POST", headers: { "X-Mayhem": "1" } });
    if (!res.ok && res.status !== 409) throw new Error(String(res.status));
  } catch (e) {
    return setSyncStatus(t("Couldn't reach the sync helper."), true);
  }
  watchSync();
};
for (const b of syncBtns) b.addEventListener("click", startSync);

async function setupSync() {
  // The empty state already explains Sync, so this only picks up a running sync
  if (PRESET.sample || !ON_HELPER) return;
  try {
    const s = await syncState();
    helperOnline = true;
    if (s.running) watchSync();
  } catch (e) { /* no helper; the button explains when pressed */ }
}

// Opened from the sync helper, load the archive it keeps.
(async () => {
  await loadLang();
  if (PRESET.sample) return loadText(JSON.stringify(PRESET.sample), { sample: true });
  if (ON_HELPER) {
    try {
      const res = await fetch("data/mayhem-backup.json", { cache: "no-store" });
      if (res.ok) await loadText(await res.text());
    } catch (e) { /* no archive yet */ }
  } else await loadSaved();
  await setupSync();
  setupProfile();
  setupShare();
  setupHistory();
  setupLive();
  setupLink();
})();

// ---------- public page ----------
// Off unless the player publishes. Only totals, top champions and earned achievements leave the computer.

const profileCard = $("profile-card");
const profileText = $("profile-text");
const profileLink = $("profile-link");
const profileBtns = { publish: $("profile-publish"), remove: $("profile-remove") };

function profileSummary(G) {
  const champs = new Map();
  for (const g of G) {
    const c = champs.get(g.champId) || { id: g.champId, n: 0, w: 0, k: 0, d: 0, a: 0 };
    c.n++; c.w += g.win ? 1 : 0; c.k += g.kills; c.d += g.deaths; c.a += g.assists;
    champs.set(g.champId, c);
  }
  const n = G.length;
  return {
    games: n, wins: sum(G, (g) => g.win),
    kills: sum(G, (g) => g.kills), deaths: sum(G, (g) => g.deaths), assists: sum(G, (g) => g.assists),
    damage: Math.round(sum(G, (g) => g.damage) / n), duration: Math.round(sum(G, (g) => g.duration) / n),
    first: Math.min(...G.map((g) => g.time)), last: Math.max(...G.map((g) => g.time)),
    champions: [...champs.values()].sort((a, b) => b.n - a.n).slice(0, 10),
    badges: badgeRows(G).filter((r) => r.have >= r.goal).map((r) => r.name),
  };
}

function showProfile(p) {
  const on = !!(p && p.published);
  profileText.textContent = t(on
    ? "Your public page is live. Update it after importing new games, or remove it any time."
    : "Off. Publish a public page with your totals, top champions and achievements. Your individual games stay on this computer.");
  profileLink.hidden = !on;
  if (on) { profileLink.href = p.url; profileLink.textContent = p.url.replace(/^https?:\/\//, ""); }
  profileBtns.publish.textContent = t(on ? "Update my page" : "Publish my page");
  profileBtns.remove.hidden = !on;
}

async function profileCall(action, data) {
  const res = await fetch("api/profile", {
    method: "POST", headers: { "X-Mayhem": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(j.error || "Something went wrong. Try again."));
  return j;
}

async function profileAction(action) {
  if (action === "remove" && !confirm(t("Remove your public page? Anyone with the link will see it's gone."))) return;
  for (const b of Object.values(profileBtns)) b.disabled = true;
  try {
    showProfile(await profileCall(action, action === "publish" ? profileSummary(state.games) : undefined));
  } catch (e) {
    profileText.textContent = e.message;
  } finally {
    for (const b of Object.values(profileBtns)) b.disabled = false;
  }
}
profileBtns.publish.addEventListener("click", () => profileAction("publish"));
profileBtns.remove.addEventListener("click", () => profileAction("remove"));

async function setupProfile() {
  // Publishing goes through the helper, so the card only shows when it's running and there are games
  if (!helperOnline || state.sample || !(state.games || []).length) return;
  profileCard.hidden = false;
  showProfile(null);
  try { showProfile(await profileCall("status")); } catch (e) { /* stays "Off" until they try */ }
}

// ---------- connect account ----------
// Links the Riot account signed in to this computer to a deeparam.com account. One click: the helper opens the
// account page, the player confirms there, and this page notices (it asks every few seconds and when the window
// comes back into focus). The player can also tick "save my games" on that page, and saving then starts here.
// The helper proves which Riot account it is; nothing else is sent.

const linkStatus = $("link-status");
const PAIR_EVERY = 10000; // the site allows a few requests a minute from the helper
let pairing = null;

function linked(j) {
  linkStatus.textContent = j.riotId
    ? t("Connected {riotId}. Reload your account page on deeparam.com to see it.", { riotId: j.riotId })
    : t("Connected your Riot account. Reload your account page on deeparam.com to see it.");
}

async function pairCall(body) {
  const res = await fetch("api/profile", {
    method: "POST", headers: { "X-Mayhem": "1", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(j.error || "Something went wrong. Try again."));
  return j;
}

async function checkPair() {
  if (!pairing || pairing.busy || Date.now() - pairing.last < 4000) return;
  pairing.busy = true;
  pairing.last = Date.now();
  try {
    const j = await pairCall({ action: "pair-status", pair: pairing.id });
    if (j.expired) return stopPair(t("That took too long. Choose Connect to deeparam.com again."));
    if (!j.linked) return;
    stopPair();
    linked(j);
    if (j.share) {
      // Ticked on the account page: turn sharing on here, as the box in the sharing card would.
      const note = $("share-status");
      try {
        showShare(await shareCall({ enabled: true }));
        note.hidden = false;
        note.textContent = t("Sharing is on. New games are shared after each import.");
      } catch (e) { note.hidden = false; note.textContent = e.message; }
    }
    if (j.save) {
      // Ticked on the account page: save the games here to the account, then import any new ones.
      showHistory({ enabled: true, available: true, saved: 0 });
      const note = $("history-status");
      note.hidden = false;
      note.textContent = t("Saving your games…");
      try {
        showHistory(await historyCall({ enabled: true }));
        note.textContent = t("Saving is on. New games are saved after each import.");
        startSync();
      } catch (e) { note.textContent = e.message; }
    }
  } catch (e) { /* try again on the next tick */ } finally {
    if (pairing) pairing.busy = false;
  }
}

function stopPair(msg) {
  if (pairing) clearInterval(pairing.timer);
  pairing = null;
  $("pair-start").disabled = false;
  if (msg) linkStatus.textContent = msg;
}

$("pair-start").addEventListener("click", async () => {
  const btn = $("pair-start");
  btn.disabled = true;
  linkStatus.hidden = false;
  linkStatus.textContent = t("Opening your account page…");
  try {
    const j = await pairCall({ action: "pair" });
    if (!j.pair) throw new Error(t("Something went wrong. Try again."));
    if (pairing) clearInterval(pairing.timer);
    pairing = { id: j.pair, last: Date.now(), busy: false, timer: setInterval(checkPair, PAIR_EVERY) };
    linkStatus.textContent = t("Your account page opened in your browser. Sign in if you need to, then choose Connect there. This page updates by itself.");
  } catch (err) {
    stopPair(err.message);
  }
});
addEventListener("focus", checkPair);

function setupLink() {
  if (helperOnline && !state.sample) $("link-card").hidden = false;
}

// ---------- sharing ----------
// Off unless the player ticks the box; the helper sends games without names or account ids.

const shareBox = $("share-on");

function showShare(st) {
  shareBox.checked = !!st.enabled;
  $("share-count").textContent = st.enabled && st.shared ? t("{n} games shared", { n: st.shared.toLocaleString() }) : "";
}

async function shareCall(body) {
  const res = await fetch("api/share", {
    method: "POST", headers: { "X-Mayhem": "1", "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(j.error || "Something went wrong. Try again."));
  return j;
}

shareBox.addEventListener("change", async () => {
  const on = shareBox.checked;
  if (!on && !confirm(t("Stop sharing and remove the games you've shared?"))) { shareBox.checked = true; return; }
  const note = $("share-status");
  shareBox.disabled = true;
  note.hidden = false;
  note.textContent = t(on ? "Sharing your games…" : "Removing your shared games…");
  try {
    showShare(await shareCall({ enabled: on }));
    note.textContent = t(on ? "Sharing is on. New games are shared after each import." : "Sharing is off and your shared games were removed.");
  } catch (e) {
    shareBox.checked = !on;
    note.textContent = e.message;
  } finally {
    shareBox.disabled = false;
  }
});

async function setupShare() {
  if (!helperOnline || state.sample || !(state.games || []).length) return;
  $("share-card").hidden = false;
  try { showShare(await shareCall()); } catch (e) { /* stays off */ }
}

// ---------- games saved to the account ----------
// The site owner can keep their games with their deeparam.com account, so My Stats on /account shows them
// on any device. Off unless turned on here; the site only accepts it from the owner's connected Riot account.

const historyBox = $("history-on");

function showHistory(st) {
  $("history-card").hidden = !st.available;
  historyBox.checked = !!st.enabled;
  $("history-count").textContent = st.enabled && st.saved ? t("{n} games saved", { n: st.saved.toLocaleString() }) : "";
}

async function historyCall(body) {
  const res = await fetch("api/history", {
    method: "POST", headers: { "X-Mayhem": "1", "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(j.error || "Something went wrong. Try again."));
  return j;
}

historyBox.addEventListener("change", async () => {
  const on = historyBox.checked;
  if (!on && !confirm(t("Stop saving and remove the games saved to your account?"))) { historyBox.checked = true; return; }
  const note = $("history-status");
  historyBox.disabled = true;
  note.hidden = false;
  note.textContent = t(on ? "Saving your games…" : "Removing your saved games…");
  try {
    showHistory(await historyCall({ enabled: on }));
    note.textContent = t(on ? "Saving is on. New games are saved after each import." : "Saving is off and your saved games were removed.");
  } catch (e) {
    historyBox.checked = !on;
    note.textContent = e.message;
  } finally {
    historyBox.disabled = false;
  }
});

async function setupHistory() {
  if (!helperOnline || state.sample || !(state.games || []).length) return;
  try { showHistory(await historyCall()); } catch (e) { /* stays hidden */ }
}

// On deeparam.com, signed in: the games saved to the account, when there are any.
async function loadSaved() {
  if (PRESET.sample || !/(?:^|;\s*)deeparam-signed-in=1/.test(document.cookie)) return;
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (!res.ok) return;
    const j = await res.json();
    if (Array.isArray(j.games) && j.games.length) await loadText(JSON.stringify(j));
  } catch (e) { /* nothing saved */ }
}

// ---------- recently played ----------
// Opened from the helper, a link carries the latest games to deeparam.com in the address's #part, which
// browsers never send anywhere; the site keeps them in this browser only. With them go the most-played
// champions, the champions this account owns and the chosen banner, for the site's own pages.
function mostPlayed(n) {
  const counts = new Map();
  for (const g of state.games) if (state.champAlias[g.champId]) counts.set(g.champId, (counts.get(g.champId) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => state.champAlias[id]);
}

function linkRecentlyPlayed() {
  const link = $("to-site");
  if (state.sample || !["127.0.0.1", "localhost"].includes(location.hostname)) return;
  const played = state.games.filter((g) => state.champAlias[g.champId]).slice(0, 12)
    .map((g) => ({ champion: state.champAlias[g.champId], win: g.win, at: g.time + g.duration * 1000 }));
  const payload = { played, top: mostPlayed(10) };
  if (state.owned) payload.owned = state.owned.champions.map((id) => state.champAlias[id]).filter(Boolean);
  const banner = savedBanner();
  if (banner) payload.banner = banner;
  link.hidden = !played.length;
  link.href = "https://deeparam.com/embed/dashboard/played.html#" + encodeURIComponent(JSON.stringify(payload));
}

// ---------- banner ----------
// A champion's splash art behind the page header: the player's pick (from the champions they own, when the
// client sync has said which), or their most-played champion. Always the champion's default art.

const BANNER_KEY = "mayhem-banner";
const splashUrl = (b) => `/assets/dd/img/champion/splash/${b.champion}_0.jpg`;

function savedBanner() {
  try {
    const b = JSON.parse(localStorage.getItem(BANNER_KEY) || "null");
    if (b && /^[A-Za-z]{2,30}$/.test(b.champion)) return { champion: b.champion, num: 0 };
  } catch (e) { /* storage blocked */ }
  return null;
}

function showBanner(b) {
  const head = document.querySelector(".head");
  head.classList.toggle("has-banner", !!b);
  head.style.setProperty("--banner", b ? `url("${splashUrl(b)}")` : "none");
}

function setupBanner() {
  const ids = Object.keys(state.champAlias).map(Number);
  if (!ids.length) return;
  const fallback = mostPlayed(1)[0];
  let banner = savedBanner() || (fallback ? { champion: fallback, num: 0 } : null);
  showBanner(banner);

  const champSel = $("banner-champ");
  const pool = state.owned ? state.owned.champions.filter((id) => state.champAlias[id]) : ids;
  champSel.innerHTML = pool.map((id) => [id, localName(id) || state.champNames[id] || state.champAlias[id]]).sort((a, b) => a[1].localeCompare(b[1], LANG))
    .map(([id, name]) => `<option value="${state.champAlias[id]}">${esc(name)}</option>`).join("");
  $("banner-note").textContent = state.owned ? t("Champions you own") : "";
  if (banner) champSel.value = banner.champion;
  champSel.onchange = () => {
    banner = { champion: champSel.value, num: 0 };
    try { localStorage.setItem(BANNER_KEY, JSON.stringify(banner)); } catch (e) { /* not remembered */ }
    showBanner(banner);
    linkRecentlyPlayed();
  };
  $("banner-btn").onclick = () => {
    const pickEl = $("banner-pick");
    pickEl.hidden = !pickEl.hidden;
    $("banner-btn").setAttribute("aria-expanded", String(!pickEl.hidden));
  };
}

// ---------- recorded games ----------
// The helper records each game while it's played. A recording is
// matched to its synced game by champion and start time, which supplies the result and damage.

const MATCH_WINDOW_MS = 5 * 60 * 1000;
const terrainName = (r) => (r.mapTerrain && r.mapTerrain !== "Default" ? r.mapTerrain.replace(/([a-z])([A-Z])/g, "$1 $2") : t(MAP_NAMES[r.map] || "Map {id}", { id: r.map }));
const lastSnap = (r) => r.snapshots[r.snapshots.length - 1] || { stats: {}, items: [], augments: [] };

function matchGame(r) {
  const champ = r.player.champion;
  let best = null;
  for (const g of state.games) {
    const dt = Math.abs(g.time - r.startedAt);
    if (dt < MATCH_WINDOW_MS && (champName(g) === champ || state.champNames[g.champId] === champ || g.champNameRaw === champ) && (!best || dt < best.dt)) best = { g, dt };
  }
  return best && best.g;
}

// Augments in the order the game first reported them, with the game time each appeared.
function pickOrder(r) {
  const seen = new Map();
  for (const s of r.snapshots) for (const a of s.augments || []) {
    const id = typeof a === "object" ? a.id : a;
    if (id && !seen.has(id)) seen.set(id, s.t);
  }
  return [...seen.entries()].map(([id, t]) => ({ id, t }));
}

const augLabel = (id) => (typeof id === "number" || /^\d+$/.test(id) ? augName(id) : String(id));

function renderLive() {
  const recs = state.live.map((r) => ({ r, g: matchGame(r), last: lastSnap(r), picks: pickOrder(r) }));
  const st = (x, k) => Math.round(x.last.stats[k] || 0);
  table("t-live", [
    { label: "Date", get: (x) => x.r.startedAt, fmt: (x) => fmtDate(new Date(x.r.startedAt)) },
    { label: "Champion", get: (x) => x.r.player.champion || "", fmt: (x) => esc(x.r.player.champion || "") },
    { label: "Map", get: (x) => terrainName(x.r), fmt: (x) => esc(terrainName(x.r)) },
    { label: "Result", get: (x) => (x.g ? +x.g.win : -1), fmt: (x) => (x.g ? resultBanner(x.g.win) : esc(t("Not synced"))), cls: (x) => (x.g ? (x.g.win ? "win" : "loss") : "") },
    { label: "Length", get: (x) => x.r.gameTime, fmt: (x) => mmss(x.r.gameTime) },
    { label: "Level", get: (x) => x.last.level || 0 },
    { label: "AD", get: (x) => st(x, "attackDamage") },
    { label: "AP", get: (x) => st(x, "abilityPower") },
    { label: "Health", get: (x) => st(x, "maxHealth") },
    { label: "Armor / MR", get: (x) => st(x, "armor"), fmt: (x) => `${st(x, "armor")} / ${st(x, "magicResist")}` },
    { label: "Damage", get: (x) => (x.g ? x.g.damage : 0), fmt: (x) => (x.g ? x.g.damage.toLocaleString() : "") },
    { label: "Augments in order", get: (x) => x.picks.length, cls: () => "augs",
      fmt: (x) => esc(x.picks.map((p) => `${augLabel(p.id)} (${mmss(p.t)})`).join(", ")) },
  ], recs, 0);

  const picks = new Map();
  for (const x of recs) if (x.g) x.picks.forEach((p, i) => {
    const k = p.id + "|" + i;
    const row = picks.get(k) || { id: p.id, pick: i + 1, n: 0, w: 0 };
    row.n++; row.w += x.g.win ? 1 : 0;
    picks.set(k, row);
  });
  table("t-picks", [
    { label: "Augment", get: (r) => augLabel(r.id), fmt: (r) => esc(augLabel(r.id)) },
    { label: "Pick", get: (r) => r.pick, fmt: (r) => esc(t(["1st", "2nd", "3rd"][r.pick - 1] || "{n}th", { n: r.pick })) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], [...picks.values()], 3);

  const maps = group(recs.filter((x) => x.g).map((x) => ({ ...x.g, mapLabel: terrainName(x.r) })), (g) => g.mapLabel);
  wrBars("wr-map", maps.map((m) => ({ label: m.key, n: m.n, w: m.w })));
}

async function setupLive() {
  if (!helperOnline || state.sample) return;
  try {
    const res = await fetch("api/live", { cache: "no-store" });
    if (!res.ok) return;
    const live = await res.json();
    if (!live.enabled) return;
    state.live = (live.games || []).filter((r) => r && r.player && Array.isArray(r.snapshots));
    $("live-card").hidden = false;
    $("live-status").textContent = live.recording ? t("Recording a game ({champion})", { champion: live.recording }) : t("{n} recorded", { n: state.live.length });
    renderLive();
  } catch (e) { /* older helper without recording */ }
}
