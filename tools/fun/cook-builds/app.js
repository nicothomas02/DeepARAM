LabI18n.ready(function () {
  const data = window.COOK_DATA;
  const T = LabI18n.t;
  // Official names in the visitor's language, English when there is none.
  const champ = (b) => LabI18n.name("champions", b.champion, b.champion_name);
  const augName = (a) => LabI18n.name("augments", a.id, a.name);
  const itemName = (b, i) => LabI18n.name("items", (b.item_ids || [])[i], b.items[i]);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (path) => (window.COOK_ICONS && window.COOK_ICONS[path]) || path;
  const day = (iso) => LabI18n.date(iso, { month: "short", day: "numeric" });
  // An item's icon (the site's own copy, by item id); the name stays beside it. A missing icon just hides itself.
  const ITEM_ICONS = (data.meta && data.meta.item_icons) || {};
  const itemRow = (id, name) => {
    const src = id != null && ITEM_ICONS[String(id)];
    return `<li>${src ? `<img src="${esc(src)}" alt="" width="28" height="28" loading="lazy" onerror="this.remove()">` : ""}<span>${esc(name)}</span></li>`;
  };
  const fullDay = (iso) => LabI18n.date(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  // Every build with a `chef` date was the Chef Special that day; a new one is added every Friday and the
  // older ones stay in the archive. Today's is the newest. No stats: a Chef Special is picked for the idea.
  const specials = data.builds.filter((b) => b.chef).sort((a, b) => b.chef.localeCompare(a.chef));
  const chef = specials[0] || null;

  // Share links open a special by its date, so they keep working after it is replaced. On the site that's
  // /kitchen/<date>, whose link preview shows the special's card; elsewhere (a saved copy) the page's own #hash.
  function shareUrl(hash) {
    const date = hash.replace(/^chefs-special-/, "");
    if (/^https?:$/.test(location.protocol) && /^\d{4}-\d{2}-\d{2}$/.test(date)) return location.origin + "/kitchen/" + date;
    return location.href.replace(/#.*$/, "") + "#" + hash;
  }
  // Same look and words as the site's Share button (web/src/components/ShareButton.tsx).
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';
  const shareButton = (b) => `<button type="button" class="share" data-share="chefs-special-${esc(b.chef)}" data-title="${esc(T(b.title))}" aria-label="${esc(T("Share {title}", { title: T(b.title) }))}">${SHARE_ICON}<span aria-live="polite">${T("Share")}</span></button>`;
  // Phones open the share sheet; elsewhere the link is copied.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-share]");
    if (!btn) return;
    const url = btn.dataset.url || shareUrl(btn.dataset.share);
    const label = btn.querySelector("span");
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: btn.dataset.title + " · DeepARAM", url }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); label.textContent = T("Link copied"); }
    catch (err) { window.prompt(T("Copy this link"), url); }
    setTimeout(() => { label.textContent = T("Share"); }, 2500);
  });

  function augRow(a) {
    // A flex augment is optional: the build works without it.
    return `<li class="${a.core ? "core" : "flex"}">
      <img src="${icon(a.icon)}" alt="" width="32" height="32" loading="lazy">
      <div>
        <div class="name"${a.core ? "" : ` data-flex="${esc(T("flex"))}"`}>${esc(augName(a))} <span class="chip ${a.rarity.toLowerCase()}">${esc(T(a.rarity))}</span></div>
        <div class="desc">${esc(T(a.text))}</div>
      </div>
    </li>`;
  }

  // Builds that may not come together in a real game: the champion has never been seen taking one of its augments,
  // can't be offered it, or it left Mayhem (data/checks/findings.py, served by the site at /data/kitchen-checks.json).
  let doubts = {};
  function doubtNote(b) {
    // Off-menu specials (menu: "off", Nico 2026-11-19) use augments outside the champion's pool on purpose.
    if (b.menu === "off") return `<p class="doubt offmenu"><b>${T("Off-menu")}</b> ${esc(T("Uses augments {champion} isn't normally offered. Just for fun: it may never come together in a real game.", { champion: champ(b) }))}</p>`;
    const d = doubts[b.id];
    if (!d || !d.augments || !d.augments.length) return "";
    const names = d.augments.map((a) => augName(a)).join(", ");
    return `<p class="doubt"><b>${T("May not work in a real game")}</b> ${esc(T("{champion} may not be offered {augments} this patch, so this build might not come together. Try it if they show up.", { champion: champ(b), augments: names }))}</p>`;
  }

  // Short format (from 2026-11-13): a one-line tagline, the joke in one sentence, then one short line per piece.
  function shortText(b) {
    return `${b.tagline ? `<p class="tagline">${esc(T(b.tagline))}</p>` : ""}
      <p class="why">${esc(T(b.why))}</p>
      <ul class="how">${b.how.map(([k, t]) => `<li><b>${esc(T(k))}</b> ${esc(T(t))}</li>`).join("")}</ul>`;
  }

  function card(b) {
    return `<article class="card" id="${esc(b.id)}">
      <div class="card-head">
        <img src="${icon(b.champion_icon)}" alt="" width="52" height="52" loading="lazy">
        <div class="who">
          <h2>${esc(T(b.title))}</h2>
          <div class="sub">${esc(champ(b))}</div>
        </div>
        ${shareButton(b)}
      </div>
      ${b.how ? shortText(b) : `<p class="why">${esc(T(b.why))}</p>`}${doubtNote(b)}
      <p class="play muted"><b>${T("How to play:")}</b> ${esc(T(b.play))}</p>
      <div class="cols">
        <div><h3>${T("Augments")}</h3><ul class="augs">${b.augments.map(augRow).join("")}</ul></div>
        <div><h3>${T("Items")}</h3><ul class="items">${b.items.map((x, i) => itemRow((b.item_ids || [])[i], itemName(b, i))).join("")}</ul></div>
      </div>
    </article>`;
  }

  // A new special lands once a week, Fridays at 7:50 PM New York time (SERVE_DAY, 0 = Sunday). A special from the last
  // 7 days is "This week's"; an older one is the "Latest", with when the next one arrives in the visitor's own time.
  const SERVE_DAY = 5;
  const NY = "America/New_York";
  const nyParts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(t).filter((p) => p.type !== "literal").map((p) => [p.type, +p.value]));
  const nyToday = (t) => { const p = nyParts(t); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
  // 7:50 PM New York on the day of t, as a moment: start from that wall time read as UTC, then remove New York's offset.
  function nyServeTime(t) {
    const p = nyParts(t);
    const guess = Date.UTC(p.year, p.month - 1, p.day, 19, 50);
    const q = nyParts(new Date(guess));
    const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute) - guess;
    return new Date(guess - offset);
  }
  const clock = (t) => t.toLocaleTimeString(LabI18n.lang === "en" ? "en-US" : LabI18n.lang, { hour: "numeric", minute: "2-digit" });
  const weekday = (t) => t.toLocaleDateString(LabI18n.lang === "en" ? "en-US" : LabI18n.lang, { weekday: "long" });
  function freshness(b) {
    const now = new Date();
    if (b.chef > nyToday(new Date(now.getTime() - 7 * 86400000))) return { fresh: true };
    const p = nyParts(now);
    let add = (SERVE_DAY - new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 7) % 7;
    if (add === 0 && nyServeTime(now) <= now) add = 7;
    const serve = nyServeTime(new Date(now.getTime() + add * 86400000));
    return { fresh: false, next: serve > now ? T("Next special {day} at {time}, your time.", { day: weekday(serve), time: clock(serve) }) : T("The next special is on its way.") };
  }

  // The Chef Special box shows this week's special, or an older one picked from the archive.
  function showSpecial(b) {
    const box = document.getElementById("chefs-special");
    const i = specials.indexOf(b);
    const today = b === chef;
    const f = today ? freshness(b) : null;
    const date = { date: day(b.chef) };
    const label = esc(!today ? T("Chef Special · {date}", date) : f.fresh ? T("This week's Chef Special · {date}", date) : T("Latest Chef Special · {date}", date));
    // Two menus: in-pool specials, and Off-menu ones that use augments the champion isn't normally offered.
    const opt = (s) => `<option value="${esc(s.chef)}"${s === b ? " selected" : ""}>${esc(day(s.chef))} · ${esc(T(s.title))} (${esc(champ(s))})</option>`;
    const onMenu = specials.filter((s) => s.menu !== "off"), offMenu = specials.filter((s) => s.menu === "off");
    const opts = offMenu.length
      ? `<optgroup label="${esc(T("On the menu"))}">${onMenu.map(opt).join("")}</optgroup><optgroup label="${esc(T("Off-menu"))}">${offMenu.map(opt).join("")}</optgroup>`
      : specials.map(opt).join("");
    box.innerHTML = `<div class="chef-head"><p class="eyebrow" id="chef-label">${label}</p>
      <p class="muted small">${today ? `${T("A new unconventional build every Friday, built on augments that work together.")}${f.next ? ` ${esc(f.next)}` : ""}` : `${esc(T("Served {date}.", { date: fullDay(b.chef) }))} <a href="#chefs-special">${T("Back to this week's")}</a>`}</p></div>
      <div class="chef-archive" id="chef-archive" role="group" aria-label="${T("Chef Special archive")}">
        <span class="eyebrow">${esc(T(specials.length === 1 ? "Archive · {n} special" : "Archive · {n} specials", { n: specials.length }))}</span>
        <button type="button" data-go="${i + 1}"${i + 1 >= specials.length ? " disabled" : ""}>${T("‹ Earlier")}</button>
        <select aria-label="${T("Pick a day")}">${opts}</select>
        <button type="button" data-go="${i - 1}"${i <= 0 ? " disabled" : ""}>${T("Later ›")}</button>
      </div>${card(b)}`;
    box.hidden = false;
    box.querySelector("select").addEventListener("change", (e) => go(specials.find((s) => s.chef === e.target.value)));
    for (const btn of box.querySelectorAll("button[data-go]")) btn.addEventListener("click", () => go(specials[+btn.dataset.go]));
  }
  function go(b) {
    if (!b) return;
    history.replaceState(null, "", b === chef ? "#chefs-special" : "#chefs-special-" + b.chef);
    showSpecial(b);
  }
  // #chefs-special-YYYY-MM-DD opens that day's special; anything else opens today's.
  function fromHash() {
    const m = location.hash.match(/^#chefs-special-(\d{4}-\d{2}-\d{2})$/);
    return (m && specials.find((s) => s.chef === m[1])) || chef;
  }
  // Community builds: sent from the Simulator by signed-in players and approved by the site owner
  // (/api/kitchen/community). Their own words stay as written; names follow the page's language.
  function communityCard(c) {
    const by = c.by ? T("by {name}", { name: c.by }) : T("by a DeepARAM player");
    // Its share link's preview shows the build's card (web/src/app/share/builds).
    const link = location.origin + "/share/builds?" + new URLSearchParams({ champ: c.champion, items: c.items.map((i) => i.id).join(","), augs: c.augments.map((a) => a.id).join(","), title: c.title, to: "kitchen" });
    return `<article class="card community-card">
      <div class="card-head">
        <img src="/icons/champions/${esc(c.champion)}.webp" alt="" width="52" height="52" loading="lazy">
        <div class="who">
          <h2 dir="auto">${esc(c.title)}</h2>
          <div class="sub">${esc(LabI18n.name("champions", c.champion, c.championName))} <span class="muted" dir="auto">· ${esc(by)}</span></div>
        </div>
        <button type="button" class="share" data-url="${esc(link)}" data-title="${esc(c.title)}" aria-label="${esc(T("Share {title}", { title: c.title }))}">${SHARE_ICON}<span aria-live="polite">${T("Share")}</span></button>
      </div>
      <p class="why" dir="auto">${esc(c.description)}</p>
      <div class="cols">
        ${c.augments.length ? `<div><h3>${T("Augments")}</h3><ul class="items">${c.augments.map((a) => `<li>${esc(LabI18n.name("augments", a.id, a.name))}</li>`).join("")}</ul></div>` : ""}
        <div><h3>${T("Items")}</h3><ul class="items">${c.items.map((i) => itemRow(i.id, LabI18n.name("items", i.id, i.name))).join("")}</ul></div>
      </div>
    </article>`;
  }
  if (/^https?:$/.test(location.protocol)) {
    fetch("/api/kitchen/community", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        const list = (j && Array.isArray(j.builds) ? j.builds : []).filter((c) => c && c.title && Array.isArray(c.items) && Array.isArray(c.augments));
        // No approved builds yet: invite the first one instead of hiding the section.
        document.getElementById("community-builds").innerHTML = list.length ? list.map(communityCard).join("") : `<div class="empty">
          <p class="empty-title">${T("No community builds yet")}</p>
          <p class="muted">${T("Cooked up something strange? Build it in the Simulator and send it in. The chef picks the best ones for this page.")}</p>
          <a class="empty-cta" href="/simulator" target="_top">${T("Send a build from the Simulator")}</a>
        </div>`;
        document.getElementById("community").hidden = false;
        if (location.hash === "#community") document.getElementById("community").scrollIntoView();
      })
      .catch(() => {});
  }

  if (/^https?:$/.test(location.protocol)) {
    fetch("/data/kitchen-checks.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.builds) return;
        doubts = j.builds;
        for (const el of document.querySelectorAll("article.card[id]")) {
          const b = data.builds.find((x) => x.id === el.id);
          const why = b && el.querySelector(".why");
          if (why && !el.querySelector(".doubt")) why.insertAdjacentHTML("afterend", doubtNote(b));
        }
      })
      .catch(() => {});
  }

  // Menu coverage (Nico 2026-11-20): every champion, and whether it has an on-the-menu (in-pool) and an
  // off-menu Chef Special yet. Each tick opens that special.
  function coverage() {
    const sec = document.getElementById("menu-coverage");
    const all = (data.meta && data.meta.champions) || [];
    if (!sec || !all.length) return;
    const on = {}, off = {};
    for (const s of specials) { const m = s.menu === "off" ? off : on; if (!m[s.champion]) m[s.champion] = s; }
    const name = (c) => LabI18n.name("champions", c[0], c[1]);
    const rows = all.map((c) => ({ c, n: name(c) })).sort((a, b) => a.n.localeCompare(b.n, LabI18n.lang));
    const cell = (s) => s
      ? `<td class="yes"><a href="#chefs-special-${esc(s.chef)}" title="${esc(T(s.title))}">✓ <span>${esc(T(s.title))}</span></a></td>`
      : `<td class="no"><span class="muted">${T("Not yet")}</span></td>`;
    const body = document.getElementById("coverage-rows");
    const paint = (q) => {
      const f = q.trim().toLowerCase();
      body.innerHTML = rows.filter((r) => !f || r.n.toLowerCase().includes(f))
        .map((r) => `<tr><th scope="row"><img src="/icons/champions/${esc(r.c[0])}.webp" alt="" width="28" height="28" loading="lazy" onerror="this.remove()"><span>${esc(r.n)}</span></th>${cell(on[r.c[0]])}${cell(off[r.c[0]])}</tr>`).join("");
    };
    document.getElementById("coverage-count").textContent = T("{on} on the menu, {off} off-menu, of {total} champions", { on: Object.keys(on).length, off: Object.keys(off).length, total: all.length });
    document.getElementById("coverage-search").addEventListener("input", (e) => paint(e.target.value));
    paint("");
    sec.hidden = false;
  }

  if (chef) showSpecial(fromHash());
  coverage();
  window.addEventListener("hashchange", () => {
    if (!chef || !/^#(chefs-special|chef-archive)/.test(location.hash)) return;
    showSpecial(fromHash());
    document.getElementById("chefs-special").scrollIntoView();
  });
});
