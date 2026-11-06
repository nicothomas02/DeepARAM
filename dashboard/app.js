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
  // Your team's kills and damage, for kill participation and damage share: only when every teammate's stats are in the game.
  const team = (info.participants || []).filter((o) => o.teamId === p.teamId);
  const ts = (o) => o.stats || o;
  const full = team.length > 1 && team.every((o) => typeof ts(o).kills === "number" && typeof ts(o).totalDamageDealtToChampions === "number");
  const myDmg = s.totalDamageDealtToChampions || 0;
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
    enemies: (info.participants || []).filter((o) => o.teamId !== p.teamId && o.championId > 0).map((o) => o.championId),
    teamKills: full ? team.reduce((n, o) => n + ts(o).kills, 0) : null,
    teamDmg: full ? team.reduce((n, o) => n + ts(o).totalDamageDealtToChampions, 0) : null,
    topDmg: full ? team.every((o) => o === p || ts(o).totalDamageDealtToChampions <= myDmg) : null,
  };
}

// Champion and augment names; if unavailable the page falls back to ids.
async function loadItems() {
  try {
    const items = await (await fetch("/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json")).json();
    for (const it of items) {
      const cats = it.categories || [];
      if (cats.includes("Boots") && !(it.id >= 550000 && it.id < 560000)) state.boots.add(it.id);
      ITEMS[it.id] = {
        name: it.name,
        // the client's icon path, as mirrored on the site (lower case)
        icon: it.iconPath ? "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/" + it.iconPath.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase() : "",
        // finished items and boots: what the champion page lists, without potions, wards and components
        full: !cats.includes("Consumable") && !cats.includes("Trinket") && (cats.includes("Boots") || !(it.to || []).length),
      };
    }
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
  for (const id of ["f-patch", "f-queue", "f-from", "f-to", "f-champ", "f-minaug", "f-minpair", "f-minally", "f-minmate", "f-minenemy"]) $(id).addEventListener("input", render);
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
  renderForm(games);
  renderFacts(games);
  renderChamps(games);
  renderAugs(games);
  renderChart(games);
  renderGames(games);
  renderWhen(games);
  renderSessions(games);
  renderShare(games);
  renderLength(games);
  renderBoots(games);
  renderEnemies(games);
  renderAllies(games);
  renderCurve(state.games);
  renderPairs(games);
  renderMates(games);
  renderKillMap(games);
  renderRecords(state.games);
  renderTotals(state.games);
  renderBadges(state.games);
  if (state.live.length) renderLive();
  renderDetail();
}

function sum(games, f) { return games.reduce((t, g) => t + f(g), 0); }

function renderTiles(games) {
  const n = games.length;
  const wins = sum(games, (g) => g.win);
  const K = sum(games, (g) => g.kills), D = sum(games, (g) => g.deaths), A = sum(games, (g) => g.assists);
  const dmg = n ? sum(games, (g) => g.damage) / n : 0;
  const dur = n ? sum(games, (g) => g.duration) / n : 0;
  const kp = shareOf(games, (g) => g.kills + g.assists, (g) => g.teamKills);
  const ds = shareOf(games, (g) => g.damage, (g) => g.teamDmg);
  const tiles = [
    ["Total matches", n.toLocaleString(), t("{w} W · {l} L", { w: wins, l: n - wins }) + (n < state.games.length ? " · " + t("of {n}", { n: state.games.length.toLocaleString() }) : "")],
    ["Win rate", n ? pct(wins / n) : "–", "", n ? wrClass(wins / n) : ""],
    ["KDA", n ? kda(K, D, A) : "–", n ? `${(K / n).toFixed(1)} / ${(D / n).toFixed(1)} / ${(A / n).toFixed(1)}` : ""],
    ["Damage to champions", n ? Math.round(dmg).toLocaleString() : "–", t("per game")],
    ["Game length", n ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}` : "–", t("average")],
    ["Kill participation", kp ? pct(kp.v) : "–", kp ? t("average") : ""],
    ["Damage share", ds ? pct(ds.v) : "–", ds ? t("of your team's damage") : ""],
    ["Champions played", new Set(games.map((g) => g.champId)).size, ""],
  ];
  $("tiles").innerHTML = tiles.map(([l, v, s, c]) =>
    `<div class="tile ${c || ""}"><div class="label">${esc(t(l))}</div><div class="value">${v}</div><div class="sub">${esc(s)}</div></div>`).join("");
}

// Average share of your team's total, over the games where every teammate's stats are known: {v, n} or null.
function shareOf(games, mine, teamTotal) {
  const G = games.filter((g) => teamTotal(g) > 0);
  return G.length ? { v: sum(G, (g) => mine(g) / teamTotal(g)) / G.length, n: G.length } : null;
}

const winRate = (G) => (G.length ? count(G, (g) => g.win) / G.length : 0);
const champIcon = (id) => `<img src="/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${Number(id)}.png" alt="" loading="lazy" width="44" height="44">`;
const tileHtml = ([l, v, s, c]) => `<div class="tile ${c || ""}"><div class="label">${esc(l)}</div><div class="value">${v}</div><div class="sub">${esc(s || "")}</div></div>`;
const ptsText = (d) => `${d > 0.05 ? "▲ " : d < -0.05 ? "▼ " : ""}${Math.abs(d).toFixed(1)}`;

// ---------- sessions ----------
// A session is a run of games with breaks under 45 minutes between one game's end and the next one's start.
// Worked out over every game, so a filtered view still knows which game came before each one.
const SESSION_GAP = 45 * 60 * 1000;
let sessionCache = null;

function sessionInfo() {
  if (sessionCache && sessionCache.games === state.games) return sessionCache;
  const info = new Map();
  let prev = null, cur = null;
  for (const g of [...state.games].sort((a, b) => a.time - b.time)) {
    const same = prev && g.time - (prev.time + prev.duration * 1000) <= SESSION_GAP;
    if (!same) cur = [];
    info.set(g, { pos: cur.length + 1, prev: same ? prev : null, session: cur });
    cur.push(g);
    prev = g;
  }
  return (sessionCache = { games: state.games, info });
}

// The sessions that have games in this view, each holding only those games, oldest first.
function viewSessions(games) {
  const { info } = sessionInfo();
  const map = new Map();
  for (const g of games) {
    const s = info.get(g).session;
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(g);
  }
  return [...map.values()].map((l) => l.sort((a, b) => a.time - b.time));
}

// ---------- recent form ----------

function renderForm(games) {
  const last = games.slice(0, 20);
  $("form-note").textContent = last.length ? t("Latest {n} games, newest first", { n: last.length }) : "";
  $("form-strip").innerHTML = last.map((g) => {
    const tip = `${champName(g)} · ${t(g.win ? "Win" : "Loss")} · ${g.kills} / ${g.deaths} / ${g.assists} · ${fmtDate(new Date(g.time))}`;
    return `<a href="${champHref(g.champId)}"><img class="${g.win ? "win" : "loss"}" src="${ICON(g.champId)}" alt="${esc(champName(g))}" title="${esc(tip)}" loading="lazy" width="44" height="44"></a>`;
  }).join("");
  if (!games.length) { $("form-tiles").innerHTML = ""; return; }
  let run = 0;
  for (const g of games) { if (g.win !== games[0].win) break; run++; }
  const streakText = games[0].win ? (run === 1 ? t("1 win") : t("{n} wins", { n: run })) : (run === 1 ? t("1 loss") : t("{n} losses", { n: run }));
  const lastWr = winRate(last), allWr = winRate(games);
  const K = (G) => kda(sum(G, (g) => g.kills), sum(G, (g) => g.deaths), sum(G, (g) => g.assists));
  const lately = group(last, (g) => g.champId).sort((a, b) => b.n - a.n || b.w - a.w)[0];
  const tiles = [
    [t("Current streak"), esc(streakText), "", games[0].win ? "wr-high" : "wr-low"],
    [t("Win rate, last {n}", { n: last.length }), pct(lastWr), t("{d} pts vs all games in this view", { d: ptsText((lastWr - allWr) * 100) }), wrClass(lastWr)],
    [t("KDA, last {n}", { n: last.length }), K(last), t("{kda} in all games in this view", { kda: K(games) })],
  ];
  if (lately && lately.n > 1) tiles.push([t("Most played lately"), esc(champName(lately.sample)), t("{n} of the last {m} games", { n: lately.n, m: last.length })]);
  $("form-tiles").innerHTML = tiles.map(tileHtml).join("");
}

// ---------- fun facts ----------
// Short findings picked from the games in view. A fact needs enough games behind it to show.

const FACT_MIN = 10; // games behind a "best day", "best time" or "after a loss" fact
const weekdayName = (i) => new Intl.DateTimeFormat(LANG, { weekday: "long" }).format(new Date(2024, 0, 1 + i)); // 2024-01-01 was a Monday
const weekday = (g) => (new Date(g.time).getDay() + 6) % 7; // Monday 0 … Sunday 6
const hourName = (h) => new Intl.DateTimeFormat(LANG, { hour: "numeric" }).format(new Date(2024, 0, 1, h));
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const hourSlot = (g) => Math.floor(new Date(g.time).getHours() / 3) * 3;
const slotName = (h) => `${hourName(h)}–${hourName((h + 3) % 24)}`;

function enemyRows(games) {
  return group(games, (g) => [...new Set(g.enemies || [])]);
}

function bestBy(rows, min) {
  return rows.filter((r) => r.n >= min).sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n)[0];
}

function renderFacts(games) {
  const el = $("facts");
  if (!games.length) { el.innerHTML = `<p class="foot">${esc(t("No games in this view."))}</p>`; return; }
  const facts = [];
  const add = (label, value, sub, icon) => facts.push({ label, value, sub, icon });
  const games1 = (r) => (r.n === 1 ? t("1 game") : t("{n} games", { n: r.n.toLocaleString() }));

  const hours = sum(games, (g) => g.duration) / 3600;
  add("Time played", t("{n} h", { n: Math.round(hours).toLocaleString() }),
    hours >= 24 ? t("That's {n} full days", { n: (hours / 24).toFixed(1) }) : games1({ n: games.length }));

  const champs = group(games, (g) => g.champId).sort((a, b) => b.n - a.n || b.w - a.w);
  const comfort = champs[0];
  add("Comfort pick", champLink(comfort.key, champName(comfort.sample)), t("{games}, {wr} win rate", { games: games1(comfort), wr: pct(comfort.w / comfort.n) }), comfort.key);
  const best = bestBy(champs, FACT_MIN);
  if (best && best !== comfort) add("Best champion", champLink(best.key, champName(best.sample)), t("{games}, {wr} win rate", { games: games1(best), wr: pct(best.w / best.n) }), best.key);

  const { info } = sessionInfo();
  const after = (won) => games.filter((g) => { const p = info.get(g).prev; return p && p.win === won; });
  const afterL = after(false), afterW = after(true);
  if (afterL.length >= FACT_MIN && afterW.length >= FACT_MIN) {
    const bounce = winRate(afterL) >= winRate(afterW);
    add(bounce ? "Bounce back" : "Tilt check", pct(winRate(afterL)), t("Win rate right after a loss, vs {wr} right after a win", { wr: pct(winRate(afterW)) }));
  }

  const day = bestBy(group(games, weekday), FACT_MIN);
  if (day) add("Best day", esc(weekdayName(day.key)), t("{games}, {wr} win rate", { games: games1(day), wr: pct(day.w / day.n) }));
  const slot = bestBy(group(games, hourSlot), FACT_MIN);
  if (slot) add("Best time to play", esc(slotName(slot.key)), t("{games}, {wr} win rate", { games: games1(slot), wr: pct(slot.w / slot.n) }));

  const known = games.filter((g) => g.topDmg != null);
  if (known.length >= FACT_MIN) {
    const top = known.filter((g) => g.topDmg);
    add("Top damage on your team", pct(top.length / known.length), top.length ? t("You win {wr} of those games", { wr: pct(winRate(top)) }) : "");
  }

  const enemies = enemyRows(games).filter((r) => r.n >= 4);
  if (enemies.length >= 2) {
    enemies.sort((a, b) => a.w / a.n - b.w / b.n || b.n - a.n);
    const nem = enemies[0];
    add("Nemesis", champLink(nem.key, champById(nem.key)), t("You win {wr} of {games} against them", { wr: pct(nem.w / nem.n), games: games1(nem) }), nem.key);
    const fav = enemies.slice(1).sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n)[0];
    add("Favorite opponent", champLink(fav.key, champById(fav.key)), t("You win {wr} of {games} against them", { wr: pct(fav.w / fav.n), games: games1(fav) }), fav.key);
  }

  const days = group(games, (g) => new Date(g.time).toDateString()).sort((a, b) => b.n - a.n || b.w - a.w);
  if (days[0].n > 1) add("Busiest day", games1(days[0]), `${fmtDate(new Date(days[0].sample.time))} · ${t("{w} W · {l} L", { w: days[0].w, l: days[0].n - days[0].w })}`);

  const longest = viewSessions(games).sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length > 2) {
    const w = count(longest, (g) => g.win);
    const mins = (longest.at(-1).time + longest.at(-1).duration * 1000 - longest[0].time) / 3600000;
    add("Longest session", games1({ n: longest.length }), `${fmtDate(new Date(longest[0].time))} · ${t("{n} h", { n: mins.toFixed(1) })} · ${t("{w} W · {l} L", { w, l: longest.length - w })}`);
  }

  const augs = group(games, (g) => [...new Set(g.augs)]).sort((a, b) => b.n - a.n || b.w - a.w)[0];
  if (augs && augs.n > 2) add("Favorite augment", esc(augName(augs.key)), t("Picked in {games}, {wr} win rate", { games: games1(augs), wr: pct(augs.w / augs.n) }));

  el.innerHTML = facts.map((f) => `<div class="fact">${f.icon != null ? `<a href="${champHref(f.icon)}" tabindex="-1">${champIcon(f.icon)}</a>` : ""}<div>
    <div class="f-label">${esc(t(f.label))}</div><div class="f-v">${f.value}</div><div class="f-sub">${esc(f.sub)}</div></div></div>`).join("");
}

// ---------- when you play, sessions, your share of the team ----------

function renderWhen(games) {
  wrBars("wr-hour", HOURS.map((h) => {
    const G = games.filter((g) => hourSlot(g) === h);
    return { label: slotName(h), n: G.length, w: count(G, (g) => g.win) };
  }));
  wrBars("wr-day", [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const G = games.filter((g) => weekday(g) === d);
    return { label: weekdayName(d), n: G.length, w: count(G, (g) => g.win) };
  }));
}

const SESSION_POS = [[1, 1, "Game 1"], [2, 2, "Game 2"], [3, 3, "Game 3"], [4, 5, "Games 4–5"], [6, 1e9, "Game 6 or later"]];

function renderSessions(games) {
  const { info } = sessionInfo();
  const list = viewSessions(games);
  $("n-sessions").textContent = list.length ? t("{n} sessions, {avg} games each on average", { n: list.length.toLocaleString(), avg: (games.length / list.length).toFixed(1) }) : "";
  const bars = (rows) => rows.map(([label, f]) => { const G = games.filter(f); return { label, n: G.length, w: count(G, (g) => g.win) }; });
  wrBars("wr-session", bars(SESSION_POS.map(([lo, hi, label]) => [label, (g) => info.get(g).pos >= lo && info.get(g).pos <= hi])));
  wrBars("wr-after", bars([
    ["After a win", (g) => info.get(g).prev?.win === true],
    ["After a loss", (g) => info.get(g).prev?.win === false],
  ]));
}

const KP_BANDS = [[0, 0.5, "Under 50%"], [0.5, 0.6, "50–60%"], [0.6, 0.7, "60–70%"], [0.7, 0.8, "70–80%"], [0.8, 9, "80% or more"]];
const DMG_BANDS = [[0, 0.15, "Under 15%"], [0.15, 0.2, "15–20%"], [0.2, 0.25, "20–25%"], [0.25, 0.3, "25–30%"], [0.3, 9, "30% or more"]];

function renderShare(games) {
  const bands = (list, f) => list.map(([lo, hi, label]) => {
    const G = games.filter((g) => { const v = f(g); return v != null && v >= lo && v < hi; });
    return { label, n: G.length, w: count(G, (g) => g.win) };
  });
  wrBars("wr-kp", bands(KP_BANDS, (g) => (g.teamKills > 0 ? (g.kills + g.assists) / g.teamKills : null)));
  wrBars("wr-dshare", bands(DMG_BANDS, (g) => (g.teamDmg > 0 ? g.damage / g.teamDmg : null)));
}

// Enemy champions you've played against, toughest first. Ties go to the champion seen in more games.
function renderEnemies(games) {
  sortState["t-enemies"] ||= { col: 2, asc: true };
  const min = +$("f-minenemy").value || 1;
  const rows = enemyRows(games).filter((r) => r.n >= min);
  table("t-enemies", [
    { label: "Enemy", get: (r) => champById(r.key), fmt: (r) => champLink(r.key, champById(r.key)) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n - r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], rows, 2);
}

// Lifetime totals count every imported game, whatever the filters show.
const TOTALS = [
  ["Games", (G) => G.length],
  ["Wins", (G) => count(G, (g) => g.win)],
  ["Hours played", (G) => Math.round(sum(G, (g) => g.duration) / 3600)],
  ["Kills", (G) => sum(G, (g) => g.kills), true],
  ["Deaths", (G) => sum(G, (g) => g.deaths), true],
  ["Assists", (G) => sum(G, (g) => g.assists), true],
  ["Damage to champions", (G) => sum(G, (g) => g.damage), true],
  ["Damage taken", (G) => sum(G, (g) => g.taken), true],
  ["Healing", (G) => sum(G, (g) => g.heal), true],
  ["Quadra kills", (G) => sum(G, (g) => g.quadra)],
  ["Pentakills", (G) => sum(G, (g) => g.penta)],
  ["Different augments", (G) => new Set(G.flatMap((g) => g.augs)).size],
];

function renderTotals(G) {
  $("totals").innerHTML = G.length ? TOTALS.map(([label, f, perGame]) => {
    const v = f(G);
    const sub = perGame ? t("{n} per game", { n: Math.round(v / G.length).toLocaleString() }) : "";
    return `<div class="record"><div class="r-v">${v.toLocaleString()}</div><div class="r-label">${esc(t(label))}</div><div class="r-sub">${esc(sub)}</div></div>`;
  }).join("") : "";
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
    { label: "Champion", get: (r) => champName(r.sample), fmt: (r) => champLink(r.key, champName(r.sample)) },
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
  $("records").innerHTML = recordsHtml(G);
}

function recordsHtml(G) {
  return RECORDS.map(([label, f, fmt]) => {
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
    { label: "Champion", get: (r) => champName(r.sample), fmt: (r) => champLink(r.sample.champId, champName(r.sample)) },
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
    { label: "Teammate", get: (r) => champById(r.id), fmt: (r) => champLink(r.id, champById(r.id)) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], rows, 2);
}

// Players you've teamed up with, by Riot ID, from your own games. Clicking a name opens their page: nothing is
// looked up, it's all from games you played together.
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

// Links to the champion and player pages below. They live in the address's #part, so Back returns to the overview.
const champHref = (id) => `#champion/${Number(id)}`;
const champLink = (id, name) => `<a class="name-link" href="${champHref(id)}">${esc(name)}</a>`;
const playerLink = (key, name) => `<a class="name-link" href="#player/${encodeURIComponent(key)}">${esc(name)}</a>`;

function renderMates(games) {
  const min = +$("f-minmate").value || 1;
  const map = mateRows(games);
  const rows = [...map.values()].filter((r) => r.n >= min);
  $("mates-card").hidden = !map.size;
  table("t-mates", [
    { label: "Player", get: (r) => r.name.toLowerCase(), fmt: (r) => playerLink(r.key, r.name) },
    { label: "Games together", get: (r) => r.n },
    { label: "Win rate together", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
    { label: "Their KDA", get: (r) => (r.k + r.a) / Math.max(1, r.d), fmt: (r) => kda(r.k, r.d, r.a) },
    { label: "Their damage", get: (r) => r.dmg / r.n, fmt: (r) => Math.round(r.dmg / r.n).toLocaleString() },
  ], rows.slice(0, 100), 1);
}

// ---------- champion and player pages ----------
// #champion/<id>: every game you played on that champion. #player/<name>: every game you played with that
// teammate, and how they did in them. Both count all your games, whatever the overview's filters show, and
// both come only from your own games: nothing is looked up.

const ITEMS = {}; // item id -> {name, icon}
const itemName = (id) => (ITEMS[id] && ITEMS[id].name) || t("Item {id}", { id });
const itemCell = (id) => `<span class="with-icon">${ITEMS[id] && ITEMS[id].icon ? `<img src="${ITEMS[id].icon}" alt="" loading="lazy" width="28" height="28" onerror="this.remove()">` : ""}${esc(itemName(id))}</span>`;
const SITE = ["127.0.0.1", "localhost"].includes(location.hostname) ? "https://deeparam.com/" : "/";

function streakBest(G, won) {
  let best = 0, run = 0;
  for (const g of [...G].sort((a, b) => a.time - b.time)) { run = g.win === won ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

function formStripHtml(G, icon) {
  return G.slice(0, 20).map((x) => {
    const g = x.g || x;
    const id = icon(x);
    const tip = `${champById(id)} · ${t(g.win ? "Win" : "Loss")} · ${fmtDate(new Date(g.time))}`;
    return `<img class="${g.win ? "win" : "loss"}" src="${ICON(id)}" alt="${esc(champById(id))}" title="${esc(tip)}" loading="lazy" width="44" height="44">`;
  }).join("");
}

function byMonth(G, getG = (x) => x) {
  const months = new Map();
  for (const x of [...G].reverse()) {
    const g = getG(x);
    const d = new Date(g.time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = months.get(key) || { label: d.toLocaleDateString(LANG, { year: "numeric", month: "short" }), n: 0, w: 0 };
    m.n++; m.w += g.win ? 1 : 0;
    months.set(key, m);
  }
  return [...months.values()];
}

const detailCard = (title, body, foot = "", wide = false) =>
  `<section class="card${wide ? " wide" : ""}"><div class="card-h"><h3>${esc(title)}</h3>${foot ? `<span class="foot">${esc(foot)}</span>` : ""}</div>${body}</section>`;
const tableBox = (id) => `<div class="tbl-wrap"><table id="${id}"></table></div>`;
const barsBox = (id) => `<div id="${id}" class="wrbars"></div>`;
const vsAll = (rate) => t("{d} pts vs all your games", { d: ptsText((rate - winRate(state.games)) * 100) });

function detailHead(icon, title, sub, link) {
  return `<div class="d-top"><a class="btn" href="#">← ${esc(t("Back to My Stats"))}</a></div>
    <header class="d-head">${icon}<div><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p>${link || ""}</div></header>`;
}

// How you do on, with and against a champion: the bars at the top of its page.
function matchupBars(id, name) {
  const rows = [
    [t("Playing {name}", { name }), (g) => g.champId === id],
    [t("With {name} on your team", { name }), (g) => (g.allies || []).includes(id)],
    [t("Against {name}", { name }), (g) => (g.enemies || []).includes(id)],
  ].map(([label, f]) => { const G = state.games.filter(f); return { label, n: G.length, w: count(G, (g) => g.win) }; });
  return rows;
}

function renderChampionPage(id) {
  const name = champById(id);
  const matchups = matchupBars(id, name);
  if (!matchups.some((r) => r.n)) return false;
  const G = state.games.filter((g) => g.champId === id);
  const alias = state.champAlias[id];
  const link = alias ? `<a class="d-link" href="${SITE}champions/${encodeURIComponent(alias)}" target="_top">${esc(t("Builds and augments for {name}", { name }))} →</a>` : "";
  const matchupCard = detailCard(t("Playing, with and against {name}", { name }), `<div id="d-matchups" class="wrbars"></div>`, t("Win rate in all your games"));
  if (!G.length) {
    const vs = state.games.filter((g) => (g.enemies || []).includes(id));
    $("detail").innerHTML = detailHead(`<img class="d-icon" src="${ICON(id)}" alt="" width="72" height="72">`, name, t("You haven't played {name} yet", { name }), link) +
      matchupCard + (vs.length ? detailCard(t("Games against {name}", { name }), tableBox("d-games"), t(vs.length === 1 ? "1 game" : "{n} games", { n: vs.length.toLocaleString() })) : "");
    wrBars("d-matchups", matchups);
    if (vs.length) table("d-games", [
      { label: "Date", get: (r) => r.time, fmt: (r) => fmtDate(new Date(r.time)) },
      { label: "Your champion", get: (r) => champName(r), fmt: (r) => champLink(r.champId, champName(r)) },
      { label: "Result", get: (r) => +r.win, fmt: (r) => resultBanner(r.win), cls: (r) => (r.win ? "win" : "loss") },
      { label: "K / D / A", get: (r) => (r.kills + r.assists) / Math.max(1, r.deaths), fmt: (r) => `${r.kills} / ${r.deaths} / ${r.assists}` },
      { label: "Damage", get: (r) => r.damage, fmt: (r) => r.damage.toLocaleString() },
    ], vs.slice(0, 300), 0);
    return true;
  }
  const n = G.length, w = count(G, (g) => g.win), rate = w / n;
  const sum3 = (f) => sum(G, f);
  const kp = shareOf(G, (g) => g.kills + g.assists, (g) => g.teamKills);
  const ds = shareOf(G, (g) => g.damage, (g) => g.teamDmg);
  const rank = group(state.games, (g) => g.champId).sort((a, b) => b.n - a.n).findIndex((r) => r.key === id) + 1;
  const tiles = [
    [t("Win rate"), pct(rate), vsAll(rate), wrClass(rate)],
    [t("KDA"), kda(sum3((g) => g.kills), sum3((g) => g.deaths), sum3((g) => g.assists)), `${(sum3((g) => g.kills) / n).toFixed(1)} / ${(sum3((g) => g.deaths) / n).toFixed(1)} / ${(sum3((g) => g.assists) / n).toFixed(1)}`],
    [t("Damage to champions"), Math.round(sum3((g) => g.damage) / n).toLocaleString(), t("per game")],
    [t("Kill participation"), kp ? pct(kp.v) : "–", kp ? t("average") : ""],
    [t("Damage share"), ds ? pct(ds.v) : "–", ds ? t("of your team's damage") : ""],
    [t("Game length"), mmss(sum3((g) => g.duration) / n), t("average")],
    [t("Best win streak"), String(streakBest(G, true)), t("games in a row")],
    [t("Pentakills"), String(sum3((g) => g.penta)), t("{n} quadra kills", { n: sum3((g) => g.quadra) })],
  ];
  $("detail").innerHTML = detailHead(`<img class="d-icon" src="${ICON(id)}" alt="" width="72" height="72">`, name,
    `${t(n === 1 ? "1 game" : "{n} games", { n: n.toLocaleString() })} · ${t("{w} W · {l} L", { w, l: n - w })} · ${t("Your #{rank} most played", { rank })}`, link) + `
    <div class="stats-row">${tiles.map(tileHtml).join("")}</div>
    <div class="two-col">
      ${detailCard(t("Recent form"), `<div class="form-strip">${formStripHtml(G, (g) => g.champId)}</div>`, t("Latest {n} games, newest first", { n: Math.min(20, n) }))}
      ${matchupCard}
    </div>
    <div class="two-col">
      ${detailCard(t("Augments"), tableBox("d-augs"), t("Picked with {name}", { name }))}
      ${detailCard(t("Items"), tableBox("d-items"), t("In your final items"))}
    </div>
    <div class="two-col">
      ${detailCard(t("Enemy champions"), tableBox("d-enemies"), t("Toughest first"))}
      ${detailCard(t("Best teammate champions"), tableBox("d-allies"))}
    </div>
    <div class="two-col">
      ${detailCard(t("Win rate by month"), barsBox("d-month"))}
      ${detailCard(t("Win rate by game length"), barsBox("d-length"))}
    </div>
    ${detailCard(t("Personal records"), `<div id="d-records" class="records"></div>`, t("On {name}", { name }))}
    ${detailCard(t("Games"), tableBox("d-games"), t(n === 1 ? "1 game" : "{n} games", { n: n.toLocaleString() }))}`;

  table("d-augs", [
    { label: "Augment", get: (r) => augName(r.key), fmt: (r) => esc(augName(r.key)) },
    { label: "Picks", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], group(G, (g) => [...new Set(g.augs)]), 1);
  const builtItems = group(G, (g) => [...new Set(g.items)].filter((i) => !ITEMS[i] || ITEMS[i].full));
  table("d-items", [
    { label: "Item", get: (r) => itemName(r.key), fmt: (r) => itemCell(r.key) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], builtItems, 1);
  sortState["d-enemies"] ||= { col: 2, asc: true };
  table("d-enemies", [
    { label: "Enemy", get: (r) => champById(r.key), fmt: (r) => champLink(r.key, champById(r.key)) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n - r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], enemyRows(G).filter((r) => r.n >= 2), 2);
  table("d-allies", [
    { label: "Teammate", get: (r) => champById(r.key), fmt: (r) => champLink(r.key, champById(r.key)) },
    { label: "Games", get: (r) => r.n },
    { label: "Win rate", get: (r) => r.w / r.n + r.n / 1e6, fmt: (r) => pct(r.w / r.n), cls: (r) => wrClass(r.w / r.n) },
  ], group(G, (g) => [...new Set(g.allies)]).filter((r) => r.n >= 2), 2);
  wrBars("d-month", byMonth(G));
  wrBars("d-matchups", matchups);
  const timed = G.filter((g) => g.duration > 0);
  wrBars("d-length", LENGTHS.map(([lo, hi, label]) => {
    const L = timed.filter((g) => g.duration >= lo && g.duration < hi);
    return { label, n: L.length, w: count(L, (g) => g.win) };
  }));
  $("d-records").innerHTML = recordsHtml(G);
  table("d-games", [
    { label: "Date", get: (r) => r.time, fmt: (r) => fmtDate(new Date(r.time)) },
    { label: "Result", get: (r) => +r.win, fmt: (r) => resultBanner(r.win), cls: (r) => (r.win ? "win" : "loss") },
    { label: "K / D / A", get: (r) => (r.kills + r.assists) / Math.max(1, r.deaths), fmt: (r) => `${r.kills} / ${r.deaths} / ${r.assists}` },
    { label: "Damage", get: (r) => r.damage, fmt: (r) => r.damage.toLocaleString() },
    { label: "Length", get: (r) => r.duration, fmt: (r) => mmss(r.duration) },
    { label: "Augments", get: (r) => r.augs.length, fmt: (r) => esc(r.augs.map(augName).join(", ")), cls: () => "augs" },
  ], G.slice(0, 300), 0);
  return true;
}

function renderPlayerPage(key) {
  const r = mateRows(state.games).get(key);
  if (!r) return false;
  const X = r.games; // [{g, m}] newest first
  const n = r.n, w = r.w, rate = w / n;
  const mine = X.map((x) => x.g);
  const other = state.games.filter((g) => !(g.mates || []).some((m) => m.key === key));
  const kpX = X.filter((x) => x.g.teamKills > 0), dsX = X.filter((x) => x.g.teamDmg > 0);
  const theirKp = kpX.length ? sum(kpX, (x) => (x.m.k + x.m.a) / x.g.teamKills) / kpX.length : null;
  const theirDs = dsX.length ? sum(dsX, (x) => x.m.dmg / x.g.teamDmg) / dsX.length : null;
  const first = X[X.length - 1].g, last = X[0].g;
  const tiles = [
    [t("Win rate together"), pct(rate), other.length ? t("{wr} in your other games", { wr: pct(winRate(other)) }) : "", wrClass(rate)],
    [t("Their KDA"), kda(r.k, r.d, r.a), `${(r.k / n).toFixed(1)} / ${(r.d / n).toFixed(1)} / ${(r.a / n).toFixed(1)}`],
    [t("Their damage per game"), Math.round(r.dmg / n).toLocaleString(), ""],
    [t("Their kill participation"), theirKp != null ? pct(theirKp) : "–", ""],
    [t("Their damage share"), theirDs != null ? pct(theirDs) : "–", theirDs != null ? t("of your team's damage") : ""],
    [t("Your KDA with them"), kda(sum(mine, (g) => g.kills), sum(mine, (g) => g.deaths), sum(mine, (g) => g.assists)),
      t("{kda} in all your games", { kda: kda(sum(state.games, (g) => g.kills), sum(state.games, (g) => g.deaths), sum(state.games, (g) => g.assists)) })],
    [t("Best win streak together"), String(streakBest(mine, true)), t("games in a row")],
    [t("Out-damaged you"), pct(count(X, (x) => x.m.dmg > x.g.damage) / n), t("of your games together")],
  ];
  $("detail").innerHTML = detailHead(`<span class="d-icon d-letter" aria-hidden="true">${esc((r.name || "?").charAt(0).toUpperCase())}</span>`, r.name,
    `${t(n === 1 ? "1 game together" : "{n} games together", { n: n.toLocaleString() })} · ${t("{w} W · {l} L", { w, l: n - w })} · ${fmtDate(new Date(first.time))} – ${fmtDate(new Date(last.time))}`) + `
    <p class="foot d-note">${esc(t("Only from games you played together, saved in your own history."))}</p>
    <div class="stats-row">${tiles.map(tileHtml).join("")}</div>
    ${detailCard(t("Recent games together"), `<div class="form-strip">${formStripHtml(X, (x) => x.m.champ)}</div>`, t("Their champions, newest first"))}
    <div class="two-col">
      ${detailCard(t("Their champions"), tableBox("d-their"))}
      ${detailCard(t("Your champions with them"), tableBox("d-yours"))}
    </div>
    <div class="two-col">
      ${detailCard(t("Duos"), tableBox("d-duos"), t("Your champion + theirs"))}
      ${detailCard(t("Win rate together by month"), barsBox("d-month"))}
    </div>
    ${detailCard(t("Games together"), tableBox("d-games"), t(n === 1 ? "1 game together" : "{n} games together", { n: n.toLocaleString() }))}`;

  const champTable = (id, rows) => table(id, [
    { label: "Champion", get: (c) => champById(c.key), fmt: (c) => champLink(c.key, champById(c.key)) },
    { label: "Games", get: (c) => c.n },
    { label: "Win rate", get: (c) => c.w / c.n + c.n / 1e6, fmt: (c) => pct(c.w / c.n), cls: (c) => wrClass(c.w / c.n) },
    { label: "KDA", get: (c) => (c.k + c.a) / Math.max(1, c.d), fmt: (c) => kda(c.k, c.d, c.a) },
  ], rows, 1);
  const theirs = new Map();
  for (const { g, m } of X) {
    const c = theirs.get(m.champ) || { key: m.champ, n: 0, w: 0, k: 0, d: 0, a: 0 };
    c.n++; c.w += g.win ? 1 : 0; c.k += m.k; c.d += m.d; c.a += m.a;
    theirs.set(m.champ, c);
  }
  champTable("d-their", [...theirs.values()]);
  champTable("d-yours", group(mine, (g) => g.champId));
  const duos = new Map();
  for (const { g, m } of X) {
    const k = g.champId + "-" + m.champ;
    const d = duos.get(k) || { mine: g.champId, theirs: m.champ, n: 0, w: 0 };
    d.n++; d.w += g.win ? 1 : 0;
    duos.set(k, d);
  }
  table("d-duos", [
    { label: "Duo", get: (d) => champById(d.mine) + champById(d.theirs), fmt: (d) => `${champLink(d.mine, champById(d.mine))} + ${champLink(d.theirs, champById(d.theirs))}` },
    { label: "Games", get: (d) => d.n },
    { label: "Win rate", get: (d) => d.w / d.n + d.n / 1e6, fmt: (d) => pct(d.w / d.n), cls: (d) => wrClass(d.w / d.n) },
  ], [...duos.values()], 1);
  wrBars("d-month", byMonth(X, (x) => x.g));
  table("d-games", [
    { label: "Date", get: (x) => x.g.time, fmt: (x) => fmtDate(new Date(x.g.time)) },
    { label: "Result", get: (x) => +x.g.win, fmt: (x) => resultBanner(x.g.win), cls: (x) => (x.g.win ? "win" : "loss") },
    { label: "Their champion", get: (x) => champById(x.m.champ), fmt: (x) => champLink(x.m.champ, champById(x.m.champ)) },
    { label: "Their K / D / A", get: (x) => (x.m.k + x.m.a) / Math.max(1, x.m.d), fmt: (x) => `${x.m.k} / ${x.m.d} / ${x.m.a}` },
    { label: "Their damage", get: (x) => x.m.dmg, fmt: (x) => x.m.dmg.toLocaleString() },
    { label: "Your champion", get: (x) => champName(x.g), fmt: (x) => champLink(x.g.champId, champName(x.g)) },
    { label: "Your K / D / A", get: (x) => (x.g.kills + x.g.assists) / Math.max(1, x.g.deaths), fmt: (x) => `${x.g.kills} / ${x.g.deaths} / ${x.g.assists}` },
    { label: "Your damage", get: (x) => x.g.damage, fmt: (x) => x.g.damage.toLocaleString() },
  ], X.slice(0, 300), 0);
  return true;
}

let detailKey = "";
function renderDetail() {
  const m = location.hash.match(/^#(champion|player)\/(.+)$/);
  let shown = false;
  if (m && state.games.length) {
    const arg = decodeURIComponent(m[2]);
    shown = m[1] === "champion" ? renderChampionPage(Number(arg)) : renderPlayerPage(arg);
  }
  document.body.classList.toggle("in-detail", shown);
  $("detail").hidden = !shown;
  if (!shown) $("detail").innerHTML = "";
  // A new page starts at its top; going back returns to the card the link was in.
  const key = shown ? location.hash : "";
  if (key !== detailKey) {
    if (shown) document.body.scrollIntoView({ block: "start" });
    else if (lastLink) lastLink.scrollIntoView({ block: "center" });
    detailKey = key;
  }
}

let lastLink = null;
document.addEventListener("click", (e) => {
  const a = e.target.closest('a.name-link, .form-strip a');
  if (a && !a.closest("#detail")) lastLink = a.closest("section") || a;
});
addEventListener("hashchange", () => {
  // Sorting a page's table re-renders it; a new page starts with each table's default order.
  for (const k of Object.keys(sortState)) if (k.startsWith("d-")) delete sortState[k];
  renderDetail();
});

function renderGames(games) {
  $("n-games").textContent = games.length > 200 ? t("Latest 200 of {n} matches", { n: games.length.toLocaleString() }) : t("{n} matches", { n: games.length.toLocaleString() });
  table("t-games", [
    { label: "Date", get: (r) => r.time, fmt: (r) => fmtDate(new Date(r.time)) },
    { label: "Champion", get: (r) => champName(r), fmt: (r) => champLink(r.champId, champName(r)) },
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
// On deeparam.com, My Stats talks to the helper on this computer at its own address. The helper only answers
// the site's own origin. The browser may ask the player to allow it the first time.
const HELPER = ON_HELPER ? "" : "http://127.0.0.1:8787/";
// Some browsers don't let a site reach this computer at all (or the player said no when asked), so the hint also
// points at the helper's own page; games it saves to the account show up here either way.
const SITE_HINT = () => t("Couldn't reach Mayhem Stats on this computer. Open the Riot Client and sign in, start Mayhem Stats (Open Mayhem Stats.command), then press Import again. If your browser blocks it, import at 127.0.0.1:8787 instead and turn on saving to your account; your games then show up here.");
const HELPER_SEEN = "deeparam-helper-seen";
function rememberHelper(on) {
  try { on ? localStorage.setItem(HELPER_SEEN, "1") : localStorage.removeItem(HELPER_SEEN); } catch (e) { /* not kept */ }
}
function helperSeen() {
  try { return localStorage.getItem(HELPER_SEEN) === "1"; } catch (e) { return false; }
}

function setSyncStatus(text, error = false) {
  syncStatus.hidden = !text;
  syncStatus.textContent = text || "";
  syncStatus.classList.toggle("error", error);
}

async function syncState() {
  const res = await fetch(HELPER + "api/sync", { cache: "no-store" });
  if (!res.ok) throw new Error(`helper answered ${res.status}`);
  return res.json();
}

async function reloadArchive() {
  const res = await fetch(HELPER + "data/mayhem-backup.json", { cache: "no-store" });
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
      if (!ON_HELPER) { setupShare(); setupHistory(); }
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
    // the helper may have been started since the page loaded
    try { await syncState(); } catch (e) { rememberHelper(false); return setSyncStatus(ON_HELPER ? OFFLINE_HINT() : SITE_HINT()); }
    helperFound();
  }
  setSyncStatus(t("Starting…"));
  try {
    const res = await fetch(HELPER + "api/sync", { method: "POST", headers: { "X-Mayhem": "1" } });
    if (!res.ok && res.status !== 409) throw new Error(String(res.status));
  } catch (e) {
    return setSyncStatus(t("Couldn't reach the sync helper."), true);
  }
  watchSync();
};
for (const b of syncBtns) b.addEventListener("click", startSync);

async function setupSync() {
  // The empty state already explains Sync, so this only picks up a running sync. On the site it only looks for
  // the helper once the player has imported through it, so other visitors' browsers never ask about it.
  if (PRESET.sample || (!ON_HELPER && !helperSeen())) return;
  try {
    const s = await syncState();
    helperOnline = true;
    if (!ON_HELPER) rememberHelper(true);
    if (s.running) watchSync();
  } catch (e) { /* no helper; the button explains when pressed */ }
}

// Found the helper after the page loaded (on the site, when the player pressed Import): show its cards.
function helperFound() {
  helperOnline = true;
  if (ON_HELPER) return;
  rememberHelper(true);
  setupProfile();
  setupShare();
  setupHistory();
  setupLive();
}

// Opened from the sync helper, load the archive it keeps.
(async () => {
  await loadLang();
  if (PRESET.sample) return loadText(JSON.stringify(PRESET.sample), { sample: true });
  if (ON_HELPER) {
    try {
      const res = await fetch(HELPER + "data/mayhem-backup.json", { cache: "no-store" });
      if (res.ok) await loadText(await res.text());
    } catch (e) { /* no archive yet */ }
  } else await loadSaved();
  await setupSync();
  // On the site with the helper running, its archive has every game, saved to the account or not.
  if (!ON_HELPER && helperOnline) await reloadArchive().catch(() => {});
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
  const res = await fetch(HELPER + "api/profile", {
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
  const res = await fetch(HELPER + "api/profile", {
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
  // Connecting to deeparam.com is for the helper's own page; on the site the player is already here.
  if (ON_HELPER && helperOnline && !state.sample) $("link-card").hidden = false;
}

// ---------- sharing ----------
// Off unless the player ticks the box; the helper sends games without names or account ids.

const shareBox = $("share-on");

function showShare(st) {
  shareBox.checked = !!st.enabled;
  $("share-count").textContent = st.enabled && st.shared ? t("{n} games shared", { n: st.shared.toLocaleString() }) : "";
}

async function shareCall(body) {
  const res = await fetch(HELPER + "api/share", {
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
  const res = await fetch(HELPER + "api/history", {
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
    const res = await fetch(HELPER + "api/live", { cache: "no-store" });
    if (!res.ok) return;
    const live = await res.json();
    if (!live.enabled) return;
    state.live = (live.games || []).filter((r) => r && r.player && Array.isArray(r.snapshots));
    $("live-card").hidden = false;
    $("live-status").textContent = live.recording ? t("Recording a game ({champion})", { champion: live.recording }) : t("{n} recorded", { n: state.live.length });
    renderLive();
  } catch (e) { /* older helper without recording */ }
}
